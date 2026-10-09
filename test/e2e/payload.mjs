// Payload in Chromium: real files between two browser contexts, directly and
// through the gun relay (with a corrupted piece the receiver must catch), the
// SHA-256 of what was saved compared, and a receiver waiting for a sender
// who is not there.
//
// A distribution runs it against its own site:
//   import { payloadSuite } from 'kiwi-framework/test/e2e/payload.mjs';
//   await run('payload', (env) => payloadSuite(env, { app: `${env.base}payload/` }), { webRoot: site });
// Run directly, it builds a test hub with the app at payload/.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run, device, until, testHub, topBar } from './env.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const step = (s) => console.log(`• ${s}`);

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string }} where  the app's URL
 */
export async function payloadSuite(env, { app }) {
  const relays = (relay) => localStorage.setItem('payload.relays', JSON.stringify([relay]));

  async function transfer({ files, query = '', corrupt = false }) {
    const S = await device(env, 'sender', relays, env.relayUrl);
    if (corrupt) await S.ctx.addInitScript(() => (globalThis.__payloadTest = { corruptFirstChunk: true }));
    await S.goto(`${app}${query}`);
    await S.setInputFiles('#files', files);
    await S.waitForSelector('#link', { timeout: 60000 });
    const link = await S.inputValue('#link');
    assert.match(link, /#[\w-]{22}$/);
    const senderFp = await S.textContent('.fp code');

    const R = await device(env, 'receiver', relays, env.relayUrl);
    await R.goto(link);
    await R.waitForSelector('#go', { timeout: 30000 });
    assert.equal(await R.textContent('.fp code'), senderFp, 'both sides show the same fingerprint');
    const kind = await R.textContent('#peerKind');
    const saved = [];
    R.on('download', (d) => saved.push(d));
    await R.click('#go');
    await until(() => saved.length === files.length, 'all downloads', 120000);
    for (const [i, d] of saved.entries()) {
      const file = `${env.tmp}/got-${i}`;
      await d.saveAs(file);
      const want = files.find((f) => f.name === d.suggestedFilename());
      assert.ok(want, `unexpected file ${d.suggestedFilename()} (all: ${saved.map((x) => x.suggestedFilename()).join(', ')}; url ${d.url().slice(0, 40)})`);
      assert.equal(sha(fs.readFileSync(file)), sha(want.buffer), `${want.name} arrived intact`);
    }
    await until(async () => (await S.textContent('#receivers')).includes('Received and verified'), 'sender sees completion');
    const retried = R.logs.some((l) => l.includes('failed its hash check'));
    await S.ctx.close();
    await R.ctx.close();
    return { kind, retried };
  }

  const big = crypto.randomBytes(3 * 1024 * 1024 + 12345);
  const files = [
    { name: 'random.bin', mimeType: 'application/octet-stream', buffer: big },
    { name: 'notes – ünïcode.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from payload\n'.repeat(100)) },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ];

  step('direct transfer of three files (3 MB, text, empty)');
  const direct = await transfer({ files });
  assert.equal(direct.kind, 'Direct P2P');

  step('through the gun relay, with a corrupted piece on the way');
  const relayed = await transfer({ files: [{ name: 'relay.bin', mimeType: 'application/octet-stream', buffer: crypto.randomBytes(700 * 1024) }], query: '?relay', corrupt: true });
  assert.equal(relayed.kind, 'Via gun relays');
  assert.ok(relayed.retried, 'the receiver caught the corrupted piece and fetched it again');

  step('receiver waits for an offline sender');
  const R = await device(env, 'early', relays, env.relayUrl);
  await R.goto(`${app}#AAAAAAAAAAAAAAAAAAAAAA`);
  await until(async () => (await R.textContent('#status')).includes('Waiting for the sender'), 'waiting message', 15000);

  step('the suite’s top bar, exactly as on the hub: place, size and type');
  assert.deepEqual(await topBar(env, app), await topBar(env, env.base));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const site = await testHub([{ app: 'payload', name: 'Payload', icon: 'send' }]);
  await run('payload', (env) => payloadSuite(env, { app: `${env.base}payload/` }), { webRoot: site });
}
