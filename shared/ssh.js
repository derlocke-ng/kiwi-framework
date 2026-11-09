// SSH keys and an SSH certificate authority in the browser, in OpenSSH's own
// formats: key pairs (Ed25519, ECDSA P-256 and P-384, RSA), the private key as
// an "OPENSSH PRIVATE KEY" file (encrypted with bcrypt-pbkdf and AES-256-CTR
// when a passphrase is given, as ssh-keygen does), the public key as an
// authorized_keys line, the SHA-256 fingerprint; an existing private key read
// back (also an encrypted one, with its passphrase); and certificates
// (PROTOCOL.certkeys): a CA key signs another key for users or hosts, with
// principals, a validity, critical options and extensions. Ed25519 and
// bcrypt-pbkdf come from the vendored bundle (shared/ssh-lib.mjs); ECDSA and
// RSA from WebCrypto.
//
//   const key = await newSshKey('ed25519', 'ada@laptop');
//   key.publicKey  // ssh-ed25519 AAAA… ada@laptop
//   const cert = await signCert(caKey.privateKey, key.publicKey, { type: 'user', keyId: 'ada', principals: ['ada'], days: 30 });
import { bcrypt_pbkdf, ed25519 } from './ssh-lib.mjs';

const te = new TextEncoder();
const td = new TextDecoder();

// ---- the wire format (RFC 4251) ----

const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const u32 = (n) => Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const u64 = (n) => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
};
const str = (v) => {
  const b = typeof v === 'string' ? te.encode(v) : v;
  return cat([u32(b.length), b]);
};
/** An mpint: a positive integer, big-endian, a leading zero when its high bit is set. */
const mpint = (b) => {
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  const v = b.subarray(i);
  return str(v.length && v[0] & 0x80 ? cat([Uint8Array.from([0]), v]) : v);
};

/** A reader over wire data. */
function reader(b) {
  let at = 0;
  const need = (n) => {
    if (at + n > b.length) throw Object.assign(new Error('Truncated SSH data'), { code: 'ssh.error.broken' });
  };
  return {
    u32() {
      need(4);
      const v = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
      at += 4;
      return v;
    },
    bytes() {
      const n = this.u32();
      need(n);
      const v = b.subarray(at, at + n);
      at += n;
      return v;
    },
    text() {
      return td.decode(this.bytes());
    },
    raw(n) {
      need(n);
      const v = b.subarray(at, at + n);
      at += n;
      return v;
    },
    get left() {
      return b.length - at;
    },
  };
}

const b64 = (b) => btoa(String.fromCharCode(...b));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
const toB64u = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- keys ----

export const SSH_TYPES = ['ed25519', 'ecdsa-p256', 'ecdsa-p384', 'rsa-3072', 'rsa-4096'];
const CURVE = { 'ecdsa-p256': ['nistp256', 'P-256', 'SHA-256', 32], 'ecdsa-p384': ['nistp384', 'P-384', 'SHA-384', 48] };
const curveOf = (name) => Object.entries(CURVE).find(([, c]) => c[0] === name);

/** The public key blob of a key's parts. */
function publicBlob(k) {
  if (k.kind === 'ed25519') return cat([str('ssh-ed25519'), str(k.pk)]);
  if (k.kind === 'ecdsa') return cat([str(`ecdsa-sha2-${k.curve}`), str(k.curve), str(k.q)]);
  return cat([str('ssh-rsa'), mpint(k.e), mpint(k.n)]);
}

const typeName = (blob) => reader(blob).text();

/** The SHA-256 fingerprint of a public key blob, as ssh-keygen -l shows it. */
export async function fingerprint(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', blob));
  return `SHA256:${b64(d).replace(/=+$/, '')}`;
}

/** A key's public half as an authorized_keys line. */
const line = (blob, comment) => `${typeName(blob)} ${b64(blob)}${comment ? ` ${comment}` : ''}`;

