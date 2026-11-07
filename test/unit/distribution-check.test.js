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

test('the words are checked', () => {
  assert.match(checkDistribution({ ...base, mounts: [{ id: 'x', app: 'x', network: 'vpn' }] }).join(), /'hub' or 'public'/);
  assert.match(checkDistribution({ ...base, policy: { relays: 'fixed' } }).join(), /'open' or 'locked'/);
  assert.match(checkDistribution({ ...base, policy: { requireHub: 'yes' } }).join(), /true or false/);
  assert.match(checkDistribution({ ...base, relays: ['https://a.example'] }).join(), /relays: a list of wss/);
});
