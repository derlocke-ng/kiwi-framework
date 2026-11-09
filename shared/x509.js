// A certificate authority in the browser: X.509 certificates (RFC 5280) made
// and signed with WebCrypto, DER written and read here. A root CA, and from it
// server and client certificates or an intermediate CA, for a key made here or
// for a certificate signing request (PKCS #10) whose key stays where it was
// made. ECDSA (P-256, P-384) and RSA (2048 to 4096 bits) keys; SHA-256 (or
// SHA-384 with P-384) signatures. The vault keeps the CA's key; nothing of it
// goes anywhere else.
//
//   const ca = await createCA({ cn: 'Example Root CA', o: 'Example' });
//   const leaf = await issue(ca, { kind: 'server', cn: 'www.example.org', dns: ['www.example.org'], days: 397 });
//   leaf.certPem, leaf.keyPem, leaf.chainPem

// ---- DER ----

const te = new TextEncoder();
const td = new TextDecoder();

function lenBytes(n) {
  if (n < 0x80) return [n];
  const out = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | out.length, ...out];
}

const cat = (parts) => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** A TLV: tag, length, value. */
export const tlv = (tag, ...values) => {
  const body = cat(values.map((v) => (v instanceof Uint8Array ? v : Uint8Array.from(v))));
  return cat([Uint8Array.from([tag, ...lenBytes(body.length)]), body]);
};
export const seq = (...v) => tlv(0x30, ...v);
export const set = (...v) => tlv(0x31, ...v);
export const ctx = (n, ...v) => tlv(0xa0 + n, ...v); // [n] EXPLICIT, constructed
const ctxPrim = (n, v) => tlv(0x80 + n, v); // [n] IMPLICIT, primitive
const nullDer = Uint8Array.from([0x05, 0x00]);
const bool = (b) => tlv(0x01, [b ? 0xff : 0x00]);
const utf8 = (s) => tlv(0x0c, te.encode(s));
const printable = (s) => tlv(0x13, te.encode(s));
const ia5 = (s) => tlv(0x16, te.encode(s));
const octets = (b) => tlv(0x04, b);
const bits = (b, unused = 0) => tlv(0x03, [unused], b);

/** A positive INTEGER from big-endian bytes (a leading zero when the high bit is set; leading zeros trimmed). */
export function intBytes(b) {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return tlv(0x02, v[0] & 0x80 ? cat([Uint8Array.from([0]), v]) : v);
}
const int = (n) => {
  const out = [];
  do {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  return intBytes(Uint8Array.from(out));
};

/** An OBJECT IDENTIFIER from its dotted form. */
export function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = Math.floor(p / 128);
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...stack);
  }
  return tlv(0x06, out);
}

/** UTCTime until 2049, GeneralizedTime after (RFC 5280 §4.1.2.5). */
function time(d) {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  return d.getUTCFullYear() < 2050 ? tlv(0x17, te.encode(`${iso.slice(2)}Z`)) : tlv(0x18, te.encode(`${iso}Z`));
}

/** A DER element read: its tag, its value's place, and where the next one starts. */
export function readTlv(b, at = 0) {
  const tag = b[at];
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error('DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
    start += n;
  }
  if (start + len > b.length) throw new Error('DER truncated');
  return { tag, start, end: start + len, value: b.subarray(start, start + len), raw: b.subarray(at, start + len) };
}

/** The elements inside a constructed one. */
export function children(b) {
  const out = [];
  for (let at = 0; at < b.length; ) {
    const e = readTlv(b, at);
    out.push(e);
    at = e.end;
  }
  return out;
}

const oidString = (v) => {
  const out = [Math.floor(v[0] / 40), v[0] % 40];
  let n = 0;
  for (const byte of v.subarray(1)) {
    n = n * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      out.push(n);
      n = 0;
    }
  }
  return out.join('.');
};

// ---- PEM ----

