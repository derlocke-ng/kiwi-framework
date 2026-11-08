// Accounts in today's form: the user's key authors the entry at the address only the password finds, so the
// key can retire it. A password change puts the new entry up and retires the old; the first form (the lookup
// key as author) is read, upgraded on sign-in and retired with the old password. An in-memory relay stands
// in for the pool and the sync.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { accountVersion, buildLegacyAccountEvent, changePassword, createAccount, deriveLookup, login, pubkeyOf, upgradeAccount } = await import('../../shared/account.js');
const { addressOf, supersedes } = await import('../../shared/events.js');
const { bytesToHex, generateSecretKey, matchFilters } = await import('../../shared/nostr.mjs');

/** A relay in memory: newest version per address, deletions honoured, read through fetch(). */
function relay() {
  const events = new Map();
  const put = (ev) => {
    if (ev.kind === 5) {
      for (const t of ev.tags) if (t[0] === 'a') for (const [id, e] of events) if (addressOf(e) === t[1] && e.pubkey === t[1].split(':')[1]) events.delete(id);
      return;
    }
    const address = addressOf(ev);
    for (const [id, e] of events) if (address && addressOf(e) === address && e.pubkey === ev.pubkey) (supersedes(ev, e) ? events.delete(id) : null);
    if (![...events.values()].some((e) => address && addressOf(e) === address && e.pubkey === ev.pubkey)) events.set(ev.id, ev);
  };
  return {
    events,
    pool: { online: true, fetch: async (filters) => [...events.values()].filter((e) => matchFilters(filters, e)) },
    sync: { publish: async (ev) => put(ev) },
  };
}

const sk = bytesToHex(generateSecretKey());
const pk = pubkeyOf(sk);
const user = 'unit_user';

test('create, sign in, change the password without the old one, the old password opens nothing', async () => {
  const r = relay();
  const made = await createAccount(r, user, 'first password!', sk);
  assert.equal(made.event.pubkey, pk, 'the user key authors the entry');
  assert.equal(accountVersion(made.event), 2);
  const first = await login(r.pool, user, 'first password!');
  assert.equal(first.sk, sk);
  assert.equal(first.version, 2);
  const changed = await changePassword(r, { skHex: sk, username: user, newPassword: 'second password!', old: { lookupPk: made.lookupPk, version: 2 } });
  assert.notEqual(changed.lookupPk, made.lookupPk);
  const second = await login(r.pool, user, 'second password!');
  assert.equal(second.sk, sk, 'the new password opens the account');
  await assert.rejects(login(r.pool, user, 'first password!'), /Wrong username or password/, 'the old password no longer does');
  await assert.rejects(changePassword(r, { skHex: sk, username: user, newPassword: 'second password!', old: { lookupPk: changed.lookupPk, version: 2 } }), /password you have/);
});

test('an entry in the first form signs in, is carried to today’s form, and is retired with the old password on a change', async () => {
  const r = relay();
  const lookup = await deriveLookup(user, 'legacy password!');
  r.sync.publish(await buildLegacyAccountEvent(lookup, sk));
  const found = await login(r.pool, user, 'legacy password!');
  assert.equal(found.version, 1);
  assert.equal(found.sk, sk);
  await upgradeAccount(r, found.lookup, sk);
  const again = await login(r.pool, user, 'legacy password!');
  assert.equal(again.version, 2, 'the same password now opens today’s form');
  assert.equal(again.event.pubkey, pk);
  assert.ok(![...r.events.values()].some((e) => e.pubkey === lookup.lookupPk && e.content), 'the first form is retired');
  // a device that still thinks the entry is in its first form asks for the old password and retires both forms
  await assert.rejects(changePassword(r, { skHex: sk, username: user, newPassword: 'third password!!', old: { lookupPk: lookup.lookupPk, version: 1 } }), /current password too/);
  await assert.rejects(changePassword(r, { skHex: sk, username: user, newPassword: 'third password!!', oldPassword: 'not it, surely', old: { lookupPk: lookup.lookupPk, version: 1 } }), /not the current password/);
  await changePassword(r, { skHex: sk, username: user, newPassword: 'third password!!', oldPassword: 'legacy password!', old: { lookupPk: lookup.lookupPk, version: 1 } });
  assert.equal((await login(r.pool, user, 'third password!!')).sk, sk);
  await assert.rejects(login(r.pool, user, 'legacy password!'), /Wrong username or password/);
});

test('an entry in today’s form must be published by the key it holds', async () => {
  const r = relay();
  const other = bytesToHex(generateSecretKey());
  const lookup = await deriveLookup(user, 'planted password!');
  // someone else publishing an entry that holds my key, under their own key: not an account of mine
  const { makeAddressable, seal } = await import('../../shared/events.js');
  r.sync.publish(makeAddressable(30790, lookup.lookupPk, await seal(lookup.wrapKey, { v: 2, sk, alias: user }), other, [['v', '2']]));
  await assert.rejects(login(r.pool, user, 'planted password!'), /Wrong username or password/);
});
