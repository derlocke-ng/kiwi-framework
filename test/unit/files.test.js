// Files sent in messages (shared/files.js): encrypted with their own key and nonce, uploaded to a media server,
// described the NIP-17 way (kind 15), opened and checked on the other side.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startBlossom } from '../../scripts/blossom-server.mjs';

const { cleanFile, decryptFile, encryptFile, fileFromRumor, fileSize, fileTags, MAX_FILE, openFile, uploadFile } = await import('../../shared/files.js');
const { sha256Hex } = await import('../../shared/blossom.js');
const { bytesToHex, generateSecretKey } = await import('../../shared/nostr.mjs');

const sk = bytesToHex(generateSecretKey());
const te = new TextEncoder();

test('a file is sealed with a key and a nonce of its own; the wrong key opens nothing', async () => {
  const plain = te.encode('the grow schedule, week 1 to 12');
  const a = await encryptFile(plain);
  const b = await encryptFile(plain);
  assert.equal(a.key.length, 64);
  assert.equal(a.nonce.length, 24);
  assert.notEqual(a.key, b.key, 'a fresh key every time');
  assert.equal(a.data.byteLength, plain.byteLength + 16, 'the ciphertext and its tag, nothing in front (NIP-17)');
  assert.deepEqual(await decryptFile(a.data, a.key, a.nonce), plain);
  await assert.rejects(decryptFile(a.data, b.key, a.nonce));
  await assert.rejects(decryptFile(a.data, a.key, b.nonce));
});

test('uploaded to the first server that takes it, opened and checked on the other side', async () => {
  const server = await startBlossom();
  try {
    const body = te.encode('%PDF-1.7 a small pdf');
    const file = new File([body], 'seed list.pdf', { type: 'application/pdf' });
    const f = await uploadFile(file, { servers: [server.url], sk });
    assert.equal(f.name, 'seed list.pdf');
    assert.equal(f.type, 'application/pdf');
    assert.equal(f.size, body.byteLength);
    assert.equal(f.ox, await sha256Hex(body));
    const stored = server.blobs.get(f.x);
    assert.ok(stored, 'on the server under the hash of what it holds');
    assert.ok(!Buffer.from(stored.data).includes(Buffer.from('PDF')), 'the server holds ciphertext');
    assert.equal(stored.type, 'application/octet-stream', 'and not even the file type');
    assert.deepEqual(await openFile(f), body);
    await assert.rejects(openFile({ ...f, ox: '0'.repeat(64) }), (err) => err.code === 'files.error.changed');
    await assert.rejects(uploadFile({ size: MAX_FILE + 1 }, { servers: [server.url], sk }), (err) => err.code === 'files.error.tooBig');
  } finally {
    await server.close();
  }
});

test('the NIP-17 file message: tags out, the same file back; what is malformed is no file', () => {
  const f = cleanFile({
    url: 'https://media.example/' + 'a'.repeat(64),
    x: 'a'.repeat(64),
    ox: 'b'.repeat(64),
    key: 'c'.repeat(64),
    nonce: 'd'.repeat(24),
    type: 'image/jpeg',
    name: '../week 3/plant.jpg',
    size: 123456,
    dim: '1200x900',
  });
  assert.equal(f.name, '.._week 3_plant.jpg', 'no path in a name');
  // a chat message names its writer in a `name` tag: the file's name must not be taken for it, nor the other way round
  const rumor = { kind: 15, content: f.url, tags: [['p', 'e'.repeat(64)], ['name', 'Ada'], ...fileTags(f)] };
  assert.deepEqual(rumor.tags.find((t) => t[0] === 'encryption-algorithm'), ['encryption-algorithm', 'aes-gcm']);
  assert.deepEqual(fileFromRumor(rumor), f);
  assert.equal(fileFromRumor({ ...rumor, content: 'javascript:alert(1)' }), null, 'only http(s) addresses');
  assert.equal(fileFromRumor({ ...rumor, tags: rumor.tags.filter((t) => t[0] !== 'decryption-key') }), null, 'no key, no file');
  assert.equal(
    fileFromRumor({ ...rumor, tags: rumor.tags.map((t) => (t[0] === 'encryption-algorithm' ? [t[0], 'chacha'] : t)) }),
    null,
    'an algorithm we do not speak',
  );
  assert.equal(cleanFile({ ...f, type: 'text/html; x' }).type, 'application/octet-stream');
});

test('sizes in a person’s language', () => {
  assert.equal(fileSize(532), '532 byte');
  assert.equal(fileSize(1_234_567), '1.2 MB');
  assert.equal(fileSize(1_234_567, 'de'), '1,2 MB');
  assert.equal(fileSize(45_000_000), '45 MB');
});
