// Keys and certificates (0.28), checked by the tools servers use: ssh-keygen reads the SSH keys made here
// (with a passphrase too) and their fingerprints, keys it made are read here, and the certificates an SSH CA
// signs here pass its signature check; openssl verifies the X.509 certificates strictly, a TLS handshake with
// them succeeds, an intermediate's chain holds, an openssl CSR is signed with its names, a tampered one is
// refused, and a CA brought in with a key that is not its own is refused.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import tls from 'node:tls';

const { caLines, exportPrivateKey, fingerprint, newSshKey, readPrivateKey, readPublicKey, signCert } = await import('../../shared/ssh.js');
const { createCA, describe, issue, readCsr } = await import('../../shared/x509.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-pki-'));
const file = (name, text) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text, { mode: 0o600 });
  return p;
};
const sshKeygen = (...a) => execFileSync('ssh-keygen', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const openssl = (...a) => execFileSync('openssl', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const type of ['ed25519', 'ecdsa-p256', 'ecdsa-p384', 'rsa-3072']) {
  test(`SSH ${type}: ssh-keygen reads the key, its fingerprint and the encrypted file; reads back ssh-keygen's`, async () => {
    const k = await newSshKey(type, `ada@${type}`);
    const priv = file(`id_${type}`, k.privateKey);
    assert.ok(k.publicKey.startsWith(sshKeygen('-y', '-f', priv).trim()), 'the public key ssh-keygen derives');
    assert.equal(sshKeygen('-l', '-E', 'sha256', '-f', file(`id_${type}.pub`, k.publicKey)).split(' ')[1], k.fingerprint);
    assert.equal(k.fingerprint, await fingerprint(readPublicKey(k.publicKey).blob));
    const encrypted = await exportPrivateKey(k.privateKey, 'file passphrase');
    assert.ok(k.publicKey.startsWith(sshKeygen('-y', '-P', 'file passphrase', '-f', file(`id_${type}_enc`, encrypted)).trim()), 'the encrypted file opens with its passphrase');
    // ssh-keygen's own encrypted key, read here
    const theirs = path.join(dir, `their_${type}`);
    const [kt, ...bits] = type === 'ed25519' ? ['ed25519'] : type.startsWith('ecdsa') ? ['ecdsa', '-b', type.endsWith('384') ? '384' : '256'] : ['rsa', '-b', '3072'];
    sshKeygen('-q', '-t', kt, ...bits, '-N', 'their pass', '-C', 'theirs', '-f', theirs);
    const read = await readPrivateKey(fs.readFileSync(theirs, 'utf8'), 'their pass');
    assert.equal(read.publicKey, fs.readFileSync(`${theirs}.pub`, 'utf8').trim());
    await assert.rejects(readPrivateKey(fs.readFileSync(theirs, 'utf8'), 'wrong'), (err) => err.code === 'ssh.error.passphrase');
    await assert.rejects(readPrivateKey(fs.readFileSync(theirs, 'utf8')), (err) => err.code === 'ssh.error.passphrase');
    // brought in unencrypted, as the vault keeps it
    const plain = await exportPrivateKey(fs.readFileSync(theirs, 'utf8'), '', 'their pass');
    assert.equal((await readPrivateKey(plain)).publicKey, read.publicKey);
  });

  test(`SSH CA ${type}: user and host certificates ssh-keygen accepts; a tampered one it refuses`, async () => {
    const ca = await newSshKey(type, 'ca');
    const user = await newSshKey('ed25519', 'bob@laptop');
    const { certificate, serial } = await signCert(ca.privateKey, user.publicKey, {
      type: 'user',
      keyId: 'bob',
      principals: ['bob', 'deploy'],
      serial: 7,
      validBefore: Date.now() + 3600e3,
      forceCommand: '/usr/bin/true',
      sourceAddress: '10.0.0.0/8',
    });
    assert.equal(serial, 7);
    const shown = sshKeygen('-L', '-f', file(`bob-${type}-cert.pub`, certificate));
    for (const s of ['user certificate', 'Key ID: "bob"', 'Serial: 7', 'bob', 'deploy', 'force-command /usr/bin/true', 'source-address 10.0.0.0/8', 'permit-pty', ca.fingerprint]) assert.ok(shown.includes(s), `${s} in\n${shown}`);
    const host = await newSshKey('ecdsa-p256', 'web1');
    const hc = await signCert(ca.privateKey, host.publicKey, { type: 'host', keyId: 'web1', principals: ['web1.example.org'], validBefore: null });
    const hshown = sshKeygen('-L', '-f', file(`host-${type}-cert.pub`, hc.certificate));
    assert.ok(hshown.includes('host certificate') && hshown.includes('web1.example.org') && hshown.includes('Extensions: (none)'), hshown);
    const [kind, b64] = hc.certificate.split(' ');
    const blob = Buffer.from(b64, 'base64');
    blob[blob.length - 10] ^= 1;
    assert.throws(() => sshKeygen('-L', '-f', file(`bad-${type}-cert.pub`, `${kind} ${blob.toString('base64')}`)), 'a broken signature is refused');
  });
}

test('SSH: the CA’s lines for sshd and known_hosts; a certificate is not a key to sign', async () => {
  const ca = await newSshKey('ed25519', 'ca');
  const lines = await caLines(ca.privateKey, '*.example.org');
  assert.match(lines.trustedUserCAKeys, /^ssh-ed25519 AAAA\S+$/);
  assert.equal(lines.knownHosts, `@cert-authority *.example.org ${lines.trustedUserCAKeys}`);
  const user = await newSshKey('ed25519', 'x');
  const { certificate } = await signCert(ca.privateKey, user.publicKey, { type: 'user', keyId: 'x', principals: ['x'] });
  assert.throws(() => readPublicKey(certificate), (err) => err.code === 'ssh.error.notPublic');
  assert.throws(() => readPublicKey('nonsense'), (err) => err.code === 'ssh.error.notPublic');
  await assert.rejects(readPrivateKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'), (err) => err.code === 'ssh.error.notKey');
});

const handshake = (leaf, caPem) =>
  new Promise((resolve, reject) => {
    const server = tls.createServer({ key: leaf.keyPem, cert: leaf.certPem }, (s) => s.end('hi'));
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

for (const keyType of ['ec-p384', 'ec-p256', 'rsa-2048']) {
  test(`X.509 ${keyType}: a root CA, a server certificate openssl verifies strictly, a TLS handshake`, async () => {
    const ca = await createCA({ cn: `Root ${keyType}`, o: 'Kiwi', c: 'de', keyType, days: 3650 });
    const caFile = file(`ca-${keyType}.pem`, ca.certPem);
    const shown = openssl('x509', '-in', caFile, '-noout', '-subject', '-ext', 'basicConstraints,keyUsage');
    assert.match(shown, /C ?= ?DE/);
    assert.match(shown, /CA:TRUE/);
    assert.match(shown, /Certificate Sign/);
    const leaf = await issue(ca, { kind: 'server', cn: 'localhost', dns: ['localhost'], ips: ['127.0.0.1'], days: 30, keyType: keyType.startsWith('rsa') ? 'rsa-2048' : 'ec-p256' });
    assert.match(openssl('verify', '-x509_strict', '-purpose', 'sslserver', '-CAfile', caFile, file(`leaf-${keyType}.pem`, leaf.certPem)), /: OK/);
    assert.equal(await handshake(leaf, ca.certPem), true);
    const info = await describe(leaf.certPem, leaf.keyPem);
    assert.deepEqual(info.sans, { dns: ['localhost'], ips: ['127.0.0.1'], emails: [] });
    assert.equal(info.subject.cn, 'localhost');
    assert.equal(info.selfSigned, false);
    assert.ok(Math.abs(info.notAfter - leaf.notAfter) < 2000);
    assert.equal((await describe(ca.certPem, ca.keyPem)).selfSigned, true);
  });
}

test('X.509: an intermediate and a client certificate under it; a CSR from openssl signed with its names; a tampered CSR and a foreign key refused', async () => {
  const root = await createCA({ cn: 'Root', keyType: 'ec-p384' });
  const inter = await issue(root, { kind: 'ca', cn: 'Intermediate', days: 1825, keyType: 'ec-p384' });
  const client = await issue({ keyPem: inter.keyPem, certPem: inter.certPem, chainPem: inter.chainPem }, { kind: 'client', cn: 'ada', emails: ['ada@example.org'], days: 90 });
  const verified = openssl('verify', '-x509_strict', '-purpose', 'sslclient', '-CAfile', file('root.pem', root.certPem), '-untrusted', file('inter.pem', inter.certPem), file('client.pem', client.certPem));
  assert.match(verified, /: OK/);
  assert.ok(client.chainPem.includes(inter.certPem) && client.chainPem.includes(root.certPem), 'the full chain');

  openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', path.join(dir, 'csr.key'), '-out', path.join(dir, 'req.csr'), '-subj', '/CN=api.example.org/O=Example', '-addext', 'subjectAltName=DNS:api.example.org,DNS:www.example.org,IP:10.0.0.1');
  const csr = fs.readFileSync(path.join(dir, 'req.csr'), 'utf8');
  assert.deepEqual((await readCsr(csr)).san, { dns: ['api.example.org', 'www.example.org'], ips: ['10.0.0.1'], emails: [] });
  const signed = await issue(root, { kind: 'server', csr, days: 90 });
  assert.equal(signed.keyPem, '', 'the key stays where the request was made');
  const signedFile = file('signed.pem', signed.certPem);
  assert.match(openssl('verify', '-x509_strict', '-CAfile', file('root2.pem', root.certPem), signedFile), /: OK/);
  assert.equal(openssl('pkey', '-in', path.join(dir, 'csr.key'), '-pubout'), openssl('x509', '-in', signedFile, '-noout', '-pubkey'));
  // one character of the signed part changed: the request's own signature no longer holds
  const lines = csr.split('\n');
  lines[2] = lines[2].slice(0, 10) + (lines[2][10] === 'A' ? 'B' : 'A') + lines[2].slice(11);
  await assert.rejects(readCsr(lines.join('\n')), (err) => err.code === 'ca.error.badCsr' || err.message.includes('DER'));
  await assert.rejects(readCsr('nonsense'), (err) => err.code === 'ca.error.notCsr');

  const other = await createCA({ cn: 'Other', keyType: 'ec-p256' });
  await assert.rejects(describe(root.certPem, other.keyPem), (err) => err.code === 'ca.error.keyMismatch');
});