const b64 = (b) => btoa(String.fromCharCode(...b));
export const pem = (label, der) => `-----BEGIN ${label}-----\n${b64(der).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
export function unpem(text, label = null) {
  const m = String(text).match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m || (label && m[1] !== label)) return null;
  const bin = atob(m[2].replace(/\s+/g, ''));
  return { label: m[1], der: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
}

// ---- keys and signatures ----

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  rsaEncryption: '1.2.840.113549.1.1.1',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  rsaSha256: '1.2.840.113549.1.1.11',
  cn: '2.5.4.3',
  c: '2.5.4.6',
  l: '2.5.4.7',
  st: '2.5.4.8',
  o: '2.5.4.10',
  ou: '2.5.4.11',
  subjectKeyId: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  authorityKeyId: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
  clientAuth: '1.3.6.1.5.5.7.3.2',
  extensionRequest: '1.2.840.113549.1.9.14',
};

export const KEY_TYPES = ['ec-p256', 'ec-p384', 'rsa-2048', 'rsa-3072', 'rsa-4096'];

const genParams = (type) =>
  type.startsWith('ec-')
    ? { name: 'ECDSA', namedCurve: type === 'ec-p384' ? 'P-384' : 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: Number(type.split('-')[1]), publicExponent: Uint8Array.from([1, 0, 1]), hash: 'SHA-256' };

const signParams = (alg) => (alg.name === 'ECDSA' ? { name: 'ECDSA', hash: alg.namedCurve === 'P-384' ? 'SHA-384' : 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' });
const sigAlgId = (alg) => seq(oid(alg.name === 'ECDSA' ? (alg.namedCurve === 'P-384' ? OID.ecdsaSha384 : OID.ecdsaSha256) : OID.rsaSha256), ...(alg.name === 'ECDSA' ? [] : [nullDer]));

/** WebCrypto's ECDSA signature (r ‖ s) as X.509 wants it: SEQUENCE { INTEGER r, INTEGER s }. */
function ecdsaDer(raw) {
  const half = raw.length / 2;
  return seq(intBytes(raw.subarray(0, half)), intBytes(raw.subarray(half)));
}

/** A new key pair; the private key as PKCS #8 PEM, the public key's SubjectPublicKeyInfo. */
export async function newKey(type = 'ec-p256') {
  if (!KEY_TYPES.includes(type)) throw new Error(`Unknown key type ${type}`);
  const pair = await crypto.subtle.generateKey(genParams(type), true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { type, keyPem: pem('PRIVATE KEY', pkcs8), spki, privateKey: pair.privateKey };
}

/** The key's algorithm, read from its SubjectPublicKeyInfo. */
function spkiAlgorithm(spki) {
  const [algId] = children(readTlv(spki).value);
  const [kind, param] = children(algId.value);
  const k = oidString(kind.value);
  if (k === OID.ecPublicKey) {
    const curve = oidString(param.value);
    if (curve === OID.p256) return { name: 'ECDSA', namedCurve: 'P-256' };
    if (curve === OID.p384) return { name: 'ECDSA', namedCurve: 'P-384' };
    throw Object.assign(new Error('Unsupported curve'), { code: 'ca.error.keyType' });
  }
  if (k === OID.rsaEncryption) return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  throw Object.assign(new Error('Unsupported key'), { code: 'ca.error.keyType' });
}

/** A signing key from its PKCS #8 PEM. */
export async function importSigningKey(keyPem, spki) {
  const p = unpem(keyPem, 'PRIVATE KEY');
  if (!p) throw Object.assign(new Error('Not a PKCS #8 key'), { code: 'ca.error.notKey' });
  return crypto.subtle.importKey('pkcs8', p.der, spkiAlgorithm(spki), false, ['sign']);
}

async function sign(privateKey, data) {
  const alg = privateKey.algorithm;
  const sig = new Uint8Array(await crypto.subtle.sign(signParams(alg), privateKey, data));
  return alg.name === 'ECDSA' ? ecdsaDer(sig) : sig;
}

// ---- names and extensions ----

const NAME_PARTS = ['c', 'st', 'l', 'o', 'ou', 'cn'];

/** A distinguished name: country, state, locality, organisation, unit, common name, those given, in that order. */
export function name(n) {
  return seq(
    ...NAME_PARTS.filter((k) => n[k]).map((k) =>
      set(seq(oid(OID[k]), k === 'c' ? printable(String(n[k]).toUpperCase().slice(0, 2)) : utf8(String(n[k]).slice(0, 64)))),
    ),
  );
}

const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

/** The SHA-1 of a key's bits (RFC 5280 §4.2.1.2, method 1): its subject key identifier. */
async function keyId(spki) {
  const [, pub] = children(readTlv(spki).value);
  return new Uint8Array(await crypto.subtle.digest('SHA-1', pub.value.subarray(1)));
}

const ipBytes = (ip) => {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return Uint8Array.from(ip.split('.').map(Number));
  if (ip.includes(':')) {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
    return Uint8Array.from(groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]));
  }
  return null;
};

function sanExtension({ dns = [], ips = [], emails = [] }) {
  const names = [...dns.map((d) => ctxPrim(2, te.encode(d))), ...ips.map(ipBytes).filter(Boolean).map((b) => ctxPrim(7, b)), ...emails.map((e) => ctxPrim(1, te.encode(e)))];
  return names.length ? ext(OID.subjectAltName, false, seq(...names)) : null;
}

// keyUsage bits: digitalSignature(0) keyEncipherment(2) keyCertSign(5) cRLSign(6)
const keyUsage = (bitsSet) => {
  let byte = 0;
  for (const b of bitsSet) byte |= 0x80 >> b;
  const unused = (() => {
    for (let i = 0; i < 8; i++) if (byte & (1 << i)) return i;
    return 7;
  })();
  return ext(OID.keyUsage, true, bits([byte], unused));
};

const randomSerial = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[0] &= 0x7f; // positive
  b[0] |= 0x01; // and not starting with a zero byte
  return b;
};

// ---- certificates ----

/**
 * A certificate signed by `issuer` (or by itself when there is none): the TBSCertificate, its signature, PEM.
 * @param {{ subject: any, spki: Uint8Array, issuerName: Uint8Array | null, issuerSpki: Uint8Array | null, signer: CryptoKey,
 *   ca: boolean, pathLen?: number | null, kind?: 'server' | 'client' | 'both' | null, san?: any, days: number }} o
 */
async function makeCert(o) {
  const now = new Date(Date.now() - 5 * 60_000); // a few minutes back: clocks differ
  const until = new Date(now.getTime() + o.days * 24 * 3600 * 1000);
  const subjectName = o.subject instanceof Uint8Array ? o.subject : name(o.subject);
  const ski = await keyId(o.spki);
  const aki = o.issuerSpki ? await keyId(o.issuerSpki) : ski;
  const rsa = spkiAlgorithm(o.spki).name !== 'ECDSA';
  const exts = [
    ext(OID.basicConstraints, true, o.ca ? seq(bool(true), ...(o.pathLen != null ? [int(o.pathLen)] : [])) : seq()),
    keyUsage(o.ca ? [0, 5, 6] : rsa ? [0, 2] : [0]),
    ...(o.ca ? [] : [ext(OID.extKeyUsage, false, seq(...(o.kind === 'client' ? [oid(OID.clientAuth)] : o.kind === 'both' ? [oid(OID.serverAuth), oid(OID.clientAuth)] : [oid(OID.serverAuth)])))]),
    ...(o.san ? [sanExtension(o.san)].filter(Boolean) : []),
    ext(OID.subjectKeyId, false, octets(ski)),
    ext(OID.authorityKeyId, false, seq(ctxPrim(0, aki))),
  ];
  const serial = randomSerial();
  const tbs = seq(
    ctx(0, int(2)),
    intBytes(serial),
    sigAlgId(o.signer.algorithm),
    o.issuerName || subjectName,
    seq(time(now), time(until)),
    subjectName,
    o.spki,
    ctx(3, seq(...exts)),
  );
  const der = seq(tbs, sigAlgId(o.signer.algorithm), bits(await sign(o.signer, tbs)));
  return { der, pem: pem('CERTIFICATE', der), serial: Array.from(serial, (b) => b.toString(16).padStart(2, '0')).join(''), notBefore: now.getTime(), notAfter: until.getTime() };
}

/** The parts of a certificate the CA needs again: its subject (DER) and public key. */
export function certParts(certPem) {
  const p = unpem(certPem, 'CERTIFICATE');
  if (!p) throw Object.assign(new Error('Not a certificate'), { code: 'ca.error.notCert' });
  const [tbs] = children(readTlv(p.der).value);
  const fields = children(tbs.value);
  const offset = fields[0].tag === 0xa0 ? 1 : 0;
  const subject = fields[offset + 4].raw;
  const spki = fields[offset + 5].raw;
  return { subject, spki, der: p.der };
}

/**
 * A new root CA: its key and its self-signed certificate.
 * @param {{ cn: string, o?: string, ou?: string, c?: string, keyType?: string, days?: number, pathLen?: number | null }} o
 */
export async function createCA({ keyType = 'ec-p384', days = 3650, pathLen = null, ...subject }) {
  const key = await newKey(keyType);
  const cert = await makeCert({ subject, spki: key.spki, issuerName: null, issuerSpki: null, signer: key.privateKey, ca: true, pathLen, days });
  return { keyPem: key.keyPem, certPem: cert.pem, serial: cert.serial, notAfter: cert.notAfter, keyType };
}

/**
 * A certificate from a CA: for a key made here (returned with it) or for a CSR's key.
 * @param {{ keyPem: string, certPem: string, chainPem?: string }} ca
 * @param {{ kind: 'server' | 'client' | 'both' | 'ca', cn: string, o?: string, ou?: string, c?: string, dns?: string[], ips?: string[], emails?: string[],
 *   days?: number, keyType?: string, csr?: string, pathLen?: number | null }} o
 */
export async function issue(ca, o) {
  const issuer = certParts(ca.certPem);
  const signer = await importSigningKey(ca.keyPem, issuer.spki);
  let spki;
  let subject;
  let keyPem = '';
  let san = { dns: o.dns || [], ips: o.ips || [], emails: o.emails || [] };
  if (o.csr) {
    const req = await readCsr(o.csr);
    spki = req.spki;
    subject = o.cn ? { cn: o.cn, o: o.o, ou: o.ou, c: o.c } : req.subject;
    if (!san.dns.length && !san.ips.length && !san.emails.length) san = req.san;
  } else {
    const key = await newKey(o.keyType || 'ec-p256');
    spki = key.spki;
    keyPem = key.keyPem;
    subject = { cn: o.cn, o: o.o, ou: o.ou, c: o.c };
  }
  const isCA = o.kind === 'ca';
  const cert = await makeCert({ subject, spki, issuerName: issuer.subject, issuerSpki: issuer.spki, signer, ca: isCA, pathLen: isCA ? (o.pathLen ?? 0) : null, kind: isCA ? null : o.kind, san: isCA ? null : san, days: o.days || 397 });
  return { certPem: cert.pem, keyPem, chainPem: cert.pem + (ca.chainPem || ca.certPem), serial: cert.serial, notAfter: cert.notAfter };
}

// ---- reading certificates ----

const NAME_OIDS = Object.fromEntries(NAME_PARTS.map((k) => [OID[k], k]));

/** A Name's parts this module writes (cn, o, ou, c, l, st), the rest left out. */
function readName(der) {
  const out = { cn: '', o: '', ou: '', c: '' };
  for (const rdn of children(readTlv(der).value)) {
    for (const atv of children(rdn.value)) {
      const [type, value] = children(atv.value);
      const k = NAME_OIDS[oidString(type.value)];
      if (k && k in out) out[k] = td.decode(value.value);
    }
  }
  return out;
}

/** A time of a certificate's validity, in ms. */
function readTime(e) {
  const s = td.decode(e.value);
  const full = e.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? '20' : '19'}${s}` : s;
  return Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14));
}

