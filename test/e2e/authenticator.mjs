// The authenticator in a browser: a vault set up with its own passphrase, an
// account added from a pasted link with the code it gives shown before it is
// added, one read from a picture of its QR code (jsQR where the browser has no
// barcode reader), a Google Authenticator export; the codes the page shows are
// the codes RFC 6238 gives; the relay holds no secret; another device of the
// same key opens the vault with the passphrase (a wrong one said as such), a
// rename there shows here, a new passphrase locks the other device; the page
// locks again after being away; a backup brought back after the vault was
// removed. Exported for a distribution's own run (Armory's mount).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { qrSvg } from '../../shared/qr.js';
import { cleanEntry, totp } from '../../shared/totp.js';
import { device, run, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const PASS = 'correct horse battery';
const SHOP = { issuer: 'Shop', account: 'ada@example.org', secret: 'JBSWY3DPEHPK3PXP' };
const MAIL = { issuer: 'Mail', account: 'bob', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8 };
const uri = (e) =>
  `otpauth://totp/${encodeURIComponent(`${e.issuer}:${e.account}`)}?secret=${e.secret}&issuer=${encodeURIComponent(e.issuer)}${e.algorithm ? `&algorithm=${e.algorithm}` : ''}${e.digits ? `&digits=${e.digits}` : ''}`;

/** The codes an entry gives around now: the page may have computed its code a second before or after. */
async function codesAround(e) {
  const entry = cleanEntry(e);
  const now = Date.now();
  return Promise.all([now - 30_000, now, now + 30_000].map(async (ms) => (await totp(entry, ms)).code));
}

/** A Google Authenticator export (otpauth-migration://) of these accounts, as its protocol buffer has them. */
function migration(accounts) {
  const te = new TextEncoder();
  const base32 = (s) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, '0');
    const out = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) out.push(Number.parseInt(bits.slice(i, i + 8), 2));
    return out;
  };
  const raw = (field, b) => [field * 8 + 2, b.length, ...b];
  const num = (field, v) => [field * 8, v];
  const body = accounts.flatMap((a) =>
    raw(1, [...raw(1, base32(a.secret)), ...raw(2, [...te.encode(a.account)]), ...raw(3, [...te.encode(a.issuer)]), ...num(4, 1), ...num(5, 1), ...num(6, 2)]),
  );
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(Uint8Array.from(body)).toString('base64'))}`;
}

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string }} where  app: the authenticator's mount
 */
export async function authenticatorSuite(env, { app }) {
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const sk = bytesToHex(generateSecretKey());
  const identity = { sk, pk: getPublicKey(hexToBytes(sk)), alias: null, created: Date.now() };
  const dev = (name) => device(env, name, init, { relay: env.nostrUrl, identity }, { permissions: ['clipboard-read', 'clipboard-write'] });
  const entries = (page) => page.$$eval('#codes [data-entry]', (els) => els.map((e) => e.getAttribute('data-entry')));
  const codeOf = (page, name) => page.$eval(`[data-entry="${name}"] .au-code`, (el) => el.getAttribute('data-code'));
  const expectCode = async (page, name, e) => {
    await until(async () => (await codesAround(e)).includes(await codeOf(page, name)), `the code of ${name} as RFC 6238 gives it`);
  };
  const add = async (page, text) => {
    await page.click('#addBtn');
    await page.waitForSelector('#manualForm');
    await page.fill('#manualForm [name=text]', text);
    await page.click('#readText');
    await page.waitForSelector('#found');
  };

  step('the first visit asks for a passphrase of its own; two that differ are said as such');
  const A = await dev('A');
  await A.goto(app);
  await A.waitForSelector('#setupForm');
  await A.fill('#setupForm [name=pass]', PASS);
  await A.fill('#setupForm [name=pass2]', 'correct horse batterz');
  await A.click('#setupBtn');
  await A.waitForSelector('#setupError');
  await A.fill('#setupForm [name=pass2]', PASS);
  await A.click('#setupBtn');
  await A.waitForSelector('#codesEmpty', { timeout: 20000 });

  step('a pasted link: what it is and its code now shown before it is added; the card gives the RFC 6238 code');
  await add(A, uri(SHOP));
  assert.match(await A.textContent('#found'), /Shop/);
  assert.ok((await codesAround(SHOP)).includes((await A.textContent('#previewCode')).replace(/\s/g, '')), 'the code shown before adding');
  await A.click('#addFound');
  await A.waitForSelector('[data-entry="Shop"]');
  await expectCode(A, 'Shop', SHOP);
  await A.click('[data-entry="Shop"] .au-main');
  await until(async () => (await A.evaluate(() => navigator.clipboard.readText())) === (await codeOf(A, 'Shop')), 'the code copied on a tap');

  step('a picture of a QR code (SHA-256, eight digits)');
  const shot = await A.ctx.newPage();
  await shot.setContent(`<style>.qr-bg{fill:#fff}.qr-fg{fill:#000}</style><body style="margin:0"><div style="width:320px">${qrSvg(uri(MAIL))}</div></body>`);
  const png = await shot.locator('svg').screenshot();
  await shot.close();
  await A.click('#addBtn');
  await A.waitForSelector('#picture', { state: 'attached' });
  await A.setInputFiles('#picture', { name: 'qr.png', mimeType: 'image/png', buffer: png });
  await A.waitForSelector('#found, #addError');
  assert.equal(await A.$('#addError').then((el) => el?.textContent() ?? null), null, 'the QR code read from the picture');
  await A.click('#addFound');
  await A.waitForSelector('[data-entry="Mail"]');
  await expectCode(A, 'Mail', MAIL);
  assert.equal((await codeOf(A, 'Mail')).length, 8);

  step('a Google Authenticator export: the new account added, the one already here skipped');
  const BANK = { issuer: 'Bank', account: 'ada', secret: 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U' };
  await add(A, migration([SHOP, BANK]));
  await A.click('#addFound');
  await until(async () => (await entries(A)).join() === 'Shop,Mail,Bank', 'three accounts, Shop once');
  await expectCode(A, 'Bank', BANK);

  step('nothing secret on the relay: the vault is sealed in the account’s settings');
  await until(async () => (await env.relayEvents([{ kinds: [30791], authors: [identity.pk] }])).length > 0, 'the settings on the relay');
  const held = JSON.stringify(await env.relayEvents([{ authors: [identity.pk] }]));
  for (const s of [SHOP.secret, MAIL.secret, BANK.secret, 'ada@example.org']) assert.ok(!held.includes(s), `no ${s} on the relay`);

  step('another device of the key asks for the passphrase; a wrong one is said as such');
  const B = await dev('B');
  await B.goto(app);
  await B.waitForSelector('#unlockForm', { timeout: 20000 });
  await B.fill('#unlockForm [name=pass]', 'wrong horse battery');
  await B.click('#unlockBtn');
  await B.waitForSelector('#unlockError', { timeout: 20000 });
  await B.fill('#unlockForm [name=pass]', PASS);
  await B.click('#unlockBtn');
  await until(async () => (await entries(B)).join() === 'Shop,Mail,Bank', 'the three accounts on B', 20000);
  await expectCode(B, 'Mail', MAIL);

  step('a rename on B shows on A, which has the vault open');
  await B.click('[data-entry="Shop"] [data-act=menu]');
  await B.click('[data-act=edit]');
  await B.fill('#editForm [name=issuer]', 'Shop EU');
  await B.click('#editForm [type=submit]');
  await B.waitForSelector('[data-entry="Shop EU"]');
  await A.waitForSelector('[data-entry="Shop EU"]', { timeout: 15000 });

  step('a deletion asks first');
  await A.click('[data-entry="Bank"] [data-act=menu]');
  await A.click('[data-act=delete]');
  await A.click('[data-ok]');
  await until(async () => (await entries(A)).join() === 'Shop EU,Mail', 'Bank deleted on A');
  await until(async () => (await entries(B)).join() === 'Shop EU,Mail', 'and on B');

  step('a new passphrase on A locks B, which opens with the new one');
  await A.goto(`${app}#/settings`);
  await A.waitForSelector('#passForm');
  await A.fill('#passForm [name=pass]', 'a new passphrase here');
  await A.fill('#passForm [name=pass2]', 'a new passphrase here');
  await A.click('#passBtn');
  await until(async () => !(await A.$('#passBtn[disabled]')), 'the new key worked out', 20000);
  await B.waitForSelector('#unlockForm', { timeout: 15000 });
  assert.ok((await B.textContent('#unlockCard')).length > 0);
  await B.fill('#unlockForm [name=pass]', PASS);
  await B.click('#unlockBtn');
  await B.waitForSelector('#unlockError', { timeout: 20000 });
  await B.fill('#unlockForm [name=pass]', 'a new passphrase here');
  await B.click('#unlockBtn');
  await until(async () => (await entries(B)).join() === 'Shop EU,Mail', 'B open with the new passphrase', 20000);

  step('the lock button, and locking again after the page was away');
  await B.click('#lockBtn');
  await B.waitForSelector('#unlockForm');
  await A.goto(`${app}#/`);
  await A.reload();
  await A.waitForSelector('#unlockForm', { timeout: 15000 }); // a new page load: the vault is locked
  await A.fill('#unlockForm [name=pass]', 'a new passphrase here');
  await A.click('#unlockBtn');
  await A.waitForSelector('#codes', { timeout: 20000 });
  await A.evaluate(() => {
    const away = (state) => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    away('hidden');
    const real = Date.now;
    Date.now = () => real() + 6 * 60_000; // longer than the five minutes a device locks after by default
    away('visible');
    Date.now = real;
  });
  await A.waitForSelector('#unlockForm');

  step('a backup saved, the vault removed, a new one set up and the backup brought back with its passphrase');
  await A.goto(`${app}#/settings`);
  await A.waitForSelector('#saveBackup');
  const [download] = await Promise.all([A.waitForEvent('download'), A.click('#saveBackup')]);
  const backup = fs.readFileSync(await download.path(), 'utf8');
  assert.equal(JSON.parse(backup).type, 'kiwi-authenticator-backup');
  assert.ok(!backup.includes(SHOP.secret), 'the backup is sealed');
  await A.click('#removeVault');
  await A.click('[data-ok]');
  await A.waitForSelector('#setupForm');
  await A.fill('#setupForm [name=pass]', 'yet another passphrase');
  await A.fill('#setupForm [name=pass2]', 'yet another passphrase');
  await A.click('#setupBtn');
  await A.waitForSelector('#codesEmpty', { timeout: 20000 });
  await A.goto(`${app}#/settings`);
  await A.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await A.fill('#backupPassForm [name=pass]', 'a new passphrase here');
  await A.click('#backupPassBtn');
  await A.waitForSelector('#backupPassForm', { state: 'detached', timeout: 20000 });
  await A.goto(`${app}#/`);
  await until(async () => (await entries(A)).join() === 'Shop EU,Mail', 'the accounts back from the backup');
  await expectCode(A, 'Shop EU', SHOP);
  await B.waitForSelector('#unlockForm');
  await B.fill('#unlockForm [name=pass]', 'yet another passphrase');
  await B.click('#unlockBtn');
  await until(async () => (await entries(B)).join() === 'Shop EU,Mail', 'B opens the new vault', 20000);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = await testHub([{ app: 'authenticator', name: 'Authenticator', icon: 'shield-check' }], { id: 'authenticator-hub', name: 'Authenticator hub' });
  await run('authenticator', (env) => authenticatorSuite(env, { app: `${env.base}authenticator/` }), { webRoot: site });
}
