// Audiences (shared/audiences.js): keys derived per audience and epoch, the current key handed to the
// members who lack it, a new epoch when someone leaves, keys given to me kept per author and checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { Audiences, audienceKey } = await import('../../shared/audiences.js');
const { KINDS, keyId, seal, open } = await import('../../shared/events.js');
const { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, matchFilters } = await import('../../shared/nostr.mjs');

const person = () => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)) };
};

/** The hub's network for the settings, answered by hand; an inbox that records what it was asked to send. */
function world({ friends = [], circles = [], blocked = [] } = {}) {
  const events = [];
  const listeners = new Set();
  const subs = [];
  const db = {
    put: async (ev) => {
      events.push(ev);
      for (const fn of listeners) fn(ev, 'hub');
    },
    query: async (filters) => events.filter((e) => matchFilters(filters, e)),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  const net = { db, pool: { online: true, subscribe: (_f, h) => (subs.push(h), { close() {} }) }, sync: { publish: async (ev) => db.put(ev) } };
  const sent = [];
  const handlers = new Map();
  const inbox = {
    onRumor: (kind, fn) => (handlers.set(kind, fn), () => handlers.delete(kind)),
    sendRumor: async (pk, kind, body, options) => sent.push({ pk, kind, body, options }),
    deliver: (rumor) => handlers.get(rumor.kind)?.(rumor),
  };
  const people = {
    list: friends,
    circles,
    listeners: new Set(),
    friends() {
      return this.list.map((pk) => ({ pk }));
    },
    isFriend(pk) {
      return this.list.includes(pk);
    },
    membersOf(id) {
      return this.circles.find((c) => c.id === id)?.members || [];
    },
    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },
  };
  return { net, sent, inbox, people, isBlocked: (pk) => blocked.includes(pk), eose: () => subs.forEach((h) => h.oneose?.('wss://r')) };
}

async function started(me, w) {
  const a = new Audiences(me, w.net, { inbox: w.inbox, people: w.people, isBlocked: w.isBlocked });
  const ready = a.start();
  await ready;
  w.eose();
  await a.settings.synced;
  return a;
}

test('keys are derived per audience and epoch, the same on every device, and named by their hash', () => {
  const me = person();
  const k1 = audienceKey(me.sk, 'friends', 1);
  assert.deepEqual(audienceKey(me.sk, 'friends', 1), k1, 'deterministic');
  assert.notDeepEqual(audienceKey(me.sk, 'friends', 2), k1, 'another epoch, another key');
  assert.notDeepEqual(audienceKey(me.sk, 'me', 1), k1, 'another audience, another key');
  assert.notDeepEqual(audienceKey(person().sk, 'friends', 1), k1, 'another person, another key');
  assert.match(keyId(k1), /^[0-9a-f]{16}$/);
});

test('the first post to friends starts epoch 1 and hands its key to every friend once; a new friend gets it later', async () => {
  mem.clear();
  const me = person();
  const [b, c, d] = [person(), person(), person()];
  const w = world({ friends: [b.pk, c.pk] });
  const a = await started(me, w);
  const cur = await a.current('friends');
  assert.equal(cur.epoch, 1);
  assert.equal(cur.kid, keyId(cur.k));
  assert.deepEqual(w.sent.map((s) => s.pk).sort(), [b.pk, c.pk].sort(), 'to each friend');
  assert.ok(w.sent.every((s) => s.kind === KINDS.AUDIENCE_KEY && s.body.kid === cur.kid && s.body.k === bytesToHex(cur.k)));
  assert.ok(w.sent.every((s) => s.options.self === false && s.options.wait === false), 'not to my own devices; stored and owed, not awaited');
  await a.current('friends');
  assert.equal(w.sent.length, 2, 'nobody gets it twice');
  w.people.list = [b.pk, c.pk, d.pk];
  await a.reconcileAll();
  assert.deepEqual(
    w.sent.slice(2).map((s) => s.pk),
    [d.pk],
    'a new friend gets the current key, and reads what was posted under it',
  );
  assert.equal(a.epoch('friends'), 1, 'no new epoch for someone joining');
  a.stop();
});