/** The kind of key in a SubjectPublicKeyInfo, as KEY_TYPES names it. */
function keyTypeOf(spki) {
  const alg = spkiAlgorithm(spki);
  if (alg.name === 'ECDSA') return alg.namedCurve === 'P-384' ? 'ec-p384' : 'ec-p256';
  const [, pub] = children(readTlv(spki).value);
  const [n] = children(readTlv(pub.value.subarray(1)).value);
  const bytes = n.value[0] === 0 ? n.value.length - 1 : n.value.length;
  return `rsa-${bytes * 8}`;
}

/**
 * What a certificate says: subject, names, validity, serial, key; when a key is given, that it is the certificate's
 * (`ca.error.keyMismatch` otherwise).
 * @param {string} certPem
 * @param {string} [keyPem]
 */
export async function describe(certPem, keyPem = '') {
  const { der } = certParts(certPem);
  const [tbs] = children(readTlv(der).value);
  const f = children(tbs.value);
  const o = f[0].tag === 0xa0 ? 1 : 0;
  const serial = Array.from(f[o].value, (b) => b.toString(16).padStart(2, '0')).join('').replace(/^00/, '');
  const issuerRaw = f[o + 2].raw;
  const [notBefore, notAfter] = children(f[o + 3].value).map(readTime);
  const subjectRaw = f[o + 4].raw;
  const spki = f[o + 5].raw;
  const sans = { dns: [], ips: [], emails: [] };
  const extsField = f.slice(o + 6).find((x) => x.tag === 0xa3);
  if (extsField) {
    for (const e of children(readTlv(extsField.value).value)) {
      const parts = children(e.value);
      if (oidString(parts[0].value) !== OID.subjectAltName) continue;
      for (const g of children(readTlv(parts.at(-1).value).value)) {
        if (g.tag === 0x82) sans.dns.push(td.decode(g.value));
        else if (g.tag === 0x81) sans.emails.push(td.decode(g.value));
        else if (g.tag === 0x87 && g.value.length === 4) sans.ips.push(Array.from(g.value).join('.'));
      }
    }
  }
  if (keyPem) {
    let ok = false;
    try {
      const signer = await importSigningKey(keyPem, spki);
      const probe = te.encode('kiwi-vault key check');
      const sig = new Uint8Array(await crypto.subtle.sign(signParams(signer.algorithm), signer, probe));
      const pub = await crypto.subtle.importKey('spki', spki, spkiAlgorithm(spki), false, ['verify']);
      ok = await crypto.subtle.verify(signParams(signer.algorithm), pub, sig, probe);
    } catch {
      ok = false;
    }
    if (!ok) throw Object.assign(new Error('The key is not this certificate’s'), { code: 'ca.error.keyMismatch' });
  }
  const same = issuerRaw.length === subjectRaw.length && issuerRaw.every((b, i) => b === subjectRaw[i]);
  return { subject: readName(subjectRaw), sans, notBefore, notAfter, serial, keyType: keyTypeOf(spki), selfSigned: same };
}

