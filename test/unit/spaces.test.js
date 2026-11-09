// Spaces (shared/spaces.js): addresses, the derived key of a space nobody owns, the definition event
// and what is read back from it, posts naming their space, and the live view: the relays' definition
// rules an owned space, a hub seeds the definition of a space nobody owns.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { KINDS, makeAddressable } = await import('../../shared/events.js');
const { buildSpaceDefinition, isModerator, parseSpaceDefinition, readSpaceParam, resolveSpaces, sameDefinition, spaceAddress, spaceKey, spaceOf, spaceQuery, spaceTag, Spaces } = await import('../../shared/spaces.js');
const { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, matchFilters, verifyEvent } = await import('../../shared/nostr.mjs');

const ownerSk = bytesToHex(generateSecretKey());
const ownerPk = getPublicKey(hexToBytes(ownerSk));
const config = {
  id: 'acme',
  spaces: [
    { id: 'jobs', name: 'Jobs board', description: 'Work for hire', relays: ['wss://s.example/', 'wss://s.example'], rules: 'Be concrete.' },
    { id: 'gems', owner: ownerPk, name: 'Gems', moderators: ['b'.repeat(64)], adult: true, langs: ['de', 'en'], region: 'EU' },
    { id: 'Bad Id', name: 'dropped' },
  ],
};

test('a space nobody owns has a key made from the hub’s id and its own; an owned one its owner’s', () => {
  const [jobs, gems, ...rest] = resolveSpaces(config);
  assert.equal(rest.length, 0, 'a space with a bad id is dropped (the build refuses it)');
  assert.equal(spaceKey('acme', 'jobs'), spaceKey('acme', 'jobs'), 'deterministic');
  assert.notEqual(spaceKey('acme', 'jobs'), spaceKey('other', 'jobs'), 'another hub’s space of the same id is another space');
  assert.equal(jobs.owned, false);
  assert.equal(jobs.sk, spaceKey('acme', 'jobs'));
  assert.equal(jobs.owner, getPublicKey(hexToBytes(jobs.sk)));
  assert.equal(jobs.address, spaceAddress(jobs.owner, 'jobs'));
  assert.match(jobs.address, /^34550:[0-9a-f]{64}:jobs$/);
  assert.deepEqual(jobs.relays, ['wss://s.example'], 'normalized, once');
  assert.equal(jobs.network, 'space:jobs', 'relays of its own: a network of its own');
  assert.equal(gems.owned, true);
  assert.equal(gems.sk, null);
  assert.equal(gems.owner, ownerPk);
  assert.equal(gems.network, null, 'no relays: on its mount’s network');
  assert.ok(isModerator(gems, ownerPk) && isModerator(gems, 'b'.repeat(64)) && !isModerator(gems, 'c'.repeat(64)) && !isModerator(null, ownerPk));
});

test('the definition event carries the NIP-72 tags and ours, and reads back the same', () => {
  const [jobs, gems] = resolveSpaces(config);
  const ev = buildSpaceDefinition(gems, ownerSk);
  assert.equal(ev.kind, KINDS.SPACE);
  assert.equal(ev.pubkey, ownerPk);
  assert.ok(verifyEvent(ev));
  assert.deepEqual(ev.tags.find((t) => t[0] === 'd'), ['d', 'gems']);
  assert.deepEqual(ev.tags.find((t) => t[0] === 'p'), ['p', 'b'.repeat(64), '', 'moderator']);
  assert.deepEqual(ev.tags.find((t) => t[0] === 'adult'), ['adult', '1']);
  const back = parseSpaceDefinition(ev);
  assert.equal(back.address, gems.address);
  assert.deepEqual(
    { name: back.name, description: back.description, relays: back.relays, moderators: back.moderators, adult: back.adult, langs: back.langs, region: back.region, rules: back.rules },
    { name: 'Gems', description: '', relays: [], moderators: ['b'.repeat(64)], adult: true, langs: ['de', 'en'], region: 'EU', rules: '' },
  );
  assert.ok(sameDefinition(back, gems));
  assert.ok(!sameDefinition(back, { ...gems, name: 'Stones' }));
  const unowned = parseSpaceDefinition(buildSpaceDefinition(jobs, jobs.sk));
  assert.equal(unowned.owner, jobs.owner);
  assert.deepEqual(unowned.relays, ['wss://s.example']);
  assert.equal(unowned.rules, 'Be concrete.');
  assert.equal(parseSpaceDefinition({ kind: 1, tags: [] }), null);
  assert.equal(parseSpaceDefinition(makeAddressable(KINDS.SPACE, 'Not A Slug', '', ownerSk)), null);
});

