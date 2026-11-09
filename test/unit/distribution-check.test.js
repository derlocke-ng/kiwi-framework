// A distribution's networks and mounts: what the build accepts and what it refuses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDistribution } from '../../shared/distribution-check.js';

const base = { relays: ['wss://a.example'], mounts: [{ id: 'boards', app: 'boards' }] };

test('a hub on its own network alone is sound; so is one with a public area', () => {
  assert.deepEqual(checkDistribution(base), []);
  assert.deepEqual(checkDistribution({ ...base, publicRelays: ['wss://nos.lol'], mounts: [...base.mounts, { id: 'chat', app: 'chat', network: 'public' }], policy: { relays: 'locked', requireHub: true } }), []);
  assert.deepEqual(checkDistribution({ relays: [], mounts: [] }), [], 'the test hubs name their relays later');
});

test('a public mount needs public relays, and public relays need a public mount', () => {
  assert.match(checkDistribution({ ...base, mounts: [{ id: 'chat', app: 'chat', network: 'public' }] }).join(), /names no publicRelays/);
  assert.match(checkDistribution({ ...base, publicRelays: ['wss://nos.lol'] }).join(), /no mount is on the public network/);
});

test('spaces: slugs, listed once, a hex owner or none, relays and moderators well-formed; a mount names a listed space', () => {
  const spaces = [{ id: 'jobs', name: 'Jobs', relays: ['wss://s.example'] }, { id: 'gems', owner: 'a'.repeat(64), moderators: ['b'.repeat(64)] }];
  assert.deepEqual(checkDistribution({ ...base, spaces, mounts: [{ id: 'jobs', app: 'notices', space: 'jobs' }, { id: 'gems', app: 'market', space: 'gems' }] }), []);
  assert.match(checkDistribution({ ...base, spaces: [{ id: 'Jobs!' }] }).join(), /the id is 2–40 lowercase/);
  assert.match(checkDistribution({ ...base, spaces: [{ id: 'jobs' }, { id: 'jobs' }] }).join(), /listed twice/);
  assert.match(checkDistribution({ ...base, spaces: [{ id: 'jobs', owner: 'npub1x' }] }).join(), /owner is a 64-character hex pubkey/);
  assert.match(checkDistribution({ ...base, spaces: [{ id: 'jobs', relays: ['https://x'] }] }).join(), /relays is a list of wss/);
  assert.match(checkDistribution({ ...base, spaces: [{ id: 'jobs', moderators: ['bob'] }] }).join(), /moderators is a list of hex pubkeys/);
  assert.match(checkDistribution({ ...base, mounts: [{ id: 'jobs', app: 'notices', space: 'jobs' }] }).join(), /names a space "jobs" the distribution does not define/);
});

test('the words are checked', () => {
  assert.match(checkDistribution({ ...base, mounts: [{ id: 'x', app: 'x', network: 'vpn' }] }).join(), /'hub' or 'public'/);
  assert.match(checkDistribution({ ...base, policy: { relays: 'fixed' } }).join(), /'open' or 'locked'/);
  assert.match(checkDistribution({ ...base, policy: { requireHub: 'yes' } }).join(), /true or false/);
  assert.match(checkDistribution({ ...base, policy: { requireAccount: 1 } }).join(), /policy.requireAccount: true or false/);
  assert.match(checkDistribution({ ...base, mounts: [{ id: 'x', app: 'x', requireAccount: 'yes' }] }).join(), /requireAccount is true or false/);
  assert.deepEqual(checkDistribution({ ...base, policy: { requireAccount: true }, mounts: [{ id: 'x', app: 'x', requireAccount: true }] }), []);
  assert.match(checkDistribution({ ...base, relays: ['https://a.example'] }).join(), /relays: a list of wss/);
});
