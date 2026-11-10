// The chat after a message is sent (0.30), on the real store (shared/store.js on fake-indexeddb) and a relay in
// memory: replies, reactions, edits, pins and deletions in conversations and groups, in any order, by whom they
// may come; disappearing messages that carry NIP-40 inside and out and go from the store on time; pinned
// conversations; the search on the device.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { LocalStore } = await import('../../shared/store.js');
const { DirectMessages } = await import('../../shared/chat.js');
const { Groups } = await import('../../shared/groups.js');
const { KINDS } = await import('../../shared/events.js');
const { changeOf, fold, pinsOf, reactionOf } = await import('../../shared/chatlog.js');
const { bytesToHex, generateSecretKey, getPublicKey, matchFilters, nip59, hexToBytes } = await import('../../shared/nostr.mjs');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await tick(15);
  }
  assert.fail(`timed out: ${what}`);
}

/** A relay in memory: keeps what it is given, hands it to every matching subscription. */
function relay() {
  const events = [];
  const subs = new Set();
  return {
    events,
    publish(ev) {
      if (!events.some((e) => e.id === ev.id)) events.push(ev);
      for (const s of subs) if (matchFilters(s.filters, ev)) s.onevent(ev, 'wss://r');
    },
    subscribe(filters, h) {
      const s = { filters, onevent: h.onevent };
      subs.add(s);
      for (const ev of [...events].reverse()) if (matchFilters(filters, ev)) h.onevent(ev, 'wss://r'); // the newest first, as relays answer
      setTimeout(() => h.oneose?.('wss://r'), 5);
      return { close: () => subs.delete(s) };
    },
  };
}

let dbs = 0;
/** A person's device on the relay: its own store, the inbox, the groups. */
async function device(r, identity = null) {
  const sk = identity?.sk || bytesToHex(generateSecretKey());
  const id = { sk, pk: getPublicKey(hexToBytes(sk)), alias: identity?.alias || '' };
  const db = await LocalStore.open(`chat-test-${++dbs}`);
  const pool = { subscribe: (f, h) => r.subscribe(f, h), urlsOf: () => [], guestUrls: () => [], networkOf: () => 'hub' };
  const sync = {
    publish: async (ev) => {
      await db.put(ev, 'hub');
      r.publish(ev);
    },
    watch() {},
  };
  const net = { db, pool, sync };
  const dm = new DirectMessages(id, net);
  const groups = new Groups(id, net, { inbox: dm });
  groups.friendCheck = () => true;
  await dm.start();
  await groups.start();
  return { id, db, dm, groups, stop: () => (dm.stop(), groups.stop()) };
}

const texts = (list) => list.map((m) => (m.deleted ? '(deleted)' : m.system ? `(${m.system} ${m.timer})` : m.text));

test('reactions: NIP-25’s plus and minus read as emoji; a change names its message by the last e', () => {
  assert.equal(reactionOf('+'), '👍');
  assert.equal(reactionOf(''), '👍');
  assert.equal(reactionOf('-'), '👎');
  assert.equal(reactionOf('🎉'), '🎉');
  assert.equal(reactionOf('not one'), '');
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = changeOf({ id: 'r1', kind: KINDS.REACTION, content: '❤️', tags: [['e', a], ['e', b]] }, { conv: 'x', from: 'f'.repeat(64), t: 1 });
  assert.equal(c.target, b);
  assert.equal(changeOf({ id: 'r2', kind: KINDS.CHAT_EDIT, content: '  ', tags: [['e', a]] }, { conv: 'x', from: 'f'.repeat(64), t: 1 }), null, 'an empty edit');
  assert.equal(changeOf({ id: 'r3', kind: KINDS.CHAT_PIN, content: 'pin', tags: [] }, { conv: 'x', from: 'f'.repeat(64), t: 1 }), null, 'names nothing');
});