test('a post names its space in an a tag; a link names it as s=', () => {
  const [jobs] = resolveSpaces(config);
  assert.deepEqual(spaceTag(jobs), ['a', jobs.address]);
  assert.deepEqual(spaceTag(jobs, 'wss://s.example'), ['a', jobs.address, 'wss://s.example']);
  assert.equal(spaceOf({ tags: [['d', 'x'], spaceTag(jobs), ['a', '30810:abc:def']] }), jobs.address);
  assert.equal(spaceOf({ tags: [['a', '30810:abc:def']] }), null, 'an a tag to something else is not a space');
  assert.equal(spaceOf({ tags: [] }), null);
  const q = spaceQuery(jobs);
  assert.equal(readSpaceParam(new URLSearchParams(q)), jobs.address);
  assert.equal(readSpaceParam(new URLSearchParams('s=garbage')), null);
  assert.equal(readSpaceParam(new URLSearchParams('')), null);
  assert.equal(spaceQuery(null), '');
});

/** A network of one relay the test answers by hand. */
function fakeNet() {
  const events = [];
  const listeners = new Set();
  const published = [];
  const subs = [];
  const db = {
    put: async (ev, network) => {
      events.push(ev);
      for (const fn of listeners) fn(ev, network || 'hub');
    },
    query: async (filters) => events.filter((e) => matchFilters(filters, e)),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  const pool = { subscribe: (_f, handlers) => (subs.push(handlers), { close() {} }) };
  const sync = { publish: async (ev, options) => (published.push({ ev, ...options }), 'ok') };
  return { net: { db, pool, sync }, published, relay: (ev) => subs.forEach((h) => h.onevent(ev)), eose: () => subs.forEach((h) => h.oneose?.('wss://r')) };
}
const until = async (fn) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

test('a hub seeds the definition of a space nobody owns when the relays lack it, and leaves a matching one alone', async () => {
  const spaces = resolveSpaces(config);
  const [jobs] = spaces;
  const X = fakeNet();
  const s = await new Spaces(X.net, { spaces }).start();
  X.eose();
  await until(() => X.published.length > 0);
  assert.equal(X.published.length, 1, 'the space nobody owns, not the owned one');
  assert.equal(X.published[0].network, 'space:jobs', 'on the space’s own network');
  const def = parseSpaceDefinition(X.published[0].ev);
  assert.equal(def.address, jobs.address);
  assert.equal(def.name, 'Jobs board');
  assert.equal(s.definition('jobs').event.id, X.published[0].ev.id, 'and holds what it published');
  // another device of the hub finds that definition on the relay: nothing to publish
  const Y = fakeNet();
  const s2 = await new Spaces(Y.net, { spaces: resolveSpaces(config) }).start();
  Y.relay(X.published[0].ev);
  await Y.net.db.put(X.published[0].ev, 'space:jobs');
  Y.eose();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(Y.published.length, 0, 'the relay’s definition says the same: left alone');
  assert.equal(s2.get('jobs').name, 'Jobs board');
  s.stop();
  s2.stop();
});

test('an owned space takes the relays’ newest definition over the config; a space nobody owns keeps the config', async () => {
  const spaces = resolveSpaces(config);
  const [jobs, gems] = spaces;
  const X = fakeNet();
  const s = await new Spaces(X.net, { spaces }).start();
  let changed = 0;
  s.onChange(() => changed++);
  const older = buildSpaceDefinition({ ...gems, name: 'Old gems', moderators: [] }, ownerSk);
  const newer = buildSpaceDefinition({ ...gems, name: 'Fine gems', moderators: ['c'.repeat(64)], rules: 'No fakes.' }, ownerSk);
  await X.net.db.put(newer, 'hub');
  await X.net.db.put(older, 'hub'); // arriving later, but older: ignored
  assert.equal(s.get('gems').name, 'Fine gems');
  assert.deepEqual(s.get('gems').moderators, ['c'.repeat(64)], 'moderators are the owner’s newest word');
  assert.equal(s.get('gems').rules, 'No fakes.');
  assert.equal(s.get('gems').address, gems.address, 'the address never changes');
  assert.equal(changed, 1, 'one change announced, for the newer one');
  const stranger = buildSpaceDefinition({ ...gems, name: 'Taken over' }, bytesToHex(generateSecretKey()));
  await X.net.db.put(stranger, 'hub');
  assert.equal(s.get('gems').name, 'Fine gems', 'another key’s event is another address: ignored');
  const other = buildSpaceDefinition({ ...jobs, name: 'Renamed by someone' }, jobs.sk);
  await X.net.db.put(other, 'space:jobs');
  assert.equal(s.get('jobs').name, 'Jobs board', 'a space nobody owns shows the hub’s config, whatever the relays say');
  assert.equal(s.definition('jobs').name, 'Renamed by someone', 'but the relays’ definition is known');
  assert.equal(s.get('nope'), null);
  s.stop();
});

test('moderators may be configured as npubs, as people copy them from their account page', async () => {
  const { nip19: n19 } = await import('../../shared/nostr.mjs');
  const pk = 'c'.repeat(64);
  const [s] = resolveSpaces({ id: 'hub', spaces: [{ id: 'grow', moderators: [n19.npubEncode(pk), 'd'.repeat(64), 'npub1nonsense', pk] }] });
  assert.deepEqual(s.moderators, [pk, 'd'.repeat(64)], 'decoded, the broken one left out, once each');
});
