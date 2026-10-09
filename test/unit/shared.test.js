import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvent, getPublicKey, hexToBytes, bytesToHex, generateSecretKey } from '../../shared/nostr.mjs';
import { KINDS, addressOf, supersedes, stamp, makeAddressable, seal, open, deriveKey, fingerprint, isHex64 } from '../../shared/events.js';
import { deriveLookup, buildAccountEvent, openAccountEvent, importKey, nsec, npub, exportEncrypted, normalizeUsername, selfKey } from '../../shared/account.js';

const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(hexToBytes(sk));

test('addresses and ordering', () => {
  const ev = makeAddressable(KINDS.LOADOUT_ITEM, 'abc', 'x', sk);
  assert.ok(verifyEvent(ev));
  assert.equal(ev.pubkey, pk);
  assert.equal(addressOf(ev), `${KINDS.LOADOUT_ITEM}:${pk}:abc`);
  assert.equal(addressOf({ kind: 1, pubkey: pk, tags: [] }), null);
  const older = { created_at: 5, id: 'b' };
  const newer = { created_at: 6, id: 'a' };
  assert.ok(supersedes(newer, older) && !supersedes(older, newer));
  assert.ok(supersedes({ created_at: 5, id: 'a' }, { created_at: 5, id: 'b' }), 'equal time → lower id wins');
});

test('timestamps per address only move forward', () => {
  const a = stamp('x');
  const b = stamp('x');
  const c = stamp('x');
  assert.ok(b > a && c > b);
  assert.ok(stamp('y') <= b, 'other addresses are independent');
  const e1 = makeAddressable(KINDS.LOADOUT_ITEM, 'same', '1', sk);
  const e2 = makeAddressable(KINDS.LOADOUT_ITEM, 'same', '2', sk);
  assert.ok(supersedes(e2, e1), 'two edits within a second keep their order');
});

test('seal and open: small, large (compressed), wrong key', async () => {
  const key = deriveKey(sk, 'test');
  assert.equal(key.length, 32);
  assert.deepEqual(deriveKey(sk, 'test'), key, 'deterministic');
  assert.notDeepEqual(deriveKey(sk, 'other'), key);
  const small = await seal(key, { t: 'milk', q: 2 });
  assert.deepEqual(await open(key, small), { t: 'milk', q: 2 });
  const big = 'Lorem ipsum dolor sit amet, '.repeat(4000);
  const sealed = await seal(key, { md: big });
  assert.ok(sealed.length < big.length / 4, `compressed (${sealed.length} chars for ${big.length})`);
  assert.equal((await open(key, sealed)).md, big);
  await assert.rejects(open(deriveKey(sk, 'other'), small));
  const tampered = small.slice(0, -2) + (small.at(-2) === 'A' ? 'B' : 'A') + small.at(-1);
  await assert.rejects(open(key, tampered));
});

test('username + password derive a stable lookup key', async () => {
  const a = await deriveLookup('Ann', 'correct horse battery');
  const b = await deriveLookup('ann ', 'correct horse battery');
  const c = await deriveLookup('ann', 'correct horse batterx');
  assert.equal(a.lookupPk, b.lookupPk, 'case and whitespace do not matter');
  assert.notEqual(a.lookupPk, c.lookupPk, 'a different password is a different address');
  assert.equal(a.name, 'ann');
  assert.throws(() => normalizeUsername('a'), /3–40/);
  assert.throws(() => normalizeUsername('bad name!'), /3–40/);
});

test('account event round-trips the key and hides it from others', async () => {
  const lookup = await deriveLookup('ann', 'correct horse battery');
  const ev = await buildAccountEvent(lookup, sk);
  assert.ok(verifyEvent(ev));
  assert.equal(ev.kind, KINDS.ACCOUNT);
  assert.equal(ev.pubkey, lookup.lookupPk);
  assert.ok(!JSON.stringify(ev).includes(sk), 'secret key is not in the clear');
  assert.deepEqual(await openAccountEvent(ev, lookup.wrapKey), { sk, alias: 'ann' });
  const other = await deriveLookup('ann', 'wrong password here');
  assert.equal(await openAccountEvent(ev, other.wrapKey), null);
});

test('key import and export forms', () => {
  assert.equal(importKey(nsec(sk)), sk);
  assert.equal(importKey(sk.toUpperCase()), sk);
  const enc = exportEncrypted(sk, 'pw for export');
  assert.ok(enc.startsWith('ncryptsec1'));
  assert.equal(importKey(enc, 'pw for export'), sk);
  assert.throws(() => importKey(enc, 'nope'), /Wrong password/);
  assert.throws(() => importKey('hello'), /Paste/);
  assert.ok(npub(pk).startsWith('npub1'));
  assert.equal(selfKey(sk).length, 32);
  assert.equal(fingerprint(pk), `${pk.slice(0, 4)}-${pk.slice(4, 8)}-${pk.slice(8, 12)}`);
  assert.ok(isHex64(pk) && !isHex64(pk + 'a'));
});
