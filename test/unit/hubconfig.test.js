// hub.local.json: what a host may change in a built hub, and what is ignored.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { applyHubConfig, describeHub } from '../../shared/hubconfig.js';

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

test('hub.json describes the hub as built', () => {
  const d = describeHub({ id: 'x', name: 'X', relays: ['wss://a'], mounts: [{ id: 'chat', app: 'chat', network: 'public' }, { id: 'boards', app: 'boards' }] }, { version: '1.0.0', framework: '0.15.0' });
  assert.equal(d.version, '1.0.0');
  assert.equal(d.framework, '0.15.0');
  assert.deepEqual(d.policy, { userMounts: false, relays: 'open', requireHub: false });
  assert.deepEqual(
    d.mounts.map((m) => m.network),
    ['public', 'hub'],
  );
});
