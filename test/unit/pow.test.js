import test from 'node:test';
import assert from 'node:assert/strict';
import { minePow, mineNonce, mineNonceSubtle, pickMiner, hasPow, powOf } from '../../shared/pow.js';
import { getEventHash, finalizeEvent, generateSecretKey, getPublicKey } from '../../shared/nostr.mjs';

const sk = generateSecretKey();
const template = {
  kind: 30810,
  pubkey: getPublicKey(sk),
  created_at: 1760000000,
  tags: [
    ['d', 'x1'],
    ['t', 'react'],
  ],
  content: JSON.stringify({ title: 'hi "quoted" ünïcode 🙂', text: 'nonce-looking text 123' }),
};

test('mining yields a nonce tag and an id that meets the target and matches the canonical hash', async () => {
  const mined = await minePow(template, 12);
  assert.equal(mined.id, getEventHash(mined), 'the patched-bytes hash equals the canonical serialisation');
  assert.ok(powOf(mined) >= 12);
  assert.ok(hasPow(mined, 12));
  assert.ok(!hasPow(mined, 40), 'a higher bar is not met');
  assert.deepEqual(mined.tags.slice(0, 2), template.tags, 'the event’s own tags stay first');
  assert.equal(mined.tags.at(-1)[2], '12', 'the nonce tag states the target');
  const signed = finalizeEvent(mined, sk);
  assert.equal(signed.id, mined.id, 'signing keeps the mined id');
});

test('workers split the nonce space by stride and events without the work are refused', () => {
  const a = mineNonce(template, 6, { start: 0, stride: 2 });
  const b = mineNonce(template, 6, { start: 1, stride: 2 });
  assert.equal(Number(a.event.tags.at(-1)[1]) % 2, 0);
  assert.equal(Number(b.event.tags.at(-1)[1]) % 2, 1);
  const bare = { ...template, id: getEventHash(template) };
  assert.ok(!hasPow(bare, 1), 'no nonce tag, no work');
  const claimsLess = { ...a.event, tags: [...template.tags, ['nonce', a.event.tags.at(-1)[1], '2']] };
  claimsLess.id = getEventHash(claimsLess);
  assert.ok(!hasPow(claimsLess, 6), 'a nonce tag targeting less than the bar does not count');
  assert.ok(hasPow(a.event, 0), 'zero bits always pass');
  assert.throws(() => mineNonce({ ...template, pubkey: undefined }, 4), /pubkey/);
});

test('the native-hash miner finds the same kind of nonce and the picker answers one of the two', async () => {
  const { event, tried } = await mineNonceSubtle(template, 10, { start: 3, stride: 5 });
  assert.equal(event.id, getEventHash(event));
  assert.ok(hasPow(event, 10));
  assert.equal((Number(event.tags.at(-1)[1]) - 3) % 5, 0, 'stays on its stride');
  assert.ok(tried >= 1);
  assert.ok(['subtle', 'sync'].includes(await pickMiner(template)));
});