/** The private key file (openssh-key-v1), encrypted when there is a passphrase. */
async function privateFile(k, comment, passphrase = '') {
  const pub = publicBlob(k);
  const check = crypto.getRandomValues(new Uint8Array(4));
  let body;
  if (k.kind === 'ed25519') body = cat([str('ssh-ed25519'), str(k.pk), str(cat([k.seed, k.pk]))]);
  else if (k.kind === 'ecdsa') body = cat([str(`ecdsa-sha2-${k.curve}`), str(k.curve), str(k.q), mpint(k.d)]);
  else body = cat([str('ssh-rsa'), mpint(k.n), mpint(k.e), mpint(k.d), mpint(k.qi), mpint(k.p), mpint(k.q)]);
  const block = passphrase ? 16 : 8;
  let priv = cat([check, check, body, str(comment || '')]);
  const pad = (block - (priv.length % block)) % block;
  priv = cat([priv, Uint8Array.from({ length: pad }, (_, i) => i + 1)]);
  let cipher = 'none';
  let kdf = 'none';
  let kdfOptions = new Uint8Array();
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const rounds = 16;
    const kiv = derive(passphrase, salt, rounds);
    priv = await aesCtr(kiv, priv);
    cipher = 'aes256-ctr';
    kdf = 'bcrypt';
    kdfOptions = cat([str(salt), u32(rounds)]);
  }
  const file = cat([te.encode('openssh-key-v1\0'), str(cipher), str(kdf), str(kdfOptions), u32(1), str(pub), str(priv)]);
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64(file).match(/.{1,70}/g).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** 48 bytes of bcrypt-pbkdf: the AES-256 key and the counter's start. */
function derive(passphrase, salt, rounds) {
  const pass = te.encode(passphrase);
  const out = new Uint8Array(48);
  if (bcrypt_pbkdf(pass, pass.length, salt, salt.length, out, out.length, rounds) !== 0) throw new Error('bcrypt_pbkdf failed');
  return out;
}

async function aesCtr(kiv, data) {
  const key = await crypto.subtle.importKey('raw', kiv.subarray(0, 32), 'AES-CTR', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter: kiv.subarray(32, 48), length: 128 }, key, data));
}

/** The parts of a key from WebCrypto's JWK. */
const fromJwk = (j, curveName) =>
  curveName ? { kind: 'ecdsa', curve: curveName, q: cat([Uint8Array.from([4]), b64u(j.x), b64u(j.y)]), d: b64u(j.d) } : { kind: 'rsa', n: b64u(j.n), e: b64u(j.e), d: b64u(j.d), p: b64u(j.p), q: b64u(j.q), qi: b64u(j.qi) };

/**
 * A new key pair: its public line, its private file (with a passphrase, encrypted), its fingerprint.
 * @param {string} type  one of SSH_TYPES
 * @param {string} [comment]
 */
export async function newSshKey(type = 'ed25519', comment = '') {
  let k;
  if (type === 'ed25519') {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    k = { kind: 'ed25519', seed, pk: ed25519.getPublicKey(seed) };
  } else if (CURVE[type]) {
    const [name, namedCurve] = CURVE[type];
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, ['sign']);
    k = fromJwk(await crypto.subtle.exportKey('jwk', pair.privateKey), name);
  } else if (/^rsa-(2048|3072|4096)$/.test(type)) {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: Number(type.slice(4)), publicExponent: Uint8Array.from([1, 0, 1]), hash: 'SHA-512' }, true, ['sign']);
    k = fromJwk(await crypto.subtle.exportKey('jwk', pair.privateKey));
  } else throw new Error(`Unknown key type ${type}`);
  const blob = publicBlob(k);
  return { type, publicKey: line(blob, comment), privateKey: await privateFile(k, comment), fingerprint: await fingerprint(blob), comment };
}

/**
 * A private key file read: its parts, its comment, its public line. An encrypted one needs its passphrase
 * (`ssh.error.passphrase` without it or with another).
 * @param {string} text
 * @param {string} [passphrase]
 */
