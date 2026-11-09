// One-time codes for two-factor sign-ins (the authenticator app): TOTP as RFC
// 6238 has it (HOTP, RFC 4226, on the count of periods since 1970), with SHA-1,
// SHA-256 or SHA-512 through WebCrypto, 6 to 8 digits, any period. A secret is
// base32 (RFC 4648), as services show it; an otpauth:// URI (what their QR
// codes hold) carries it with its issuer, account and parameters.
//
//   const entry = parseOtpauth('otpauth://totp/Shop:ada@example.org?secret=JBSWY3DPEHPK3PXP&issuer=Shop');
//   const { code, left } = await totp(entry, Date.now());

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

/** A base32 secret as bytes (spaces, dashes, padding and case ignored); null when it is not base32. */
export function base32Decode(text) {
  const clean = String(text || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

/** Bytes as base32, no padding. */
export function base32Encode(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * An entry as the vault keeps it, cleaned: null when its secret is not usable.
 * @param {any} e
 * @returns {{ id: string, issuer: string, account: string, secret: string, algorithm: string, digits: number, period: number } | null}
 */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const bytes = base32Decode(e.secret);
  if (!bytes || bytes.length < 10) return null; // RFC 4226 asks for 128 bits; services give 80 at least
  const algorithm = ALGORITHMS.includes(String(e.algorithm || 'SHA1').toUpperCase()) ? String(e.algorithm || 'SHA1').toUpperCase() : null;
  const digits = Number(e.digits ?? 6);
  const period = Number(e.period ?? 30);
  if (!algorithm || !Number.isInteger(digits) || digits < 6 || digits > 8 || !Number.isInteger(period) || period < 10 || period > 300) return null;
  const text = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
  return {
    id: /^[\w-]{6,40}$/.test(String(e.id || '')) ? String(e.id) : newId(),
    issuer: text(e.issuer, 80),
    account: text(e.account, 120),
    secret: base32Encode(bytes),
    algorithm,
    digits,
    period,
  };
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * What an otpauth:// URI describes (a service's QR code), or null. HOTP (counters) is not taken: a code generator
 * cannot know where the service's counter stands.
 * @param {string} uri
 */
export function parseOtpauth(uri) {
  let url;
  try {
    url = new URL(String(uri || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'otpauth:' || url.host.toLowerCase() !== 'totp') return null;
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [labelIssuer, ...rest] = label.includes(':') ? label.split(':') : ['', label];
  const p = url.searchParams;
  return cleanEntry({
    issuer: p.get('issuer') || labelIssuer,
    account: rest.join(':').trim() || (label.includes(':') ? '' : label),
    secret: p.get('secret'),
    algorithm: p.get('algorithm') || 'SHA1',
    digits: p.get('digits') || 6,
    period: p.get('period') || 30,
  });
}

/** The otpauth:// URI of an entry (for another authenticator, or a QR code). */
export function otpauthOf(e) {
  const label = encodeURIComponent(e.issuer ? `${e.issuer}:${e.account}` : e.account || 'account');
  const q = new URLSearchParams({ secret: e.secret, ...(e.issuer ? { issuer: e.issuer } : {}), algorithm: e.algorithm, digits: String(e.digits), period: String(e.period) });
  return `otpauth://totp/${label}?${q}`;
}

const keys = new Map(); // secret|algorithm -> CryptoKey: the HMAC key is made once per entry

/**
 * HOTP for a counter (RFC 4226): HMAC of the counter as 8 bytes, dynamic truncation, so many digits.
 * @param {{ secret: string, algorithm?: string, digits?: number }} e
 * @param {number} counter
 */
export async function hotp(e, counter) {
  const algorithm = e.algorithm || 'SHA1';
  const id = `${e.secret}|${algorithm}`;
  let key = keys.get(id);
  if (!key) {
    key = await crypto.subtle.importKey('raw', base32Decode(e.secret), { name: 'HMAC', hash: HASH[algorithm] }, false, ['sign']);
    keys.set(id, key);
  }
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = mac[mac.length - 1] & 15;
  const bin = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  const digits = e.digits || 6;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * The code at a moment (RFC 6238), the seconds it has left, and the next one.
 * @param {{ secret: string, algorithm?: string, digits?: number, period?: number }} e
 * @param {number} [ms]
 */
export async function totp(e, ms = Date.now()) {
  const period = e.period || 30;
  const step = Math.floor(ms / 1000 / period);
  const [code, next] = await Promise.all([hotp(e, step), hotp(e, step + 1)]);
  return { code, next, left: period - (Math.floor(ms / 1000) % period), period };
}

/** A code as people read it: 123 456, 1234 5678. */
export const spaced = (code) => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code.length === 7 ? `${code.slice(0, 4)} ${code.slice(4)}` : `${code.slice(0, 3)} ${code.slice(3)}`);

/**
 * The entries of a Google Authenticator export (otpauth-migration://offline?data=…, its "Transfer accounts" QR
 * codes): a protocol buffer of accounts, each with its secret, name, issuer, algorithm, digits and type. Counters
 * (HOTP) and what does not make a usable entry are left out. [] when the URI is not one.
 * @param {string} uri
 */
export function parseMigration(uri) {
  let data;
  try {
    const url = new URL(String(uri || '').trim());
    if (url.protocol !== 'otpauth-migration:') return [];
    data = Uint8Array.from(atob(String(url.searchParams.get('data') || '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return [];
  }
  const out = [];
  for (const [field, value] of fields(data)) {
    if (field !== 1 || !(value instanceof Uint8Array)) continue; // otp_parameters
    const p = { algorithm: 1, digits: 1, type: 2 };
    for (const [f, v] of fields(value)) {
      if (f === 1 && v instanceof Uint8Array) p.secret = v;
      else if (f === 2 && v instanceof Uint8Array) p.name = new TextDecoder().decode(v);
      else if (f === 3 && v instanceof Uint8Array) p.issuer = new TextDecoder().decode(v);
      else if (f === 4) p.algorithm = v;
      else if (f === 5) p.digits = v;
      else if (f === 6) p.type = v;
    }
    if (p.type !== 2 || !p.secret) continue; // TOTP only
    const name = p.name || '';
    const [labelIssuer, ...rest] = name.includes(':') ? name.split(':') : ['', name];
    const entry = cleanEntry({
      issuer: p.issuer || labelIssuer,
      account: rest.join(':').trim(),
      secret: base32Encode(p.secret),
      algorithm: { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }[p.algorithm] || 'MD5',
      digits: p.digits === 2 ? 8 : 6,
      period: 30,
    });
    if (entry) out.push(entry);
  }
  return out;
}

/** A protocol buffer's fields: [number, value] with a varint as a number and a length-delimited field as bytes. */
function* fields(buf) {
  let i = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated');
      const b = buf[i++];
      v += (b & 127) * 2 ** shift;
      shift += 7;
      if (!(b & 128)) return v;
    }
  };
  try {
    while (i < buf.length) {
      const tag = varint();
      const field = Math.floor(tag / 8);
      const wire = tag & 7;
      if (wire === 0) yield [field, varint()];
      else if (wire === 2) {
        const len = varint();
        yield [field, buf.subarray(i, i + len)];
        i += len;
      } else if (wire === 5) i += 4;
      else if (wire === 1) i += 8;
      else return;
    }
  } catch {
    /* a truncated buffer: what was read stands */
  }
}