test('fold: the writer’s newest edit, one reaction a person, the newest pin, a deletion only by the writer', () => {
  const me = '1'.repeat(64);
  const you = '2'.repeat(64);
  const m = { id: 'm'.repeat(64), conv: you, from: you, at: 100, t: 100_000, text: 'first' };
  const change = (ref, t, from, rest) => ({ ref, conv: you, from, t, ...rest });
  const changes = [
    change('e2', 5, you, { type: 'edit', target: m.id, text: 'third' }),
    change('e1', 3, you, { type: 'edit', target: m.id, text: 'second' }),
    change('e3', 9, me, { type: 'edit', target: m.id, text: 'not mine to edit' }),
    change('r1', 1, me, { type: 'react', target: m.id, emoji: '👍' }),
    change('r2', 2, me, { type: 'react', target: m.id, emoji: '❤️' }),
    change('r3', 2, you, { type: 'react', target: m.id, emoji: '❤️' }),
    change('p1', 4, me, { type: 'pin', target: m.id, on: true }),
    change('d1', 6, me, { type: 'delete', targets: [m.id] }), // not the writer: nothing
  ];
  const [f] = fold([m], changes, me);
  assert.equal(f.text, 'third');
  assert.equal(f.edited, 5);
  assert.deepEqual(f.reactions, [{ emoji: '❤️', from: [me, you], mine: true }]);
  assert.deepEqual(f.pinned, { by: me, t: 4 });
  assert.deepEqual(pinsOf(changes), [{ id: m.id, by: me, t: 4 }]);
  // my reaction taken back; the pin taken down; the writer deletes it
  const more = [...changes, change('d2', 7, me, { type: 'delete', targets: ['r1', 'r2'] }), change('p2', 8, you, { type: 'pin', target: m.id, on: false })];
  const [g] = fold([m], more, me);
  assert.deepEqual(g.reactions, [{ emoji: '❤️', from: [you], mine: false }]);
  assert.equal(g.pinned, null);
  assert.deepEqual(pinsOf(more), []);
  const [h] = fold([m], [...more, change('d3', 10, you, { type: 'delete', targets: [m.id] })], me);
  assert.equal(h.deleted, true);
  assert.equal(h.text, '');
  // what has run out is left out
  assert.deepEqual(fold([{ ...m, expires: 10 }], [], me, 11), []);
});

test('a conversation: a reply, a reaction, an edit, a pin and a deletion reach both sides, and only the writer edits', async () => {
  const r = relay();
  const A = await device(r);
  const B = await device(r);
  const hello = await A.dm.send(B.id.pk, 'hello B');
  await until(async () => (await B.dm.messages(A.id.pk)).length === 1, 'B has the message');
  const answer = await B.dm.send(A.id.pk, 'hi A', { reply: hello.id });
  await until(async () => (await A.dm.messages(B.id.pk)).length === 2, 'A has the answer');
  let onA = await A.dm.messages(B.id.pk);
  assert.equal(onA[1].reply, hello.id);
  assert.equal(onA[1].replyTo.text, 'hello B', 'the reply carries what it answers');

  await A.dm.react(B.id.pk, onA[1], '❤️');
  await B.dm.react(A.id.pk, (await B.dm.messages(A.id.pk))[1], '👍');
  await until(async () => (await B.dm.messages(A.id.pk))[1].reactions.length === 2, 'both reactions on B');
  await A.dm.react(B.id.pk, onA[1], '😂'); // one a person: the new one takes the place of the last
  await until(async () => (await B.dm.messages(A.id.pk))[1].reactions.some((x) => x.emoji === '😂'), 'the new reaction on B');
  assert.deepEqual(
    (await B.dm.messages(A.id.pk))[1].reactions.map((x) => x.emoji).sort(),
    ['👍', '😂'],
  );
  await A.dm.unreact(B.id.pk, onA[1]);
  await until(async () => (await B.dm.messages(A.id.pk))[1].reactions.length === 1, 'A’s reaction gone on B');

  await A.dm.edit(B.id.pk, onA[0], 'hello there B');
  await until(async () => (await B.dm.messages(A.id.pk))[0].text === 'hello there B', 'the edit on B');
  assert.ok((await B.dm.messages(A.id.pk))[0].edited);
  assert.equal(await A.dm.edit(B.id.pk, onA[1], 'not mine'), null, 'someone else’s message is not mine to edit');
  // even sent by hand, B's device ignores an edit of B's message by A
  await A.dm.deliver(B.id.pk, KINDS.CHAT_EDIT, 'forged', [['e', answer.id]], { name: false });
  await tick(80);
  assert.equal((await B.dm.messages(A.id.pk))[1].text, 'hi A');

  await B.dm.pin(A.id.pk, (await B.dm.messages(A.id.pk))[0], true);
  await until(async () => (await A.dm.pinned(B.id.pk)).length === 1, 'the pin on A');
  assert.equal((await A.dm.pinned(B.id.pk))[0].text, 'hello there B');

  // deleting: for both sides, the text erased in the store, the pin gone with it; only the writer may
  await A.dm.deliver(B.id.pk, KINDS.DELETION, '', [['e', answer.id]], { name: false });
  await tick(80);
  assert.equal((await B.dm.messages(A.id.pk))[1].deleted, undefined, 'A cannot delete B’s message');
  onA = await A.dm.messages(B.id.pk);
  await A.dm.remove(B.id.pk, onA[0]);
  await until(async () => (await B.dm.messages(A.id.pk))[0].deleted === true, 'deleted on B');
  const stored = await B.db.getMessage(hello.id);
  assert.equal(stored.text, '');
  assert.ok(!JSON.stringify(await B.db.changes(A.id.pk)).includes('hello there'), 'its edits erased too');
  assert.deepEqual(await B.dm.pinned(A.id.pk), []);
  const [conv] = await B.dm.conversations();
  assert.equal(conv.id, answer.id, 'the newest message is the preview');
  A.stop();
  B.stop();
});

