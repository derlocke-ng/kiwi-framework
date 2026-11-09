// The password manager in a browser: a vault set up with its own passphrase;
// a login made with a generated password, a site, a 2FA secret and a custom
// field, its password copied, its code as RFC 6238 gives it, a new password
// keeping the old one in its history; a note and a card; the filters and the
// search; nothing readable on the relay; the same login's code in the
// authenticator; the health report (weak and reused passwords, and the breach
// check, off until turned on, then asking a stand-in for Have I Been Pwned with
// five hex characters only); an import from a browser's CSV, the same again
// skipped; a plain export behind its warning; a second device of the key
// opening the vault and an edit there showing here; keys and certificates (an
// SSH key ssh-keygen reads, used as a CA whose user certificate ssh-keygen
// accepts, an encrypted key brought in; an X.509 root CA whose server
// certificate openssl verifies and a TLS handshake trusts, a CSR signed); the
// generator on its own page; a deletion. Exported for a distribution's own run
// (Armory's mount).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { exportPrivateKey, newSshKey } from '../../shared/ssh.js';
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

  step('an SSH key made here: ssh-keygen reads its private file and its fingerprint');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-keys-'));
  const save = (name, text) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 });
    return p;
  };
  const tool = (cmd, ...a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const block = (page, id) => page.$eval(`[data-text=${id}]`, (el) => el.textContent);
  await newEntry(A, 'ssh');
  await A.fill('#entryForm [name=name]', 'Laptop');
  await A.selectOption('#entryForm [name=keyType]', 'ed25519');
  await A.fill('#entryForm [name=comment]', 'ada@laptop');
  await A.click('#saveEntry');
  await A.waitForSelector('#sshView', { timeout: 20000 });
  const pub = (await block(A, 'public')).trim();
  assert.match(pub, /^ssh-ed25519 AAAA\S+ ada@laptop$/);
  await A.click('[data-act=show-private]');
  const priv = await block(A, 'private');
  assert.ok(pub.startsWith(tool('ssh-keygen', '-y', '-f', save('laptop', priv)).trim()), 'ssh-keygen derives the same public key');
  const fp = await A.getAttribute('[data-field=fingerprint] .pw-value', 'data-value');
  assert.equal(tool('ssh-keygen', '-l', '-E', 'sha256', '-f', save('laptop.pub', pub)).split(' ')[1], fp);

  step('the key as an SSH CA: a user certificate ssh-keygen accepts, signed by it');
  await A.click('#makeCa');
  await A.waitForSelector('#signForm');
  const bob = await newSshKey('ed25519', 'bob@desk');
  await A.fill('#signForm [name=publicKey]', bob.publicKey);
  await A.fill('#signForm [name=keyId]', 'bob');
  await A.fill('#signForm [name=principals]', 'bob deploy');
  await A.click('#signBtn');
  await A.waitForSelector('[data-text=cert]', { timeout: 20000 });
  const shown = tool('ssh-keygen', '-L', '-f', save('bob-cert.pub', (await block(A, 'cert')).trim()));
  for (const x of ['user certificate', 'Key ID: "bob"', 'deploy', fp, 'permit-pty']) assert.ok(shown.includes(x), `${x} in\n${shown}`);
  assert.match(await block(A, 'knownHosts'), /^@cert-authority \* ssh-ed25519 AAAA/);
  await closePanel(A);

  step('an encrypted SSH key brought in with its passphrase');
  const theirs = await newSshKey('ecdsa-p256', 'old@server');
  await newEntry(A, 'ssh');
  await A.click('[data-mode=import]');
  await A.fill('#entryForm [name=name]', 'Old server key');
  await A.fill('#entryForm [name=privateKey]', await exportPrivateKey(theirs.privateKey, 'file pass'));
  await A.fill('#entryForm [name=passphrase]', 'wrong');
  await A.click('#saveEntry');
  await A.waitForSelector('#editorError');
  await A.fill('#entryForm [name=passphrase]', 'file pass');
  await A.click('#saveEntry');
  await A.waitForSelector('#sshView', { timeout: 20000 });
  assert.equal(await A.getAttribute('[data-field=fingerprint] .pw-value', 'data-value'), theirs.fingerprint);
  await closePanel(A);

  step('an X.509 root CA; a server certificate openssl verifies and a TLS handshake trusts');
  await newEntry(A, 'ca');
  await A.fill('#entryForm [name=cn]', 'Test Root CA');
  await A.click('#entryForm .pw-more summary'); // organisation, country, place: folded away
  await A.fill('#entryForm [name=o]', 'Kiwi');
  await A.selectOption('#entryForm [name=keyType]', 'ec-p256');
  await A.click('#saveEntry');
  await A.waitForSelector('#pkiView', { timeout: 20000 });
  const caPem = await block(A, 'cert');
  assert.match(tool('openssl', 'x509', '-in', save('ca.pem', caPem), '-noout', '-ext', 'basicConstraints'), /CA:TRUE/);
  const caUrl = A.url();
  await A.fill('#issueForm [name=cn]', 'localhost');
  await A.fill('#issueForm [name=names]', 'localhost 127.0.0.1');
  await A.click('#issueBtn');
  await A.waitForSelector('#pkiView [data-block=chain]', { timeout: 20000 });
  const certPem = await block(A, 'cert');
  await A.click('[data-act=show-key]');
  const keyPem = await block(A, 'key');
  assert.match(tool('openssl', 'verify', '-x509_strict', '-purpose', 'sslserver', '-CAfile', save('ca2.pem', caPem), save('leaf.pem', certPem)), /: OK/);
  const trusted = await new Promise((resolve, reject) => {
    const server = tls.createServer({ key: keyPem, cert: certPem }, (c) => c.end('hi'));
    server.listen(0, '127.0.0.1', () => {
      const c = tls.connect({ port: server.address().port, host: '127.0.0.1', servername: 'localhost', ca: caPem }, () => {
        const ok = c.authorized;
        c.end();
        server.close();
        resolve(ok);
      });
      c.on('error', (e) => (server.close(), reject(e)));
    });
  });
  assert.equal(trusted, true, 'a TLS client trusting the CA accepts the certificate');

  step('a certificate signing request from openssl, signed by the CA: its key stays where it was made');
  await A.goto(caUrl);
  await A.waitForSelector('#issueForm');
  tool('openssl', 'req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', path.join(tmp, 'req.key'), '-out', path.join(tmp, 'req.csr'), '-subj', '/CN=api.example.org', '-addext', 'subjectAltName=DNS:api.example.org');
  await A.click('#issueForm .pw-more summary');
  await A.fill('#issueForm [name=csr]', fs.readFileSync(path.join(tmp, 'req.csr'), 'utf8'));
  await A.click('#issueBtn');
  await A.waitForSelector('#entryView[data-entry="api.example.org"] #pkiView', { timeout: 20000 });
  assert.equal(await A.$$eval('[data-block=key]', (els) => els.length), 0, 'no private key: it stayed with the request');
  assert.match(tool('openssl', 'verify', '-x509_strict', '-CAfile', save('ca3.pem', caPem), save('api.pem', await block(A, 'cert'))), /: OK/);
  await A.goto(`${app}#/`); // the certificate opened from the CA's page: back to the list directly
  await A.waitForSelector('#entryView', { state: 'detached' });

  // TLS certificates in one step (0.29), like kiwi-server's ksslgen and more
  const tlsEntry = async (mode, fill) => {
    await newEntry(A, 'tls');
    await A.click(`[data-mode=${mode}]`);
    await fill();
    await A.click('#saveEntry');
    await A.waitForSelector('#pkiView', { timeout: 20000 });
  };
  const saved = async (act) => {
    const [d] = await Promise.all([A.waitForEvent('download'), A.click(act)]);
    return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
  };

  step('a TLS certificate from my CA for a host and *.host, as privkey.pem, cert.pem and fullchain.pem, with nginx lines');
  await tlsEntry('ca', async () => {
    await A.fill('#entryForm [name=cn]', 'cloud.office.lan');
    await A.fill('#entryForm [name=names]', '10.0.0.5');
  });
  assert.equal(await A.textContent('[data-field=sans] .pw-value'), 'cloud.office.lan, *.cloud.office.lan, 10.0.0.5');
  for (const host of ['cloud.office.lan', 'mail.cloud.office.lan']) {
    assert.match(tool('openssl', 'verify', '-x509_strict', '-CAfile', save('ca4.pem', caPem), '-verify_hostname', host, save('cloud.pem', await block(A, 'cert'))), /: OK/, host);
  }
  assert.equal((await saved('[data-act=save-chain]')).name, 'fullchain.pem');
  assert.equal((await saved('[data-act=save-cert]')).name, 'cert.pem');
  assert.equal((await saved('[data-act=save-key]')).name, 'privkey.pem');
  assert.match(await block(A, 'nginx'), /ssl_certificate +\/etc\/ssl\/cloud\.office\.lan\/fullchain\.pem;\nssl_certificate_key \/etc\/ssl\/cloud\.office\.lan\/privkey\.pem;/);

  step('renewing it: a new certificate for the same names, the old serial remembered');
  const firstCert = await block(A, 'cert');
  await A.click('#renewBtn');
  await A.click('[data-ok]');
  await until(async () => (await block(A, 'cert')) !== firstCert, 'the renewed certificate');
  await A.waitForSelector('#previous');
  assert.match(tool('openssl', 'verify', '-CAfile', save('ca5.pem', caPem), '-verify_hostname', 'files.cloud.office.lan', save('cloud2.pem', await block(A, 'cert'))), /: OK/);

  step('a self-signed certificate a TLS client told to trust it accepts');
  await tlsEntry('self', async () => {
    await A.fill('#entryForm [name=cn]', '127.0.0.1');
    await A.fill('#entryForm [name=name]', 'Self test');
  });
  const selfCert = await block(A, 'cert');
  await A.click('[data-act=show-key]');
  const selfKey = await block(A, 'key');
  const selfOk = await new Promise((resolve, reject) => {
    const server = tls.createServer({ key: selfKey, cert: selfCert }, (c) => c.end('hi'));
    server.listen(0, '127.0.0.1', () => {
      const c = tls.connect({ port: server.address().port, host: '127.0.0.1', ca: selfCert }, () => {
        const ok = c.authorized;
        c.end();
        server.close();
        resolve(ok);
      });
      c.on('error', (e) => (server.close(), reject(e)));
    });
  });
  assert.equal(selfOk, true);

  step('for another CA: a key and request; openssl as that CA signs it; a wrong certificate refused, the right one stored');
  await tlsEntry('external', async () => {
    await A.fill('#entryForm [name=cn]', 'api2.example.org');
  });
  await A.waitForSelector('#pendingHint');
  const csrFile = save('api2.csr', await block(A, 'csr'));
  tool('openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', path.join(tmp, 'outside.key'), '-out', path.join(tmp, 'outside.pem'), '-subj', '/CN=Outside CA', '-days', '30');
  fs.writeFileSync(path.join(tmp, 'ext.cnf'), 'basicConstraints=CA:FALSE\nsubjectAltName=DNS:api2.example.org,DNS:*.api2.example.org\n');
  tool('openssl', 'x509', '-req', '-in', csrFile, '-CA', path.join(tmp, 'outside.pem'), '-CAkey', path.join(tmp, 'outside.key'), '-CAcreateserial', '-days', '30', '-extfile', path.join(tmp, 'ext.cnf'), '-out', path.join(tmp, 'api2.pem'));
  await A.fill('#pasteForm [name=certPem]', selfCert);
  await A.click('#pasteBtn');
  await A.waitForSelector('#pasteError');
  await A.fill('#pasteForm [name=certPem]', fs.readFileSync(path.join(tmp, 'api2.pem'), 'utf8') + fs.readFileSync(path.join(tmp, 'outside.pem'), 'utf8'));
  await A.click('#pasteBtn');
  await A.waitForSelector('#pendingHint', { state: 'detached', timeout: 15000 });
  assert.match(await block(A, 'chain'), /BEGIN CERTIFICATE[\s\S]+BEGIN CERTIFICATE/, 'the chain that came with it');
  assert.match(tool('openssl', 'verify', '-CAfile', path.join(tmp, 'outside.pem'), save('api2-back.pem', await block(A, 'cert'))), /: OK/);

  step('a CA limited to its domains: openssl accepts what is under them and refuses the rest; the CA on devices as DER');
  await newEntry(A, 'ca');
  await A.fill('#entryForm [name=cn]', 'Office CA');
  await A.fill('#entryForm [name=permitted]', 'office.lan 10.8.0.0/16');
  await A.click('#saveEntry');
  await A.waitForSelector('#pkiView [data-field=permitted]', { timeout: 20000 });
  const officeCa = await block(A, 'cert');
  const officeUrl = A.url();
  const der = await saved('#saveCer');
  assert.equal(der.name, 'Office-CA.cer');
  tool('openssl', 'x509', '-in', save('office2.pem', officeCa), '-outform', 'der', '-out', path.join(tmp, 'office.der'));
  assert.deepEqual(der.bytes, fs.readFileSync(path.join(tmp, 'office.der')));
  for (const [host, ok] of [
    ['nas.office.lan', true],
    ['bank.example.com', false],
  ]) {
    await A.goto(officeUrl);
    await A.waitForSelector('#issueForm');
    await A.fill('#issueForm [name=cn]', host);
    await A.click('#issueBtn');
    await A.waitForSelector(`#entryView[data-entry="${host}"] #pkiView`, { timeout: 20000 });
    const leaf = save(`${host}.pem`, await block(A, 'cert'));
    if (ok) assert.match(tool('openssl', 'verify', '-CAfile', path.join(tmp, 'office2.pem'), leaf), /: OK/);
    else assert.throws(() => tool('openssl', 'verify', '-CAfile', path.join(tmp, 'office2.pem'), leaf), /permitted subtree violation|name constraints/i);
  }

  step('an old CA brought in as openssl made it (a PKCS #1 key); a short-lived certificate shows in the health report');
  tool('openssl', 'genrsa', '-traditional', '-out', path.join(tmp, 'kiwiCA.key'), '2048');
  tool('openssl', 'req', '-x509', '-new', '-nodes', '-key', path.join(tmp, 'kiwiCA.key'), '-sha256', '-days', '3650', '-subj', '/C=NZ/ST=kiwi/L=kiwi/O=kiwi/OU=kiwi/CN=kiwiCA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', path.join(tmp, 'kiwiCA.pem'));
  await newEntry(A, 'ca');
  await A.click('[data-mode=import]');
  await A.fill('#entryForm [name=certPem]', fs.readFileSync(path.join(tmp, 'kiwiCA.pem'), 'utf8'));
  await A.fill('#entryForm [name=keyPem]', fs.readFileSync(path.join(tmp, 'kiwiCA.key'), 'utf8'));
  await A.click('#saveEntry');
  await A.waitForSelector('#entryView[data-entry="kiwiCA"] #issueForm', { timeout: 20000 });
  await A.fill('#issueForm [name=cn]', 'sh3.kiwi');
  await A.click('#issueBtn');
  await A.waitForSelector('#entryView[data-entry="sh3.kiwi"] #pkiView', { timeout: 20000 });
  assert.match(tool('openssl', 'verify', '-CAfile', path.join(tmp, 'kiwiCA.pem'), '-verify_hostname', 'cloud.sh3.kiwi', save('sh3.pem', await block(A, 'cert'))), /: OK/);
  await tlsEntry('self', async () => {
    await A.fill('#entryForm [name=cn]', 'soon.lan');
    await A.fill('#entryForm [name=days]', '10');
  });
  await A.goto(`${app}#/health`);
  await A.waitForSelector('#expiring [data-entry="soon.lan"]');
  assert.equal(await A.$$eval('#expiring [data-entry]', (els) => els.length), 1, 'only the one that runs out within a month');
  await A.goto(`${app}#/`);
  await A.waitForSelector('#entries');

  await A.click('[data-filter=keys]');
  assert.deepEqual((await names(A)).sort(), [
    'Laptop',
    'Office CA',
    'Old server key',
    'Self test',
    'Test Root CA',
    'api.example.org',
    'api2.example.org',
    'bank.example.com',
    'cloud.office.lan',
    'kiwiCA',
    'localhost',
    'nas.office.lan',
    'sh3.kiwi',
    'soon.lan',
  ]);
  await A.click('[data-filter=all]');
  const sealed = JSON.stringify(await env.relayEvents([{ authors: [identity.pk] }]));
  for (const x of ['PRIVATE KEY', 'CERTIFICATE', 'ssh-ed25519', 'Test Root CA']) assert.ok(!sealed.includes(x), `no ${x} on the relay`);

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
