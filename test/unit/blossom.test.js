import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, bytesToHex, hexToBytes, verifyEvent } from '../../shared/nostr.mjs';
import { normalizeServer, authEvent, authHeader, encryptBlob, decryptBlob, sha256Hex, upload, fetchBlob, removeBlob, probe, openMedia } from '../../shared/blossom.js';
import { startBlossom } from '../../scripts/blossom-server.mjs';

const sk = bytesToHex(generateSecretKey());
const pk = getPublicKey(hexToBytes(sk));
const bytes = (text) => new TextEncoder().encode(text);

test('server addresses: https, paths kept, no trailing slash; plain http only on this machine', () => {
  assert.equal(normalizeServer('blossom.primal.net'), 'https://blossom.primal.net');
  assert.equal(normalizeServer('https://nostrcheck.me/media/'), 'https://nostrcheck.me/media');
  assert.equal(normalizeServer('http://localhost:3300'), 'http://localhost:3300');
  assert.equal(normalizeServer('http://example.org'), null);
  assert.equal(normalizeServer(''), null);
});

test('an upload is authorized by a signed, expiring kind 24242 event for that blob', () => {
  const ev = authEvent({ verb: 'upload', sha256: 'a'.repeat(64), sk });
  assert.ok(verifyEvent(ev));
  assert.equal(ev.kind, 24242);
  assert.equal(ev.pubkey, pk);
  assert.deepEqual(ev.tags.find((t) => t[0] === 't'), ['t', 'upload']);
  assert.deepEqual(ev.tags.find((t) => t[0] === 'x'), ['x', 'a'.repeat(64)]);
  assert.ok(Number(ev.tags.find((t) => t[0] === 'expiration')[1]) > Date.now() / 1000);
  assert.equal(Buffer.from(authHeader(ev).slice(6), 'base64').toString(), JSON.stringify(ev));
});

test('encrypted blobs: random bytes to the server, the original back with the key, nothing without it', async () => {
  const plain = bytes('a photo, honestly');
  const { data, key } = await encryptBlob(plain);
  assert.notDeepEqual(data.subarray(12), plain);
  assert.equal(data.length, 12 + plain.length + 16, 'IV, ciphertext and tag');
  assert.deepEqual(await decryptBlob(data, key), plain);
  await assert.rejects(decryptBlob(data, bytesToHex(generateSecretKey())));
  const again = await encryptBlob(plain, key);
  assert.notDeepEqual(again.data, data, 'a fresh IV every time, even with the same key');
});

test('upload goes to the first server that takes it, with every refusal and its reason', async () => {
  const strict = await startBlossom({ accept: (type) => type.startsWith('image/') || 'only images here' });
  const open = await startBlossom();
  try {
    const { data } = await encryptBlob(bytes('secret'));
    const up = await upload([strict.url, open.url], data, { sk });
    assert.equal(up.server, open.url);
    assert.equal(up.sha256, await sha256Hex(data));
    assert.deepEqual(up.errors.map((e) => [e.status, e.reason]), [[415, 'only images here']]);
    assert.ok(open.blobs.has(up.sha256));
    assert.equal(open.blobs.get(up.sha256).owner, pk, 'the server knows who uploaded it');
    await assert.rejects(upload([strict.url], data, { sk }), (err) => err.code === 'media.error.noServer' && /only images here/.test(err.message));
  } finally {
    await strict.close();
    await open.close();
  }
});

test('downloads are checked against the hash: a server serving other bytes is skipped', async () => {
  const liar = await startBlossom({ tamper: true });
  const honest = await startBlossom();
  try {
    const data = bytes('the real file');
    const up = await upload([liar.url], data, { sk, type: 'text/plain' });
    await upload([honest.url], data, { sk, type: 'text/plain' });
    assert.deepEqual(await fetchBlob({ url: up.url, sha256: up.sha256 }, { servers: [honest.url] }), data, 'the liar is skipped, the honest server serves it');
    await assert.rejects(fetchBlob({ url: up.url, sha256: up.sha256 }), (err) => err.code === 'media.error.notFound');
  } finally {
    await liar.close();
    await honest.close();
  }
});

test('an encrypted media object opens to the original; only its uploader can delete it', async () => {
  const server = await startBlossom();
  try {
    const plain = bytes('a note attachment');
    const { data, key } = await encryptBlob(plain);
    const up = await upload([server.url], data, { sk });
    assert.deepEqual(await openMedia({ url: up.url, sha256: up.sha256, key }), plain);
    const other = bytesToHex(generateSecretKey());
    assert.equal(await removeBlob(server.url, up.sha256, other), false, 'someone else cannot');
    assert.equal(await removeBlob(server.url, up.sha256, sk), true);
    assert.ok(!server.blobs.has(up.sha256));
  } finally {
    await server.close();
  }
});

test('checking a server: takes encrypted files, images only, or unreachable; the test file is deleted', async () => {
  const open = await startBlossom();
  const strict = await startBlossom({ accept: (type) => type.startsWith('image/') || 'only images here' });
  try {
    assert.deepEqual(await probe(open.url, { sk }), { server: open.url, result: 'encrypted', reason: '', cors: true });
    const s = await probe(strict.url, { sk });
    assert.equal(s.result, 'imagesOnly');
    assert.equal(s.reason, 'only images here');
    assert.equal(open.blobs.size + strict.blobs.size, 0, 'nothing left behind');
    assert.equal((await probe('http://localhost:9', { sk })).result, 'unreachable');
  } finally {
    await open.close();
    await strict.close();
  }
});

test('a server whose refusals the page cannot read is still found to take photos, not called unreachable', async () => {
  const quiet = await startBlossom({ accept: (type) => type.startsWith('image/') || 'only images here', silentRefusal: true });
  try {
    const r = await probe(quiet.url, { sk });
    assert.equal(r.result, 'imagesOnly');
    assert.equal(quiet.blobs.size, 0, 'the test photo is deleted again');
  } finally {
    await quiet.close();
  }
});