test('in any order: a deletion before its message leaves it erased; changes from earlier than the message still count', async () => {
  const r = relay();
  const A = await device(r);
  const B = await device(r);
  const hello = await A.dm.send(B.id.pk, 'secret words');
  await until(async () => (await B.dm.messages(A.id.pk)).length === 1, 'B has it');
  await A.dm.edit(B.id.pk, (await A.dm.messages(B.id.pk))[0], 'changed words');
  await until(async () => (await B.dm.messages(A.id.pk))[0].text === 'changed words', 'edited');
  await A.dm.remove(B.id.pk, (await A.dm.messages(B.id.pk))[0]);
  await until(async () => (await B.dm.messages(A.id.pk))[0].deleted, 'deleted');
  // a new device of B's reads the relay newest first: the deletion before the edit before the message
  const C = await device(r, B.id);
  await until(async () => (await C.dm.messages(A.id.pk)).length === 1, 'C has the conversation');
  const [m] = await C.dm.messages(A.id.pk);
  assert.equal(m.id, hello.id);
  assert.equal(m.deleted, true);
  assert.ok(!JSON.stringify(await C.db.chatAll()).includes('words'), 'neither text kept');
  A.stop();
  B.stop();
  C.stop();
});

test('disappearing messages: the timer for both sides, NIP-40 on the message and both wraps, gone from the store on time', async () => {
  const r = relay();
  const A = await device(r);
  const B = await device(r);
  await B.dm.setTimer(A.id.pk, 3600);
  await until(async () => (await A.dm.timerOf(B.id.pk)) === 3600, 'A has B’s timer');
  assert.deepEqual(texts(await A.dm.messages(B.id.pk)), ['(timer 3600)'], 'a line says it was set');
  const sent = await A.dm.send(B.id.pk, 'gone in an hour');
  const exp = Number(sent.tags.find((t) => t[0] === 'expiration')[1]);
  assert.ok(Math.abs(exp - (Math.floor(Date.now() / 1000) + 3600)) <= 2);
  const wraps = r.events.filter((e) => e.kind === KINDS.GIFT_WRAP && e.tags.some((t) => t[0] === 'expiration' && t[1] === String(exp)));
  assert.equal(wraps.length, 2, 'the reader’s wrap and the writer’s own');
  await until(async () => (await B.dm.messages(A.id.pk)).some((m) => m.text === 'gone in an hour'), 'B has it');
  const onB = (await B.dm.messages(A.id.pk)).find((m) => m.text === 'gone in an hour');
  assert.equal(onB.expires, exp);
  await B.dm.react(A.id.pk, onB, '👍');
  await until(async () => (await A.dm.messages(B.id.pk)).at(-1).reactions?.length === 1, 'the reaction on A');
  assert.equal((await A.db.changes(B.id.pk)).find((c) => c.type === 'react').expires, exp, 'the reaction goes with the message');

  // an hour later (the store is asked with a later time): the message, its reaction and both wraps are gone
  const later = exp + 1;
  assert.ok((await B.db.purgeExpired(later)) >= 3);
  assert.equal(await B.db.getMessage(onB.id), null);
  assert.equal((await B.db.changes(A.id.pk)).length, 0);
  assert.equal((await B.db.query([{ kinds: [KINDS.GIFT_WRAP] }])).filter((w) => w.tags.some((t) => t[0] === 'expiration')).length, 0);
  // the line about the timer stays; an expired wrap is not taken again
  assert.deepEqual(texts(await B.dm.messages(A.id.pk)), ['(timer 3600)']);
  const old = nip59.wrapEvent({ kind: 14, content: 'x', tags: [['p', B.id.pk]] }, hexToBytes(A.id.sk), B.id.pk);
  assert.equal(await B.db.put({ ...old, tags: [...old.tags, ['expiration', '1']] }), 'ignored');

  await A.dm.setTimer(B.id.pk, 0);
  await until(async () => (await B.dm.timerOf(A.id.pk)) === 0, 'off on B');
  const stays = await A.dm.send(B.id.pk, 'stays');
  assert.ok(!stays.tags.some((t) => t[0] === 'expiration'));
  A.stop();
  B.stop();
});

