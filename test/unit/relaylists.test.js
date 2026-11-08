// Relay lists and hints: what a list says, where a sealed note goes, what a link carries.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { buildInboxRelays, buildRelayList, hintQuery, inboxFromLists, readHints, RelayLists, relaysTag, toHints } = await import('../../shared/relaylists.js');
const { PeerNetworks } = await import('../../shared/peers.js');
const { bytesToHex, generateSecretKey, getPublicKey, matchFilters } = await import('../../shared/nostr.mjs');

const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(Buffer.from(sk, 'hex'));

test('hints: no scheme in a link, wss implied, ws for localhost, three at most, anything else dropped', () => {
  assert.deepEqual(toHints(['wss://a.example', 'ws://localhost:7000', 'wss://b.example', 'wss://c.example']), ['a.example', 'localhost:7000', 'b.example']);
  assert.equal(hintQuery(['wss://a.example', 'ws://localhost:7000']), 'r=a.example&r=localhost%3A7000');
  assert.deepEqual(readHints(new URLSearchParams('r=a.example&r=localhost%3A7000')), ['wss://a.example', 'ws://localhost:7000']);
  assert.deepEqual(readHints(new URLSearchParams('r=https%3A%2F%2Fx.example&r=')), []);
});

test('an inbox list wins over a relay list; a relay list gives its read relays', () => {
  const list = { ...buildRelayList(['wss://w.example'], sk), tags: [['r', 'wss://rw.example'], ['r', 'wss://w.example', 'write'], ['r', 'wss://r.example', 'read']] };
  assert.deepEqual(inboxFromLists([list]), ['wss://rw.example', 'wss://r.example']);
  assert.deepEqual(inboxFromLists([list, buildInboxRelays(['wss://inbox.example'], sk)]), ['wss://inbox.example']);
  assert.deepEqual(inboxFromLists([]), []);
});

test('a sealed note’s relays tag is read back as relays', () => {
  assert.deepEqual(relaysTag({ tags: [['p', pk], ['relays', 'wss://a.example', 'not a relay', 'ws://localhost:1']] }), ['wss://a.example', 'ws://localhost:1']);
  assert.deepEqual(relaysTag({ tags: [] }), []);
});

/** A pool with one network and one guest relay, both in memory. */
function pools() {
  const own = [];
  const guest = [];
  const pool = {
    networks: { hub: ['wss://mine.example'] },
    urlsOf: () => ['wss://mine.example'],
    onlineOf: () => true,
    publish: async (ev) => (own.push(ev), { ok: ['wss://mine.example'], failed: [] }),
    fetch: async (filters) => own.filter((e) => matchFilters(filters, e)),
    fetchAt: async (_urls, filters) => guest.filter((e) => matchFilters(filters, e)),
    publishAt: async (urls, ev) => (guest.push({ ...ev, at: urls }), urls),
    guestUrls: (urls) => urls.filter((u) => u !== 'wss://mine.example'),
  };
  return { pool, own, guest };
}

test('my lists go to the network’s relays once, and again when the relays change', async () => {
  mem.clear();
  const { pool, own } = pools();
  const lists = new RelayLists({ sk, pk }, pool);
  await lists.publishOwn();
  assert.deepEqual(own.map((e) => e.kind).sort(), [10002, 10050]);
  await lists.publishOwn();
  assert.equal(own.length, 2, 'not again while they are current');
  pool.urlsOf = () => ['wss://mine.example', 'wss://second.example'];
  await lists.publishOwn();
  assert.equal(own.length, 4, 'again when the relays change');
});

test('a sealed note goes where the reader said they read, besides the network’s own relays', async () => {
  mem.clear();
  const { pool, guest } = pools();
  const peers = new PeerNetworks(pk);
  const reader = getPublicKey(generateSecretKey());
  peers.learnRelays(reader, 'hub', ['wss://theirs.example', 'wss://mine.example']);
  const lists = new RelayLists({ sk, pk }, pool, { peers });
  const sent = await lists.deliver(reader, 'hub', { id: 'x', kind: 1059 });
  assert.deepEqual(sent, ['wss://theirs.example'], 'only the relay that is not ours already');
  assert.equal(guest.length, 1);
});
