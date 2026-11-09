// The authenticator's core: TOTP against RFC 6238's own test vectors (SHA-1, SHA-256, SHA-512, eight digits),
// base32 both ways, otpauth URIs as services write them, entries that are not usable refused, and the vault:
// sealed with a passphrase, opened only with it, read again with its key, re-keyed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { base32Decode, base32Encode, cleanEntry, hotp, otpauthOf, parseMigration, parseOtpauth, spaced, totp } = await import('../../shared/totp.js');
const { createVault, isVault, openVault, readVault, rekeyVault, sealVault } = await import('../../shared/vault.js');

const te = new TextEncoder();
const secret = (ascii) => base32Encode(te.encode(ascii));

test('RFC 6238: the test vectors for SHA-1, SHA-256 and SHA-512 at eight digits', async () => {
  const keys = {
    SHA1: secret('12345678901234567890'),
    SHA256: secret('12345678901234567890123456789012'),
    SHA512: secret('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, sha1, sha256, sha512] of vectors) {
    assert.equal((await totp({ secret: keys.SHA1, algorithm: 'SHA1', digits: 8, period: 30 }, t * 1000)).code, sha1, `SHA-1 at ${t}`);
    assert.equal((await totp({ secret: keys.SHA256, algorithm: 'SHA256', digits: 8, period: 30 }, t * 1000)).code, sha256, `SHA-256 at ${t}`);
    assert.equal((await totp({ secret: keys.SHA512, algorithm: 'SHA512', digits: 8, period: 30 }, t * 1000)).code, sha512, `SHA-512 at ${t}`);
  }
});

test('RFC 4226: HOTP for the first counters, six digits', async () => {
  const e = { secret: secret('12345678901234567890') };
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (let c = 0; c < want.length; c++) assert.equal(await hotp(e, c), want[c]);
});

test('a code knows how long it has left, and the next one', async () => {
  const e = { secret: 'JBSWY3DPEHPK3PXP' };
  const at = 1_699_999_985_000; // 5 s into a 30-second step (1699999985 % 30 = 5)
  const now = await totp(e, at);
  assert.equal(now.left, 25);
  assert.equal(now.next, (await totp(e, at + 30_000)).code);
  assert.equal(spaced('123456'), '123 456');
  assert.equal(spaced('12345678'), '1234 5678');
});

test('base32 both ways, with the spaces, dashes and lower case services show', () => {
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq'), te.encode('1234567890'));
  assert.equal(base32Encode(te.encode('1234567890')), 'GEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode('not base32!'), null);
  assert.equal(base32Decode(''), null);
});

test('otpauth URIs as services write them, and back', () => {
  const a = parseOtpauth('otpauth://totp/Shop:ada%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Shop');
  assert.equal(a.issuer, 'Shop');
  assert.equal(a.account, 'ada@example.org');
  assert.deepEqual([a.algorithm, a.digits, a.period], ['SHA1', 6, 30]);
  const b = parseOtpauth('otpauth://totp/ada?secret=jbswy3dpehpk3pxp&algorithm=SHA256&digits=8&period=60');
  assert.deepEqual([b.issuer, b.account, b.algorithm, b.digits, b.period], ['', 'ada', 'SHA256', 8, 60]);
  assert.equal(b.secret, 'JBSWY3DPEHPK3PXP');
  const again = parseOtpauth(otpauthOf(a));
  assert.deepEqual({ ...again, id: a.id }, a);
  assert.equal(parseOtpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), null, 'counters are not taken');
  assert.equal(parseOtpauth('https://example.org'), null);
  assert.equal(parseOtpauth('otpauth://totp/x?secret=AAAA'), null, 'a secret too short');
  assert.equal(cleanEntry({ secret: 'JBSWY3DPEHPK3PXP', digits: 9 }), null);
  assert.equal(cleanEntry({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'MD5' }), null);
});

test('the vault: sealed with a passphrase, opened only with it, read with its key, re-keyed', async () => {
  const items = [cleanEntry({ issuer: 'Shop', account: 'ada', secret: 'JBSWY3DPEHPK3PXP' })];
  await assert.rejects(createVault('short', items), (err) => err.code === 'vault.error.short');
  const { record, key } = await createVault('correct horse battery', items);
  assert.ok(isVault(record));
  assert.ok(!JSON.stringify(record).includes('JBSWY3DPEHPK3PXP'), 'no secret in the record');
  assert.deepEqual((await openVault(record, 'correct horse battery')).items, items);
  await assert.rejects(openVault(record, 'wrong horse battery'), (err) => err.code === 'vault.error.wrong');
  const more = [...items, cleanEntry({ issuer: 'Mail', account: 'ada', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' })];
  const next = await sealVault(record, key, more);
  assert.notEqual(next.iv, record.iv, 'a fresh IV');
  assert.deepEqual(await readVault(next, key), more);
  const moved = await rekeyVault(more, 'a new passphrase here');
  await assert.rejects(openVault(moved.record, 'correct horse battery'), (err) => err.code === 'vault.error.wrong');
  assert.deepEqual((await openVault(moved.record, 'a new passphrase here')).items, more);
});

test('a Google Authenticator export: its accounts, counters left out', () => {
  // a protocol buffer as the export writes it: two TOTP accounts (one SHA-256, eight digits) and one HOTP
  const bytes = (...xs) => xs.flat();
  const str = (field, text) => [field * 8 + 2, text.length, ...te.encode(text)];
  const raw = (field, b) => [field * 8 + 2, b.length, ...b];
  const num = (field, v) => [field * 8, v];
  const otp = (secretAscii, name, issuer, alg, digits, type) => {
    const body = bytes(raw(1, [...te.encode(secretAscii)]), str(2, name), str(3, issuer), num(4, alg), num(5, digits), num(6, type));
    return raw(1, body);
  };
  const payload = Uint8Array.from(bytes(otp('12345678901234567890', 'Shop:ada@example.org', 'Shop', 1, 1, 2), otp('abcdefghij0123456789', 'mail', 'Mail', 2, 2, 2), otp('zzzzzzzzzzzzzzzzzzzz', 'counter', 'Old', 1, 1, 1), num(2, 1)));
  const b64 = btoa(String.fromCharCode(...payload));
  const entries = parseMigration(`otpauth-migration://offline?data=${encodeURIComponent(b64)}`);
  assert.deepEqual(
    entries.map((e) => [e.issuer, e.account, e.algorithm, e.digits]),
    [
      ['Shop', 'ada@example.org', 'SHA1', 6],
      ['Mail', 'mail', 'SHA256', 8],
    ],
  );
  assert.equal(entries[0].secret, base32Encode(te.encode('12345678901234567890')));
  assert.deepEqual(parseMigration('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'), []);
  assert.deepEqual(parseMigration('otpauth-migration://offline?data=%%%'), []);
});
