// Account settings are one event per namespace and the newest wins, so a change waits for the relays'
// first answer and goes out on top of the newest event: a device that just started never puts back its old
// copy over what another device changed. A change made on a page that went away is published by the next.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { AccountSettings } = await import('../../shared/settings.js');
const { KINDS, makeAddressable, open, seal } = await import('../../shared/events.js');
const { selfKey } = await import('../../shared/account.js');
const { bytesToHex, generateSecretKey, getPublicKey, matchFilters } = await import('../../shared/nostr.mjs');

const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(Buffer.from(sk, 'hex'));
const id = { sk, pk };

/** A device: its store, a relay subscription the test answers by hand, and what it published. */
function device() {
  const events = [];
  const listeners = new Set();
  const published = [];
  const subs = [];
  const db = {
    put: async (ev) => {
      events.push(ev);
      for (const fn of listeners) fn(ev, 'hub');
    },
    query: async (filters) => events.filter((e) => matchFilters(filters, e)),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  const pool = { online: true, subscribe: (_f, handlers) => (subs.push(handlers), { close() {} }) };
  const sync = { publish: async (ev) => (published.push(ev), db.put(ev)) };
  return { net: { db, pool, sync }, published, relay: (ev) => subs.forEach((h) => h.onevent(ev)), eose: () => subs.forEach((h) => h.oneose?.('wss://r')) };
}

const event = async (data, at) => ({ ...makeAddressable(KINDS.SETTINGS, 'suite', await seal(selfKey(sk), data), sk), created_at: at });
const read = async (ev) => open(selfKey(sk), ev.content);
const until = async (fn) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

test('a change made before the relays answered goes out on top of the newest event, not over it', async () => {
  mem.clear();
  mem.set(`wjs.settings.suite.${pk.slice(0, 16)}`, JSON.stringify({ appOrder: ['loadout'], u: 1 })); // this device's old copy
  const B = device();
  const s = await new AccountSettings(id, B.net, 'suite').start();
  const writing = s.set({ devices: { b: { name: 'B', seen: 2 } } }); // the device records itself as it starts
  assert.deepEqual(s.get('devices'), { b: { name: 'B', seen: 2 } }, 'shown at once');
  assert.equal(B.published.length, 0, 'not published before the relays answered');
  const fromA = await event({ appOrder: ['pongjs', 'loadout'], u: 5 }, Math.floor(Date.now() / 1000));
  B.relay(fromA); // the other device's change arrives
  B.net.db.put(fromA);
  B.eose();
  await writing;
  assert.equal(B.published.length, 1);
  const sent = await read(B.published[0]);
  assert.deepEqual(sent.appOrder, ['pongjs', 'loadout'], 'the other device’s change is kept');
  assert.deepEqual(sent.devices, { b: { name: 'B', seen: 2 } }, 'and this one’s is added');
  assert.deepEqual(s.get('appOrder'), ['pongjs', 'loadout']);
});

test('a change made on a page that went away before it was published goes out from the next page', async () => {
  mem.clear();
  const first = device();
  const s1 = await new AccountSettings(id, first.net, 'suite').start();
  s1.set({ lang: 'de' }); // the page goes away before the relays answer
  const next = device();
  const s2 = await new AccountSettings(id, next.net, 'suite').start();
  assert.equal(s2.get('lang'), 'de', 'the next page shows it');
  next.eose();
  await until(() => next.published.length > 0);
  assert.equal((await read(next.published[0])).lang, 'de', 'and publishes it');
});

test('a slow store: the relays’ answer counts once their events are stored and read, so a change does not go out over them', async () => {
  mem.clear();
  const B = device();
  const put = B.net.db.put;
  B.net.db.put = async (ev) => {
    await new Promise((r) => setTimeout(r, 200)); // a busy device: the store takes its time
    return put(ev);
  };
  const s = await new AccountSettings(id, B.net, 'suite').start();
  const writing = s.set({ devices: { b: { name: 'B', seen: 2 } } }); // a device signing in records itself
  const account = await event({ alias: 'ada', accountPk: 'f'.repeat(64), u: 5 }, Math.floor(Date.now() / 1000));
  B.relay(account);
  B.eose(); // the relay is done at once; the store is not
  await writing;
  const sent = await read(B.published.at(-1));
  assert.equal(sent.alias, 'ada', 'the account’s name stays in the newest version');
  assert.deepEqual(sent.devices, { b: { name: 'B', seen: 2 } });
});