test('a group: replies and changes inside its seals, the host’s timer, pinned conversations, the search', async () => {
  const r = relay();
  const A = await device(r, { sk: bytesToHex(generateSecretKey()), alias: 'Ada' });
  const B = await device(r, { sk: bytesToHex(generateSecretKey()), alias: 'Bo' });
  const pub = await A.groups.create('Crew', { myName: 'Ada' });
  await A.groups.invite(pub, [B.id.pk]);
  await until(() => B.groups.invites().length === 1, 'B is invited');
  await B.groups.acceptInvite(B.groups.invites()[0].id);
  await until(() => A.groups.members(pub).length === 2, 'B is in');

  const first = await A.groups.say(pub, 'meeting at noon');
  await until(async () => (await B.dm.messages(pub)).some((m) => m.text === 'meeting at noon'), 'B reads it');
  await B.groups.say(pub, 'see you there', { reply: first.id });
  await until(async () => (await A.dm.messages(pub)).length === 2, 'A has the reply');
  let onA = await A.dm.messages(pub);
  assert.equal(onA[1].replyTo.text, 'meeting at noon');
  const outer = r.events.filter((e) => e.pubkey === pub && e.kind === KINDS.GROUP_MESSAGE);
  assert.ok(!JSON.stringify(outer).includes('noon'), 'the relay sees no text');

  await B.groups.react(pub, onA[0], '👍');
  await A.groups.edit(pub, onA[0], 'meeting at one');
  await B.groups.pin(pub, onA[0], true);
  await until(async () => (await A.dm.messages(pub))[0].text === 'meeting at one' && (await A.dm.messages(pub))[0].reactions.length === 1, 'changes on A');
  assert.equal((await A.dm.pinned(pub)).length, 1);
  assert.ok(r.events.filter((e) => e.pubkey === pub).every((e) => [KINDS.GROUP_MESSAGE, KINDS.GROUP_INFO, KINDS.GROUP_JOIN].includes(e.kind)), 'to the relay, a change is a message like any other');
  // B cannot edit A's message
  onA = await A.dm.messages(pub);
  await B.groups.publish(B.groups.entry(pub), KINDS.GROUP_MESSAGE, 'forged', { inner: KINDS.CHAT_EDIT, tags: [['e', first.id]] });
  await tick(80);
  assert.equal((await A.dm.messages(pub))[0].text, 'meeting at one');

  // the host's timer: messages carry NIP-40 inside and out
  await assert.rejects(B.groups.setTimer(pub, 300), /only the host/);
  await A.groups.setTimer(pub, 300);
  await until(() => B.groups.timerOf(pub) === 300, 'B has the timer');
  assert.ok((await B.dm.messages(pub)).some((m) => m.system === 'timer' && m.timer === 300));
  const quick = await B.groups.say(pub, 'quick one');
  const exp = Number(quick.tags.find((t) => t[0] === 'expiration')[1]);
  const ev = r.events.find((e) => e.pubkey === pub && e.tags.some((t) => t[0] === 'expiration'));
  assert.equal(Number(ev.tags.find((t) => t[0] === 'expiration')[1]), exp);
  await until(async () => (await A.dm.messages(pub)).some((m) => m.text === 'quick one'), 'A reads it');
  await A.db.purgeExpired(exp + 1);
  assert.ok(!(await A.dm.messages(pub)).some((m) => m.text === 'quick one'));
  await A.groups.rename(pub, 'Crew 2');
  await until(() => B.groups.info(pub)?.name === 'Crew 2', 'renamed');
  assert.equal(B.groups.timerOf(pub), 300, 'a new name keeps the timer');

  // pinned conversations follow the account (the chat's settings)
  await A.groups.setPinned(pub, true);
  await A.groups.setPinned(B.id.pk, true);
  assert.deepEqual(A.groups.pinned(), [B.id.pk, pub]);
  await A.groups.setPinned(pub, false);
  assert.deepEqual(A.groups.pinned(), [B.id.pk]);

  // the search: this device's messages, edited text, accents aside; deleted ones not
  await A.dm.send(B.id.pk, 'Café at the station?');
  await until(async () => (await A.dm.search('cafe')).length === 1, 'found without the accent');
  assert.equal((await A.dm.search('meeting one'))[0].text, 'meeting at one', 'the text as edited');
  assert.equal((await A.dm.search('noon')).length, 0, 'not the old text');
  assert.equal((await A.dm.search('   ')).length, 0);
  A.stop();
  B.stop();
});
