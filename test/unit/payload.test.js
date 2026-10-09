import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK, chunkCount, chunkLength, hashBlob, rootOf, fingerprint, formatBytes, Meter } from '../../apps/payload/transfer.js';
import { encodeFrame, decodeFrame, roomKeys, seal, unseal, randomSecret, sha256 } from '../../shared/p2p.js';

test('chunk math', () => {
  assert.equal(chunkCount(0), 1);
  assert.equal(chunkCount(1), 1);
  assert.equal(chunkCount(CHUNK), 1);
  assert.equal(chunkCount(CHUNK + 1), 2);
  assert.equal(chunkLength(0, 0), 0);
  assert.equal(chunkLength(CHUNK + 5, 0), CHUNK);
  assert.equal(chunkLength(CHUNK + 5, 1), 5);
  assert.equal(chunkLength(CHUNK + 5, 2), -1);
});

test('hashes chunks and the root changes with any byte', async () => {
  const data = new Uint8Array(CHUNK * 2 + 100).map((_, i) => i % 251);
  const a = await hashBlob(new Blob([data]));
  assert.equal(a.hashes.length, 3);
  assert.equal(a.root, await rootOf(a.hashes));
  data[CHUNK + 7] ^= 1;
  const b = await hashBlob(new Blob([data]));
  assert.notEqual(a.root, b.root);
  assert.deepEqual(a.hashes[0], b.hashes[0]);
  assert.notDeepEqual(a.hashes[1], b.hashes[1]);
  const empty = await hashBlob(new Blob([]));
  assert.deepEqual(empty.hashes[0], await sha256(new Uint8Array(0)));
});

test('formats', () => {
  assert.equal(fingerprint('AbCd-EfGh_IjKlMnOpQrSt'), 'AbCd-EfGh-IjKl-MnOp');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(25 * 1024 * 1024), '25 MB');
  const m = new Meter(1000);
  m.add(0, 0);
  m.add(500, 500);
  assert.equal(m.rate(500), 1000);
});

test('frames carry a header and optional bytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 250]);
  const f = decodeFrame(encodeFrame({ t: 'chunk', i: 3 }, bytes));
  assert.deepEqual(f.msg, { t: 'chunk', i: 3 });
  assert.deepEqual(f.bytes, bytes);
  assert.equal(decodeFrame(encodeFrame({ t: 'x' })).bytes, null);
  assert.throws(() => decodeFrame(new Uint8Array([0, 0, 0, 99, 1])));
});

test('room keys: same secret, same room; tampering is detected', async () => {
  const s = randomSecret();
  const a = await roomKeys(s);
  const b = await roomKeys(s);
  const c = await roomKeys(randomSecret());
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  const sealed = await seal(a.key, new Uint8Array([9, 8, 7]));
  assert.deepEqual(await unseal(b.key, sealed), new Uint8Array([9, 8, 7]));
  assert.equal(await unseal(c.key, sealed), null);
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
  assert.equal(await unseal(a.key, flipped), null);
});
