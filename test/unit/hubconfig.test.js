// hub.local.json: what a host may change in a built hub, and what is ignored.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { applyHubConfig, describeHub } from '../../shared/hubconfig.js';
import { resolveSpaces, SPACES, spaceAddress, spaceKey } from '../../shared/spaces.js';
import { getPublicKey, hexToBytes } from '../../shared/nostr.mjs';

const before = JSON.parse(JSON.stringify({ relays: DISTRIBUTION.relays, publicRelays: DISTRIBUTION.publicRelays, policy: DISTRIBUTION.policy }));
const restore = () => Object.assign(DISTRIBUTION, JSON.parse(JSON.stringify(before)));

test('relays, public relays and the policy are taken from the host', () => {
  const applied = applyHubConfig({ relays: ['wss://relay.sh3.home'], publicRelays: ['wss://nos.lol'], policy: { relays: 'locked', requireHub: true } });
  assert.deepEqual(applied.relays, ['wss://relay.sh3.home']);
  assert.deepEqual(DISTRIBUTION.relays, ['wss://relay.sh3.home']);
  assert.deepEqual(DISTRIBUTION.publicRelays, ['wss://nos.lol']);
  assert.equal(DISTRIBUTION.policy.relays, 'locked');
  assert.equal(DISTRIBUTION.policy.requireHub, true);
  assert.equal(DISTRIBUTION.policy.userMounts, false, 'what the host did not say stays as built');
  restore();
});

test('malformed values are ignored, one by one', () => {
  const applied = applyHubConfig({ relays: ['http://not-a-relay'], policy: { relays: 'fixed', requireHub: 'yes' }, publicRelays: 'wss://x' });
  assert.deepEqual(applied, { policy: before.policy }, 'the policy object was looked at, nothing in it was valid');
  assert.deepEqual(DISTRIBUTION.relays, before.relays);
  assert.deepEqual(applyHubConfig(null), {});
  assert.deepEqual(applyHubConfig('nope'), {});
  restore();
});

test('a host says which mounts ask for an account, and may ask for one everywhere', () => {
  const applied = applyHubConfig({ accountMounts: ['market'], policy: { requireAccount: true } });
  assert.deepEqual(applied.accountMounts, ['market']);
  assert.equal(DISTRIBUTION.policy.requireAccount, true);
  assert.deepEqual(applyHubConfig({ accountMounts: [1, 2] }), {}, 'a list of something else changes nothing');
  restore();
});

test('a host sets a space’s relays; the space’s network follows; malformed lists are ignored', () => {
  const [space] = resolveSpaces({ id: 'acme', spaces: [{ id: 'jobs', name: 'Jobs' }] });
  assert.equal(space.network, null, 'no relays of its own as built');
  SPACES.push(space);
  try {
    const applied = applyHubConfig({ spaces: { jobs: { relays: ['wss://relay.sh3.home/'] }, nope: { relays: ['wss://x'] }, bad: 'wss://x' } });
    assert.deepEqual(applied.spaces, { jobs: { relays: ['wss://relay.sh3.home'] } }, 'only the space the hub has, trailing slash dropped');
    assert.deepEqual(space.relays, ['wss://relay.sh3.home']);
    assert.equal(space.network, 'space:jobs');
    assert.deepEqual(applyHubConfig({ spaces: { jobs: { relays: ['http://no'] } } }), {}, 'a bad list changes nothing');
    assert.equal(space.network, 'space:jobs');
    applyHubConfig({ spaces: { jobs: { relays: [] } } });
    assert.equal(space.network, null, 'an empty list puts the space back on its mount’s network');
  } finally {
    SPACES.splice(SPACES.indexOf(space), 1);
    restore();
  }
});

test('hub.json describes the hub as built, its spaces with their addresses', () => {
  const owner = getPublicKey(hexToBytes(spaceKey('x', 'jobs')));
  const h = describeHub({ id: 'x', name: 'X', relays: ['wss://a'], spaces: [{ id: 'jobs', name: 'Jobs', relays: ['wss://s'] }], mounts: [{ id: 'jobs', app: 'notices', space: 'jobs' }] }, { version: '1.0.0' });
  assert.deepEqual(h.spaces, [{ id: 'jobs', address: spaceAddress(owner, 'jobs'), owner, owned: false, name: 'Jobs', description: '', relays: ['wss://s'], moderators: [], adult: false }]);
  assert.equal(h.mounts[0].space, 'jobs');
  const d = describeHub({ id: 'x', name: 'X', relays: ['wss://a'], mounts: [{ id: 'chat', app: 'chat', network: 'public' }, { id: 'boards', app: 'boards' }] }, { version: '1.0.0', framework: '0.15.0' });
  assert.equal(d.version, '1.0.0');
  assert.equal(d.framework, '0.15.0');
  assert.deepEqual(d.policy, { userMounts: false, relays: 'open', requireHub: false, requireAccount: false });
  assert.deepEqual(
    d.mounts.map((m) => m.network),
    ['public', 'hub'],
  );
});