export async function readPrivateKey(text, passphrase = '') {
  const m = String(text).match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/);
  if (!m) throw Object.assign(new Error('Not an OpenSSH private key'), { code: 'ssh.error.notKey' });
  const file = unb64(m[1].replace(/\s+/g, ''));
  const magic = te.encode('openssh-key-v1\0');
  if (!magic.every((c, i) => file[i] === c)) throw Object.assign(new Error('Not an OpenSSH private key'), { code: 'ssh.error.notKey' });
  const r = reader(file.subarray(magic.length));
  const cipher = r.text();
  const kdf = r.text();
  const kdfOptions = r.bytes();
  if (r.u32() !== 1) throw Object.assign(new Error('More than one key'), { code: 'ssh.error.broken' });
  r.bytes(); // the public key, repeated inside
  let priv = r.bytes();
  if (cipher !== 'none') {
    if (cipher !== 'aes256-ctr' || kdf !== 'bcrypt') throw Object.assign(new Error(`Unsupported cipher ${cipher}`), { code: 'ssh.error.cipher' });
    if (!passphrase) throw Object.assign(new Error('This key has a passphrase'), { code: 'ssh.error.passphrase' });
    const o = reader(kdfOptions);
    const salt = o.bytes();
    priv = await aesCtr(derive(passphrase, salt, o.u32()), priv);
  }
  const p = reader(priv);
  if (p.u32() !== p.u32()) throw Object.assign(new Error('Wrong passphrase'), { code: 'ssh.error.passphrase' });
  const kind = p.text();
  let k;
  if (kind === 'ssh-ed25519') {
    const pk = p.bytes();
    k = { kind: 'ed25519', pk, seed: p.bytes().slice(0, 32) };
  } else if (kind.startsWith('ecdsa-sha2-')) {
    k = { kind: 'ecdsa', curve: p.text(), q: p.bytes(), d: p.bytes() };
    if (!curveOf(k.curve)) throw Object.assign(new Error(`Unsupported curve ${k.curve}`), { code: 'ssh.error.cipher' });
  } else if (kind === 'ssh-rsa') {
    k = { kind: 'rsa', n: p.bytes(), e: p.bytes(), d: p.bytes(), qi: p.bytes(), p: p.bytes(), q: p.bytes() };
  } else throw Object.assign(new Error(`Unsupported key ${kind}`), { code: 'ssh.error.cipher' });
  const comment = p.text();
  const blob = publicBlob(k);
  return { key: k, comment, publicKey: line(blob, comment), fingerprint: await fingerprint(blob) };
}

/**
 * The private file again, with a passphrase or without (an export, or a key brought in whose file had one).
 * @param {string} text
 * @param {string} [passphrase]  the new file's
 * @param {string} [current]  the given file's, when it has one
 */
export async function exportPrivateKey(text, passphrase = '', current = '') {
  const { key, comment } = await readPrivateKey(text, current);
  return privateFile(key, comment, passphrase);
}

/** A public key line read: its type, blob and comment. */
export function readPublicKey(text) {
  const m = String(text).trim().match(/^(\S+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/);
  if (!m) throw Object.assign(new Error('Not an SSH public key'), { code: 'ssh.error.notPublic' });
  const blob = unb64(m[2]);
  if (typeName(blob) !== m[1] || m[1].includes('-cert-')) throw Object.assign(new Error('Not an SSH public key'), { code: 'ssh.error.notPublic' });
  return { type: m[1], blob, comment: m[3] || '' };
}

// ---- signatures ----

const trim0 = (b) => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
};

const bigBytes = (n) => {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
};
const big = (b) => BigInt(`0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') || '0'}`);

