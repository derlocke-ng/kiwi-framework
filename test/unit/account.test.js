// Switching identities on a device: a device key is kept aside for apps to
// carry their data from; an account is never, so nothing of one account
// follows a sign-in to another on the same device.
import test from 'node:test';
import assert from 'node:assert/strict';

// account.js keeps the identity in localStorage; node has none.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { loadIdentity, adoptIdentity, previousIdentities, forgetIdentity, pubkeyOf } = await import('../../shared/account.js');
const { generateSecretKey, bytesToHex } = await import('../../shared/nostr.mjs');

const key = () => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: pubkeyOf(sk) };
};

test('signing in from a device key keeps that key aside; signing out and in again keeps only the new device key', () => {
  mem.clear();
  const device = loadIdentity();
  assert.equal(device.alias, null);
  const main = { ...key(), alias: 'main', accountPk: key().pk, created: 1 };
  adoptIdentity(main);
  assert.deepEqual(
    previousIdentities().map((p) => p.pk),
    [device.pk],
    'the device key is what apps carry from',
  );
  forgetIdentity();
  const fresh = loadIdentity();
  assert.notEqual(fresh.pk, main.pk);
  const test2 = { ...key(), alias: 'test', accountPk: key().pk, created: 2 };
  adoptIdentity(test2);
  const prev = previousIdentities().map((p) => p.pk);
  assert.ok(!prev.includes(main.pk), 'the account signed out of is not a source for the next one');
  assert.ok(prev.includes(fresh.pk), 'the device key between them is');
});

test('an account is never kept aside, even when another identity replaces it directly', () => {
  mem.clear();
  loadIdentity();
  const main = { ...key(), alias: 'main', accountPk: key().pk, created: 1 };
  adoptIdentity(main);
  const other = { ...key(), alias: 'other', accountPk: key().pk, created: 2 };
  adoptIdentity(other); // a restore, or any future path that switches without signing out
  assert.ok(!previousIdentities().some((p) => p.pk === main.pk), 'main’s boards cannot follow into other');
  const pasted = { ...key(), alias: null, accountPk: null, imported: true, created: 3 };
  adoptIdentity(pasted);
  assert.ok(!previousIdentities().some((p) => p.pk === other.pk), 'nor an account’s into a pasted key');
});

test('a pasted key counts as a device key: what it had comes along to an account made from it', () => {
  mem.clear();
  loadIdentity();
  const pasted = { ...key(), alias: null, accountPk: null, imported: true, created: 1 };
  adoptIdentity(pasted);
  const account = { ...pasted, alias: 'me', accountPk: key().pk };
  adoptIdentity(account); // same key, now an account: nothing to carry, nothing kept twice
  assert.ok(!previousIdentities().some((p) => p.pk === pasted.pk));
  const next = { ...key(), alias: null, accountPk: null, created: 2 };
  forgetIdentity();
  loadIdentity();
  adoptIdentity(next);
  assert.ok(!previousIdentities().some((p) => p.pk === account.pk), 'the account made from the pasted key is not a source either');
});