test('someone leaving starts a new epoch, whose key goes to those still in; I keep every key I used', async () => {
  mem.clear();
  const me = person();
  const [b, c] = [person(), person()];
  const w = world({ friends: [b.pk, c.pk] });
  const a = await started(me, w);
  const first = await a.current('friends');
  w.people.list = [b.pk]; // c is unfriended
  const second = await a.current('friends');
  assert.equal(second.epoch, 2);
  assert.notEqual(second.kid, first.kid);
  assert.deepEqual(
    w.sent.slice(2).map((s) => s.pk),
    [b.pk],
    'only b gets the new key',
  );
  assert.deepEqual(a.key(me.pk, first.kid), first.k, 'my old posts still open for me');
  assert.deepEqual(a.key(me.pk, second.kid), second.k);
  assert.equal(a.audienceOf(second.kid), 'friends');
  a.stop();
});

test('a circle is an audience of its own; blocking someone takes them out like unfriending', async () => {
  mem.clear();
  const me = person();
  const [b, c] = [person(), person()];
  const blocked = [];
  const w = world({ friends: [b.pk, c.pk], circles: [{ id: 'grow', members: [b.pk, c.pk] }], blocked });
  const a = await started(me, w);
  const circle = await a.current('c:grow');
  assert.equal(a.audienceOf(circle.kid), 'c:grow');
  assert.equal(w.sent.length, 2);
  blocked.push(c.pk);
  const next = await a.current('c:grow');
  assert.equal(next.epoch, 2, 'a blocked member is out');
  assert.deepEqual(w.sent.at(-1).pk, b.pk);
  const mine = await a.current('me');
  assert.equal(w.sent.length, 3, '"only me" goes to nobody');
  assert.equal(a.audienceOf(mine.kid), 'me');
  await assert.rejects(a.current('everyone'), /no such audience/);
  a.stop();
});

test('keys given to me are checked and kept per author; strangers’ and my own copies are handled', async () => {
  mem.clear();
  const me = person();
  const [x, y] = [person(), person()];
  const w = world({ friends: [x.pk], blocked: [y.pk] });
  const a = await started(me, w);
  const k = audienceKey(x.sk, 'friends', 1);
  const kid = keyId(k);
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: x.pk, content: JSON.stringify({ kid, k: bytesToHex(k) }) });
  await a.queue;
  assert.deepEqual(a.key(x.pk, kid), k);
  assert.ok(a.hasKeysFrom(x.pk));
  const sealed = await seal(k, { text: 'hi' });
  assert.deepEqual(await open(a.key(x.pk, kid), sealed), { text: 'hi' }, 'and it opens what x sealed');
  // a key that is not what it says
  const other = audienceKey(x.sk, 'friends', 2);
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: x.pk, content: JSON.stringify({ kid: '0000000000000000', k: bytesToHex(other) }) });
  // from someone blocked, from myself, garbage
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: y.pk, content: JSON.stringify({ k: bytesToHex(audienceKey(y.sk, 'friends', 1)) }) });
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: me.pk, content: JSON.stringify({ k: bytesToHex(other) }) });
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: x.pk, content: 'not json' });
  await a.queue;
  assert.equal(a.key(x.pk, keyId(other)), null, 'a mislabelled key is dropped');
  assert.equal(a.hasKeysFrom(y.pk), false, 'nothing from someone blocked');
  assert.deepEqual(Object.keys(a.settings.get(`got:${x.pk}`)), [kid]);
  // only the last twelve per author
  for (let e = 2; e <= 15; e++) {
    const ke = audienceKey(x.sk, 'friends', e);
    w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: x.pk, content: JSON.stringify({ k: bytesToHex(ke) }) });
  }
  await a.queue;
  assert.equal(Object.keys(a.settings.get(`got:${x.pk}`)).length, 12);
  assert.equal(a.key(x.pk, kid), null, 'the oldest went');
  assert.ok(a.key(x.pk, keyId(audienceKey(x.sk, 'friends', 15))), 'the newest stayed');
  a.stop();
});

test('keys that arrive before the settings are read wait for them', async () => {
  mem.clear();
  const me = person();
  const x = person();
  const w = world();
  const a = new Audiences(me, w.net, { inbox: w.inbox, people: w.people, isBlocked: w.isBlocked });
  const k = audienceKey(x.sk, 'me', 1);
  w.inbox.deliver({ kind: KINDS.AUDIENCE_KEY, pubkey: x.pk, content: JSON.stringify({ k: bytesToHex(k) }) }); // the inbox replays before start()
  await a.start();
  w.eose();
  await a.queue;
  assert.deepEqual(a.key(x.pk, keyId(k)), k);
  a.stop();
});
