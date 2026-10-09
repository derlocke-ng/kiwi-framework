import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { WebSocket } from 'ws';
import { EventStore, startRelay, addressOf, supersedes } from '../../scripts/nostr-relay.mjs';

useWebSocketImplementation(WebSocket);

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const make = (kind, created_at, d, content = 'x', key = sk) => finalizeEvent({ kind, created_at, tags: d == null ? [] : [['d', d]], content }, key);

test('addresses replaceable and addressable events', () => {
  assert.equal(addressOf(make(1, 1)), null);
  assert.equal(addressOf(make(0, 1)), `0:${pk}:`);
  assert.equal(addressOf(make(30700, 1, 'info')), `30700:${pk}:info`);
  const a = make(30700, 5, 'x');
  const b = make(30700, 6, 'x');
  assert.ok(supersedes(b, a) && !supersedes(a, b));
});

test('store keeps the newest version of an addressable event', () => {
  const store = new EventStore();
  const v1 = make(30701, 10, 'item1', 'one');
  const v2 = make(30701, 11, 'item1', 'two');
  const other = make(30701, 11, 'item2', 'other');
  assert.equal(store.add(v2).stored, true);
  assert.equal(store.add(v1).stored, false, 'older version is ignored');
  assert.equal(store.add(v2).stored, false, 'duplicate is ignored');
  assert.equal(store.add(other).stored, true);
  assert.equal(store.size, 2);
  assert.deepEqual(store.query([{ kinds: [30701], authors: [pk], '#d': ['item1'] }]).map((e) => e.content), ['two']);
  assert.equal(store.add(make(21000, 12, null)).stored, false, 'ephemeral events are not stored');
});

test('queries sort newest first and honour limits', () => {
  const store = new EventStore();
  for (let i = 1; i <= 5; i++) store.add(make(1, i, null, String(i)));
  assert.deepEqual(store.query([{ kinds: [1] }]).map((e) => e.content), ['5', '4', '3', '2', '1']);
  assert.deepEqual(store.query([{ kinds: [1], limit: 2 }]).map((e) => e.content), ['5', '4']);
  assert.deepEqual(store.query([{ kinds: [1], limit: 1 }, { kinds: [1], limit: 3 }]).map((e) => e.content), ['5', '4', '3']);
  assert.deepEqual(store.query([{ kinds: [1], since: 4 }]).map((e) => e.content), ['5', '4']);
});

test('relay accepts, rejects and streams events', async () => {
  const relay = await startRelay({ port: 0, name: 'unit relay' });
  try {
    const info = await (await fetch(`http://localhost:${relay.port}/`, { headers: { accept: 'application/nostr+json' } })).json();
    assert.equal(info.name, 'unit relay');
    assert.deepEqual(info.relay_countries, ['DE']);

    const client = await Relay.connect(relay.url);
    const got = [];
    const eose = new Promise((r) => client.subscribe([{ kinds: [30700], authors: [pk] }], { onevent: (e) => got.push(e.content), oneose: r }));
    await eose;
    assert.deepEqual(got, [], 'nothing stored yet');

    const now = Math.floor(Date.now() / 1000);
    await client.publish(make(30700, now, 'info', 'first'));
    await client.publish(make(30700, now + 1, 'info', 'second'));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, ['first', 'second'], 'live events reach the subscriber');

    const forged = { ...make(30700, now + 2, 'info', 'forged'), sig: '00'.repeat(64) };
    await assert.rejects(client.publish(forged), /bad signature/);

    const reader = await Relay.connect(relay.url);
    const latest = await new Promise((r) => {
      const seen = [];
      reader.subscribe([{ kinds: [30700], authors: [pk] }], { onevent: (e) => seen.push(e.content), oneose: () => r(seen) });
    });
    assert.deepEqual(latest, ['second'], 'only the newest version is kept');
    client.close();
    reader.close();
  } finally {
    await relay.close();
  }
});