/** A signature blob (the "string signature" of PROTOCOL.certkeys) by a key's parts. */
async function signBlob(k, data) {
  if (k.kind === 'ed25519') return cat([str('ssh-ed25519'), str(ed25519.sign(data, k.seed))]);
  if (k.kind === 'ecdsa') {
    const [, [, namedCurve, hash, size]] = curveOf(k.curve);
    const x = k.q.subarray(1, 1 + size);
    const y = k.q.subarray(1 + size);
    const pad = (b) => {
      const t = trim0(b);
      const o = new Uint8Array(size);
      o.set(t, size - t.length);
      return o;
    };
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: namedCurve, x: toB64u(x), y: toB64u(y), d: toB64u(pad(k.d)) }, { name: 'ECDSA', namedCurve }, false, ['sign']);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash }, key, data));
    return cat([str(`ecdsa-sha2-${k.curve}`), str(cat([mpint(raw.subarray(0, size)), mpint(raw.subarray(size))]))]);
  }
  // RSA: rsa-sha2-512; WebCrypto wants the CRT parts as a JWK
  const d = big(k.d);
  const jwk = {
    kty: 'RSA',
    n: toB64u(trim0(k.n)),
    e: toB64u(trim0(k.e)),
    d: toB64u(trim0(k.d)),
    p: toB64u(trim0(k.p)),
    q: toB64u(trim0(k.q)),
    dp: toB64u(bigBytes(d % (big(k.p) - 1n))),
    dq: toB64u(bigBytes(d % (big(k.q) - 1n))),
    qi: toB64u(trim0(k.qi)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, false, ['sign']);
  return cat([str('rsa-sha2-512'), str(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data)))]);
}

// ---- certificates ----

export const USER_EXTENSIONS = ['permit-X11-forwarding', 'permit-agent-forwarding', 'permit-port-forwarding', 'permit-pty', 'permit-user-rc'];
const FOREVER = 0xffffffffffffffffn;

/**
 * A certificate for a public key, signed by a CA's private key file.
 * @param {string} caPrivateKey  the CA's OPENSSH PRIVATE KEY (as the vault keeps it)
 * @param {string} publicKey  the key to certify, an authorized_keys line
 * @param {{ type: 'user' | 'host', keyId: string, principals: string[], serial?: number, validAfter?: number, validBefore?: number | null,
 *   extensions?: string[], forceCommand?: string, sourceAddress?: string }} o  times in ms; validBefore null: forever
 * @returns {Promise<{ certificate: string, serial: number }>}
 */
export async function signCert(caPrivateKey, publicKey, o) {
  const ca = await readPrivateKey(caPrivateKey);
  const subject = readPublicKey(publicKey);
  const fields = reader(subject.blob);
  fields.text(); // the type, named again by the certificate's
  const keyFields = subject.blob.subarray(4 + te.encode(subject.type).length);
  const certType = `${subject.type}-cert-v01@openssh.com`;
  const serial = o.serial ?? Number(crypto.getRandomValues(new Uint32Array(1))[0]);
  const after = BigInt(Math.floor((o.validAfter ?? Date.now() - 5 * 60_000) / 1000));
  const before = o.validBefore == null ? FOREVER : BigInt(Math.floor(o.validBefore / 1000));
  const critical = [];
  if (o.forceCommand) critical.push(['force-command', o.forceCommand]);
  if (o.sourceAddress) critical.push(['source-address', o.sourceAddress]);
  critical.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const extensions = o.type === 'user' ? [...(o.extensions ?? USER_EXTENSIONS)].sort() : [];
  const body = cat([
    str(certType),
    str(crypto.getRandomValues(new Uint8Array(32))),
    keyFields,
    u64(serial),
    u32(o.type === 'host' ? 2 : 1),
    str(o.keyId || ''),
    str(cat(o.principals.map((p) => str(p)))),
    u64(after),
    u64(before),
    str(cat(critical.map(([n, v]) => cat([str(n), str(str(v))])))),
    str(cat(extensions.map((n) => cat([str(n), str('')])))),
    str(''),
    str(publicBlob(ca.key)),
  ]);
  const cert = cat([body, str(await signBlob(ca.key, body))]);
  return { certificate: `${certType} ${b64(cert)} ${o.keyId || subject.comment}`.trim(), serial };
}

/** The CA's public key, as a line for sshd's TrustedUserCAKeys or a known_hosts @cert-authority entry. */
export async function caLines(caPrivateKey, hosts = '*') {
  const { publicKey } = await readPrivateKey(caPrivateKey);
  const bare = publicKey.split(' ').slice(0, 2).join(' ');
  return { trustedUserCAKeys: bare, knownHosts: `@cert-authority ${hosts} ${bare}` };
}
