// Payload in Chromium, the three ways to send: directly between two open pages
// (and through the relays, with a corrupted piece the receiver must catch), a
// link that waits on the media server and opens on another device (then is
// deleted and opens nothing), and files to a friend, which arrive in their chat
// and in Payload's Received list. What is saved is compared by SHA-256.
//
// A distribution runs it against its own site (it needs a chat mount for "to people"):
//   import { payloadSuite } from 'kiwi-framework/test/e2e/payload.mjs';
//   await run('payload', (env) => payloadSuite(env, { app: `${env.base}payload/`, settings: `${env.base}settings.html` }), { webRoot: site });
// Run directly, it builds a test hub with the app at payload/ and the chat at chat/.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { device, run, testHub, topBar, until } from './env.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const step = (s) => console.log(`• ${s}`);
const keypair = (alias) => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)), alias, created: Date.now() };
};

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, settings: string }} where  the app's URL and the site's settings page
 */
export async function payloadSuite(env, { app, settings }) {
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const dev = (name, identity = null) => device(env, name, init, { relay: env.nostrUrl, identity });
  const saveAll = async (page, n, click) => {
    const saved = [];
    page.on('download', (d) => saved.push(d));
    await click();
    await until(() => saved.length >= n, `${n} downloads`, 120000);
    const out = {};
    for (const d of saved) out[d.suggestedFilename()] = fs.readFileSync(await d.path());
    return out;
  };
  const choose = async (page, files, query = '') => {
    await page.goto(`${app}${query}`);
    await page.waitForSelector('#drop');
    await page.setInputFiles('#files', files);
    await page.waitForSelector('#ways');
  };
  async function mediaServer(page) {
    await page.goto(`${settings}#media`);
    await page.waitForSelector('#mediaForm', { state: 'attached' });
    if (!(await page.$eval('#media details', (d) => d.open).catch(() => true))) await page.click('#media details summary');
    await page.fill('#mediaForm textarea', env.blossom.url);
    await page.click('#mediaForm [type=submit]');
    await page.waitForSelector(`#mediaList li[data-server="${env.blossom.url}"]`);
  }
  async function befriend(asker, asked) {
    await asked.goto(settings);
    await asked.waitForSelector('#myNpub');
    const key = await asked.textContent('#myNpub');
    await asker.goto(settings);
    await asker.waitForSelector('#friendForm');
    await asker.fill('#friendForm [name=who]', key);
    await asker.click('#friendForm .btn');
    await asked.waitForSelector('#requestList [data-accept]', { timeout: 30000 });
    await asked.click('#requestList [data-accept]');
    await until(async () => (await asker.$$('#friendList [data-remove]')).length > 0, 'friends on both sides', 30000);
  }

  async function direct({ files, query = '', corrupt = false }) {
    const S = await dev('sender');
    if (corrupt) await S.ctx.addInitScript(() => (globalThis.__payloadTest = { corruptFirstChunk: true }));
    await choose(S, files, query);
    await S.click('[data-way=direct]');
    await S.waitForSelector('#link', { timeout: 60000 });
    const link = await S.inputValue('#link');
    assert.match(link, /#[\w-]{22}$/);
    const senderFp = await S.textContent('.fp code');
    const R = await dev('receiver');
    await R.goto(link);
    await R.waitForSelector('#go', { timeout: 30000 });
    assert.equal(await R.textContent('.fp code'), senderFp, 'both sides show the same fingerprint');
    const kind = await R.getAttribute('#peerKind', 'data-kind');
    const got = await saveAll(R, files.length, () => R.click('#go'));
    for (const f of files) assert.equal(sha(got[f.name] || Buffer.from('missing')), sha(f.buffer), `${f.name} arrived intact`);
    await until(async () => (await S.$$('#receivers .bar.ok')).length > 0, 'the sender sees it done');
    const retried = R.logs.some((l) => l.includes('failed its hash check'));
    await S.ctx.close();
    await R.ctx.close();
    return { kind, retried };
  }

  const big = crypto.randomBytes(3 * 1024 * 1024 + 12345);
  const three = [
    { name: 'random.bin', mimeType: 'application/octet-stream', buffer: big },
    { name: 'notes – ünïcode.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from payload\n'.repeat(100)) },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ];

  step('directly, three files (3 MB, text, empty), found through the hub’s relays');
  const d = await direct({ files: three });
  assert.equal(d.kind, 'direct');

  step('directly through the relays (no direct path), with a corrupted piece on the way');
  const relayed = await direct({ files: [{ name: 'relay.bin', mimeType: 'application/octet-stream', buffer: crypto.randomBytes(700 * 1024) }], query: '?relay', corrupt: true });
  assert.equal(relayed.kind, 'relay');
  assert.ok(relayed.retried, 'the receiver caught the corrupted piece and fetched it again');

  step('a receiver waits for a sender who is not there');
  const W = await dev('early');
  await W.goto(`${app}#AAAAAAAAAAAAAAAAAAAAAA`);
  await until(async () => (await W.textContent('#status')).includes('Waiting for the sender'), 'waiting message', 15000);
  await W.ctx.close();

  step('a link: the files encrypted on the media server, the link opens them on another device while the sender is away');
  const ada = keypair('ada');
  const A = await dev('A', ada);
  await mediaServer(A);
  const plan = Buffer.from('week 1: seedlings\nweek 2: transplant\n');
  const photo = crypto.randomBytes(300 * 1024);
  const before = env.blossom.blobs.size;
  await choose(A, [
    { name: 'plan.txt', mimeType: 'text/plain', buffer: plan },
    { name: 'photo.raw', mimeType: 'application/octet-stream', buffer: photo },
  ]);
  await A.click('[data-way=link]');
  await A.waitForSelector('#shareLink', { timeout: 60000 });
  const link = await A.inputValue('#shareLink');
  assert.match(link, /#\/l\/[0-9a-f]{64}\.[\w-]{43}\.[\w-]{16}\.[\w-]+$/);
  assert.equal(env.blossom.blobs.size, before + 3, 'two files and the list of them');
  assert.ok(![...env.blossom.blobs.values()].some((b) => Buffer.from(b.data).includes(Buffer.from('seedlings'))), 'the server holds ciphertext only');
  await A.goto(`${app}#/links`);
  await A.waitForSelector('#links [data-link]');
  await A.goto(`${env.base}hub.json`); // the sender is away
  const V = await dev('V');
  await V.goto(link);
  await V.waitForSelector('#openFiles [data-file="photo.raw"]', { timeout: 30000 });
  const opened = await saveAll(V, 2, () => V.click('#downloadAll'));
  assert.equal(sha(opened['plan.txt']), sha(plan), 'plan.txt intact');
  assert.equal(sha(opened['photo.raw']), sha(photo), 'photo.raw intact');

  step('the link deleted under Links: the files leave the server, the link opens nothing');
  await A.goto(`${app}#/links`);
  await A.waitForSelector('#links [data-act=delete-link]');
  await A.click('#links [data-act=delete-link]');
  await A.click('dialog.modal [data-ok]');
  await A.waitForSelector('#linksEmpty', { timeout: 20000 });
  assert.equal(env.blossom.blobs.size, before, 'nothing of it left on the server');
  await V.goto(`${env.base}hub.json`);
  await V.goto(link);
  await V.waitForSelector('#openError', { timeout: 20000 });

  step('to a friend: sealed into their chat; it shows in their Payload under Received, and downloads');
  const bea = keypair('bea');
  const B = await dev('B', bea);
  await befriend(B, A);
  const list = Buffer.from('seeds: 12\ncuttings: 4\n');
  await choose(A, [{ name: 'stock.txt', mimeType: 'text/plain', buffer: list }]);
  await A.click('[data-way=people]');
  await A.waitForSelector('#sendToForm');
  await A.check(`#sendToForm [data-pk="${bea.pk}"]`);
  await A.click('#sendToBtn');
  await A.waitForSelector('.toast-success', { timeout: 30000 });
  await B.goto(`${app}#/received`);
  await B.waitForSelector('#received [data-file="stock.txt"]', { timeout: 30000 });
  const got = await saveAll(B, 1, () => B.click('#received [data-file="stock.txt"] [data-act=download]'));
  assert.equal(sha(got['stock.txt']), sha(list), 'the same bytes as were sent');
  const inChat = await B.getAttribute('#received [data-file="stock.txt"] a.icon-btn', 'href');
  assert.ok(inChat?.includes(`#/dm/${ada.pk}`), 'and the way to the conversation it came in');

  step('the suite’s top bar, exactly as on the hub: place, size and type');
  assert.deepEqual(await topBar(env, app), await topBar(env, env.base));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const site = await testHub([
    { app: 'payload', name: 'Payload', icon: 'send' },
    { app: 'chat', name: 'Chat', icon: 'message-circle' },
  ]);
  await run('payload', (env) => payloadSuite(env, { app: `${env.base}payload/`, settings: `${env.base}settings.html` }), { webRoot: site });
}
