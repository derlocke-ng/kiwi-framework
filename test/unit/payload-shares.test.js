// Payload's links (apps/payload/data/shares.js) against the local Blossom server: files and their list go up
// encrypted, the link's fragment carries what opens them and survives a round trip, the files come back
// intact on a reader who has only the link, a link that was cut short or names nothing says so, and deleting
// the link removes every blob it put on the server.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openFile } from '../../shared/files.js';
import { bytesToHex, generateSecretKey } from '../../shared/nostr.mjs';
import { startBlossom } from '../../scripts/blossom-server.mjs';
import { createShare, deleteShare, keptShare, MAX_FILES, openShare, parseShare, shareFragment } from '../../apps/payload/data/shares.js';

const blossom = await startBlossom();
after(() => blossom.close());
const sk = bytesToHex(generateSecretKey());
const te = new TextEncoder();

test('a link: files and their list encrypted on the server, opened with the link alone, deleted with it', async () => {
  const plan = te.encode('week 1: seedlings\n');
  const photo = crypto.getRandomValues(new Uint8Array(40_000));
  const files = [new File([plan], 'plan.txt', { type: 'text/plain' }), new File([photo], 'photo.raw')];
  const steps = [];
  const share = await createShare(files, { servers: [blossom.url], sk, from: 'ada', onProgress: (p) => steps.push(p) });
  assert.equal(blossom.blobs.size, 3, 'two files and their list');
  assert.ok(![...blossom.blobs.values()].some((b) => Buffer.from(b.data).includes(Buffer.from('seedlings'))), 'only ciphertext on the server');
  assert.equal(steps.at(-1), 1);

  const fragment = shareFragment(share);
  assert.match(fragment, /^l\/[0-9a-f]{64}\.[\w-]{43}\.[\w-]{16}\.[\w-]+$/);
  const ref = parseShare(`#/${fragment}`);
  assert.deepEqual(ref, { x: share.x, key: share.key, nonce: share.nonce, server: share.server });

  const opened = await openShare(ref);
  assert.equal(opened.from, 'ada');
  assert.deepEqual(
    opened.files.map((f) => [f.name, f.size]),
    [
      ['plan.txt', plan.length],
      ['photo.raw', photo.length],
    ],
  );
  assert.deepEqual(await openFile(opened.files[0]), plan);
  assert.deepEqual(await openFile(opened.files[1]), photo);

  const kept = keptShare(share);
  assert.ok(!JSON.stringify(kept).includes('"nonce":"' + opened.files[0].nonce), 'what the sender keeps holds no file keys');
  assert.deepEqual(await deleteShare(kept, sk), { removed: 3, kept: 0 });
  assert.equal(blossom.blobs.size, 0);
  await assert.rejects(openShare(ref), (err) => err.code === 'pl.error.gone');
});

test('a link cut short, or one that is not a link, opens nothing', async () => {
  assert.equal(parseShare('l/abc'), null);
  assert.equal(parseShare('#AAAAAAAAAAAAAAAAAAAAAA'), null);
  assert.equal(parseShare(`l/${'a'.repeat(64)}.${'A'.repeat(43)}.${'A'.repeat(15)}.aHR0cHM6Ly94`), null, 'a nonce too short');
  const wrongKey = { x: 'b'.repeat(64), key: 'c'.repeat(64), nonce: 'd'.repeat(24), server: blossom.url };
  await assert.rejects(openShare(wrongKey), (err) => err.code === 'pl.error.gone');
});

test('a link holds at most so many files, and needs a server', async () => {
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => new File([`${i}`], `${i}.txt`));
  await assert.rejects(createShare(many, { servers: [blossom.url], sk }), (err) => err.code === 'pl.error.tooMany');
  await assert.rejects(createShare([new File(['x'], 'x.txt')], { servers: [], sk }), (err) => err.code === 'pl.error.noServers');
});