// ---- certificate signing requests ----

/**
 * What a PKCS #10 request asks for: its subject (DER, or the parts as an object), key and SANs; its signature checked.
 * @param {string} csrPem
 */
export async function readCsr(csrPem) {
  const p = unpem(csrPem);
  if (!p || !/CERTIFICATE REQUEST/.test(p.label)) throw Object.assign(new Error('Not a certificate signing request'), { code: 'ca.error.notCsr' });
  const [info, algId, sig] = children(readTlv(p.der).value);
  const [, subject, spki, attrs] = children(info.value);
  // the request is signed with its own key: proof that whoever asks holds it
  const alg = spkiAlgorithm(spki.raw);
  const pub = await crypto.subtle.importKey('spki', spki.raw, alg, false, ['verify']);
  let signature = sig.value.subarray(1);
  if (alg.name === 'ECDSA') {
    const [r, s] = children(readTlv(signature).value);
    const size = alg.namedCurve === 'P-384' ? 48 : 32;
    const fix = (v) => {
      const t = v.value[0] === 0 ? v.value.subarray(1) : v.value;
      const out = new Uint8Array(size);
      out.set(t, size - t.length);
      return out;
    };
    signature = cat([fix(r), fix(s)]);
  }
  const hash = oidString(children(algId.value)[0].value) === OID.ecdsaSha384 ? 'SHA-384' : 'SHA-256';
  const ok = await crypto.subtle.verify(alg.name === 'ECDSA' ? { name: 'ECDSA', hash } : { name: 'RSASSA-PKCS1-v1_5' }, pub, signature, info.raw);
  if (!ok) throw Object.assign(new Error('The request’s signature does not hold'), { code: 'ca.error.badCsr' });
  const san = { dns: [], ips: [], emails: [] };
  if (attrs && attrs.tag === 0xa0) {
    for (const attr of children(attrs.value)) {
      const [type, values] = children(attr.value);
      if (oidString(type.value) !== OID.extensionRequest) continue;
      const extensions = children(values.value)[0]; // SET { Extensions }
      for (const e of children(extensions.value)) {
        const parts = children(e.value);
        if (oidString(parts[0].value) !== OID.subjectAltName) continue;
        const generalNames = readTlv(parts.at(-1).value); // the OCTET STRING holds a SEQUENCE of names
        for (const g of children(generalNames.value)) {
          if (g.tag === 0x82) san.dns.push(td.decode(g.value));
          else if (g.tag === 0x81) san.emails.push(td.decode(g.value));
          else if (g.tag === 0x87 && g.value.length === 4) san.ips.push(Array.from(g.value).join('.'));
        }
      }
    }
  }
  return { subject: subject.raw, spki: spki.raw, san };
}
