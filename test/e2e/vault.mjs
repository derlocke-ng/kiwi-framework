// The password manager in a browser: a vault set up with its own passphrase;
// a login made with a generated password, a site, a 2FA secret and a custom
// field, its password copied, its code as RFC 6238 gives it, a new password
// keeping the old one in its history; a note and a card; the filters and the
// search; nothing readable on the relay; the same login's code in the
// authenticator; the health report (weak and reused passwords, and the breach
// check, off until turned on, then asking a stand-in for Have I Been Pwned with
// five hex characters only); an import from a browser's CSV, the same again
// skipped; a plain export behind its warning; a second device of the key
// opening the vault and an edit there showing here; the generator on its own
// page; a deletion. Exported for a distribution's own run (Armory's mount).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { cleanEntry, totp } from '../../shared/totp.js';
import { device, run, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const PASS = 'correct horse battery';
const SECRET = 'JBSWY3DPEHPK3PXP';

async function codesAround(secret) {
  const entry = cleanEntry({ secret });
  const now = Date.now();
  return Promise.all([now - 30_000, now, now + 30_000].map(async (ms) => (await totp(entry, ms)).code));
}

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, authenticator?: string }} where  app: the password manager's mount; authenticator: the authenticator's, when the site has one
 */
export async function vaultSuite(env, { app, authenticator = '' }) {
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const sk = bytesToHex(generateSecretKey());
  const identity = { sk, pk: getPublicKey(hexToBytes(sk)), alias: null, created: Date.now() };
  const pwned = []; // what the stand-in for Have I Been Pwned was asked
  const dev = async (name) => {
    const page = await device(env, name, init, { relay: env.nostrUrl, identity }, { permissions: ['clipboard-read', 'clipboard-write'] });
    // never the real service: a stand-in answers, and anything else there fails the suite
    await page.ctx.route('https://api.pwnedpasswords.com/**', (route) => {
      const url = new URL(route.request().url());
      pwned.push({ path: url.pathname, padding: route.request().headers()['add-padding'] });
      const hash = createHash('sha1').update('password123').digest('hex').toUpperCase();
      const body = url.pathname === `/range/${hash.slice(0, 5)}` ? `0000000000000000000000000000000000A:0\r\n${hash.slice(5)}:251682\r\n` : 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n';
      return route.fulfill({ status: 200, contentType: 'text/plain', body, headers: { 'access-control-allow-origin': '*' } });
    });
    return page;
  };
  const names = (page) => page.$$eval('#entries [data-entry]', (els) => els.map((e) => e.getAttribute('data-entry')));
  const open = async (page, name) => {
    await page.click(`#entries [data-entry="${name}"] .pw-main`);
    await page.waitForSelector(`#entryView[data-entry="${name}"]`);
  };
  const closePanel = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#entryView', { state: 'detached' });
  };
  const newEntry = async (page, type) => {
    await page.click('#newBtn');
    await page.click(`[data-act=new-${type}]`);
    await page.waitForSelector('#entryForm');
  };
  const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

  step('the first visit sets up the vault with a passphrase of its own');
  const A = await dev('A');
  await A.goto(app);
  await A.waitForSelector('#setupForm');
  await A.fill('#setupForm [name=pass]', PASS);
  await A.fill('#setupForm [name=pass2]', PASS);
  await A.click('#setupBtn');
  await A.waitForSelector('#entriesEmpty', { timeout: 20000 });

  step('a login: a generated password, a site, a 2FA secret, a hidden field, tags');
  await newEntry(A, 'login');
  await A.fill('#entryForm [name=name]', 'Shop');
  await A.fill('#entryForm [name=username]', 'ada@example.org');
  await A.click('#openGenerator');
  await A.waitForSelector('#generated');
  const generated = (await A.textContent('#generated')).trim();
  assert.equal(generated.length, 20);
  await A.click('#useGenerated');
  assert.equal(await A.inputValue('#entryForm [name=password]'), generated);
  await A.fill('#entryForm [name=urls]', 'shop.example/login');
  await A.fill('#entryForm [name=totp]', SECRET);
  await A.click('#addField');
  await A.fill('#customFields .pw-custom input >> nth=0', 'PIN');
  await A.fill('#customFields .pw-custom input >> nth=1', '4711');
  await A.check('#customFields .pw-custom input[type=checkbox]');
  await A.fill('#entryForm [name=tags]', 'shopping, web');
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView[data-entry="Shop"]');
  assert.equal(await A.getAttribute('[data-field=password] .pw-value', 'data-value'), '', 'hidden until shown');
  await A.click('#entryView [data-act=show-password]');
  assert.equal(await A.getAttribute('[data-field=password] .pw-value', 'data-value'), generated);
  await A.click('#entryView [data-act=copy-password]');
  await until(async () => (await clipboard(A)) === generated, 'the password copied');
  await until(async () => (await codesAround(SECRET)).includes(await A.getAttribute('[data-field=code] .pw-code', 'data-code')), 'the 2FA code as RFC 6238 gives it');
  assert.equal(await A.getAttribute('[data-field=url] a', 'href'), 'https://shop.example/login');
  assert.equal(await A.getAttribute('[data-field=field0] .pw-value', 'data-value'), '', 'a hidden field is hidden');

  step('a new password keeps the old one in the history');
  await A.click('#editBtn');
  await A.waitForSelector('#entryForm');
  await A.fill('#entryForm [name=password]', 'password123');
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView #history');
  assert.match(await A.textContent('#history'), new RegExp(generated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await closePanel(A);

  step('a note and a card; the filters and the search');
  await newEntry(A, 'note');
  await A.fill('#entryForm [name=name]', 'Wifi');
  await A.fill('#entryForm [name=notes]', 'the router is in the hall');
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView[data-entry="Wifi"]');
  await closePanel(A);
  await newEntry(A, 'card');
  await A.fill('#entryForm [name=name]', 'Visa');
  await A.fill('#entryForm [name=holder]', 'Ada Lovelace');
  await A.fill('#entryForm [name=number]', '4111 1111 1111 1111');
  await A.fill('#entryForm [name=exp]', '07/29');
  await A.fill('#entryForm [name=code]', '123');
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView[data-entry="Visa"]');
  await closePanel(A);
  assert.deepEqual(await names(A), ['Shop', 'Visa', 'Wifi']);
  await A.click('[data-filter=card]');
  assert.deepEqual(await names(A), ['Visa']);
  await A.click('[data-filter=totp]');
  assert.deepEqual(await names(A), ['Shop'], 'a login with a 2FA secret is among the codes');
  await A.click('[data-filter=all]');
  await A.fill('#search', 'hall');
  assert.deepEqual(await names(A), ['Wifi'], 'notes are searched');
  await A.fill('#search', '');

  step('nothing readable on the relay');
  await until(async () => (await env.relayEvents([{ kinds: [30792], authors: [identity.pk] }])).length >= 3, 'the entries on the relay');
  const held = JSON.stringify(await env.relayEvents([{ authors: [identity.pk] }]));
  for (const s of [generated, 'password123', SECRET, 'ada@example.org', '4111', 'router', 'Ada Lovelace', 'shop.example']) assert.ok(!held.includes(s), `no ${s} on the relay`);

  if (authenticator) {
    step('the login’s 2FA code in the authenticator, which opens the same vault');
    const au = await A.ctx.newPage();
    await au.goto(authenticator);
    await au.waitForSelector('#unlockForm', { timeout: 20000 });
    await au.fill('#unlockForm [name=pass]', PASS);
    await au.click('#unlockBtn');
    await au.waitForSelector('#codes [data-entry="Shop"]', { timeout: 20000 });
    assert.ok((await codesAround(SECRET)).includes(await au.getAttribute('[data-entry="Shop"] .au-code', 'data-code')));
    await au.close();
  }

  step('health: a weak and a reused password; the breach check off until turned on, then five hex characters asked');
  await newEntry(A, 'login');
  await A.fill('#entryForm [name=name]', 'Forum');
  await A.fill('#entryForm [name=password]', 'password123');
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView[data-entry="Forum"]');
  await closePanel(A);
  await A.click('#toHealth');
  await A.waitForSelector('#health');
  assert.deepEqual((await A.$$eval('#weak [data-entry]', (els) => els.map((e) => e.getAttribute('data-entry')))).sort(), ['Forum', 'Shop']);
  assert.deepEqual((await A.$$eval('#reused [data-entry]', (els) => els.map((e) => e.getAttribute('data-entry')))).sort(), ['Forum', 'Shop']);
  await A.waitForSelector('#breachOff');
  assert.equal(pwned.length, 0, 'nothing asked while it is off');
  await A.click('#breachOff a');
  await A.waitForSelector('#breachCheck');
  await A.check('#breachCheck');
  await A.goto(`${app}#/health`);
  await A.waitForSelector('#checkBreaches:not([disabled])');
  await A.click('#checkBreaches');
  await A.waitForSelector('#breaches [data-entry]', { timeout: 15000 });
  assert.deepEqual((await A.$$eval('#breaches [data-entry]', (els) => els.map((e) => e.getAttribute('data-entry')))).sort(), ['Forum', 'Shop']);
  assert.ok(pwned.length >= 1);
  for (const p of pwned) {
    assert.match(p.path, /^\/range\/[0-9A-F]{5}$/, 'five hex characters, nothing else');
    assert.equal(p.padding, 'true');
  }
  await A.goto(`${app}#/`);

  step('an import from a browser’s CSV; the same file again adds nothing');
  await A.goto(`${app}#/settings`);
  await A.waitForSelector('#importFile', { state: 'attached' });
  const csv = 'name,url,username,password,note\nGit,https://git.example,ada,g1t-Pa55word-long,\nMail,https://mail.example,ada,ma1l-Pa55word-long,old account\n';
  await A.setInputFiles('#importFile', { name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await A.goto(`${app}#/`);
  await until(async () => (await names(A)).join() === 'Forum,Git,Mail,Shop,Visa,Wifi', 'the imported logins');
  await A.goto(`${app}#/settings`);
  await A.setInputFiles('#importFile', { name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await A.waitForTimeout(500);
  await A.goto(`${app}#/`);
  assert.equal((await names(A)).length, 6, 'nothing twice');

  step('a plain export asks first, and holds the passwords');
  await A.goto(`${app}#/settings`);
  await A.click('#exportCsv');
  const [download] = await Promise.all([A.waitForEvent('download'), A.click('[data-ok]')]);
  const exported = fs.readFileSync(await download.path(), 'utf8');
  assert.match(exported, /login_password/);
  assert.match(exported, /g1t-Pa55word-long/);
  await A.goto(`${app}#/`);

  step('a second device of the key opens the vault; an edit there shows here');
  const B = await dev('B');
  await B.goto(app);
  await B.waitForSelector('#unlockForm', { timeout: 20000 });
  await B.fill('#unlockForm [name=pass]', 'wrong horse battery');
  await B.click('#unlockBtn');
  await B.waitForSelector('#unlockError', { timeout: 20000 });
  await B.fill('#unlockForm [name=pass]', PASS);
  await B.click('#unlockBtn');
  await until(async () => (await names(B)).length === 6, 'the six entries on B', 20000);
  await open(B, 'Wifi');
  await B.click('#editBtn');
  await B.fill('#entryForm [name=name]', 'Home wifi');
  await B.click('#saveEntry');
  await B.waitForSelector('#entryView[data-entry="Home wifi"]');
  await until(async () => (await names(A)).includes('Home wifi'), 'the rename on A', 15000);

  step('the generator on its own page: a password, then a passphrase');
  await A.click('#toGenerator');
  await A.waitForSelector('#generated');
  assert.equal((await A.textContent('#generated')).trim().length, 20);
  await A.click('[data-mode=passphrase]');
  await until(async () => (await A.textContent('#generated')).split('-').length === 6, 'six words');
  await A.click('[data-mode=password]');
  await A.goto(`${app}#/`);

  step('a deletion asks first and goes to the other device');
  await open(A, 'Visa');
  await A.click('#deleteBtn');
  await A.click('[data-ok]');
  await A.waitForSelector('#entryView', { state: 'detached' });
  await until(async () => !(await names(A)).includes('Visa'), 'Visa gone on A');
  await until(async () => !(await names(B)).includes('Visa'), 'and on B', 15000);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = await testHub(
    [
      { app: 'vault', name: 'Vault', icon: 'vault' },
      { app: 'authenticator', name: 'Authenticator', icon: 'shield-check' },
    ],
    { id: 'vault-hub', name: 'Vault hub' },
  );
  await run('vault', (env) => vaultSuite(env, { app: `${env.base}vault/`, authenticator: `${env.base}authenticator/` }), { webRoot: site });
}
