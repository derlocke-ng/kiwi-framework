// The vault: secrets that need more than the account's password (passwords,
// two-factor secrets, and from 0.28 keys and certificates), kept on every
// device of the account and opened only with a passphrase of their own (the
// owner's choice of November 2026: synced, with its own passphrase, one vault
// for the password manager and the authenticator).
//
// Two layers, so a new passphrase never re-encrypts the entries:
//
//   passKey  = scrypt(NFKC(passphrase), salt, N = 2^16, r = 8, p = 1, 32 bytes)   (off the main thread, as the account's)
//   vaultKey = 32 random bytes, kept wrapped: AES-256-GCM(passKey, iv, vaultKey)
//   entry    = AES-256-GCM(vaultKey, iv, JSON (gzipped when long), AAD = "wjs-vault|<d>|<version>")
//
// The keys record { v: 2, kdf: { name, N, r, p, salt }, iv, key } sits in the
// account's settings (namespace `vault`, key `keys`); each entry is an
// addressable event of its own (kind 30792, d a random id), so entries change
// one at a time, two devices editing two entries never overwrite each other,
// and a vault of hundreds of entries stays far under a relay's limit for one
// event. The AAD binds an entry's ciphertext to its address: a relay cannot
// pass one entry off as another. The passphrase, the passphrase key and the
// vault key (non-extractable) stay in the page's memory and nowhere else.
//
// 0.26's authenticator kept its codes in a first form (v1, below): the codes
// themselves sealed directly with the passphrase key, in one settings value.
// It is still read, to move those codes into this vault and to import old
// backups.
import { scryptOffThread } from './account.js';
import { b64url, fromB64url } from './p2p.js';
import { fail } from './util.js';

const PARAMS = { N: 2 ** 16, r: 8, p: 1, dkLen: 32 };
export const MIN_PASSPHRASE = 8;
const te = new TextEncoder();
const td = new TextDecoder();

/** A new set of scrypt parameters with a fresh salt. */
const newKdf = () => ({ name: 'scrypt', N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, salt: b64url(crypto.getRandomValues(new Uint8Array(16))) });

const isKdf = (k) => Boolean(k && k.name === 'scrypt' && typeof k.salt === 'string' && k.N >= 2 ** 14 && k.N <= 2 ** 20 && k.r >= 1 && k.r <= 32 && k.p >= 1 && k.p <= 16);

/**
 * The AES-GCM key a passphrase and salt give.
 * @param {string} passphrase
 * @param {{ salt: string, N: number, r: number, p: number }} kdf
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function vaultKey(passphrase, kdf, onProgress = null) {
  const raw = await scryptOffThread(te.encode(String(passphrase).normalize('NFKC')), fromB64url(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 }, onProgress);
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

const checkLength = (passphrase) => {
  if (String(passphrase).length < MIN_PASSPHRASE) throw fail('vault.error.short', `At least ${MIN_PASSPHRASE} characters.`, { n: MIN_PASSPHRASE });
};

// ---- the keys record (v2) ----

/** Is this a keys record (and not something else under the same name)? */
export const isKeys = (r) => Boolean(r && r.v === 2 && isKdf(r.kdf) && typeof r.iv === 'string' && typeof r.key === 'string');

/** The vault key, imported for sealing entries only. */
const importVaultKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** The keys record for a vault key under a passphrase key; `id` names the vault (a new passphrase keeps it, a vault made anew has another). */
async function wrap(kdf, passKey, raw, id) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('wjs-vault-key') }, passKey, raw));
  return { v: 2, id, kdf, iv: b64url(iv), key: b64url(key) };
}

/** The raw vault key of a record; throws `vault.error.wrong` when the passphrase key is not the record's. */
async function unwrap(record, passKey) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(record.iv), additionalData: te.encode('wjs-vault-key') }, passKey, fromB64url(record.key)));
  } catch {
    throw fail('vault.error.wrong', 'That is not the passphrase.');
  }
}

/**
 * A new vault: a random vault key wrapped under a passphrase. `reuse` takes a passphrase key already
 * worked out for the same passphrase (moving 0.26's codes over, which costs no second scrypt).
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 * @param {{ kdf: any, passKey: CryptoKey } | null} [reuse]
 * @returns {Promise<{ record: any, key: CryptoKey }>}
 */
export async function createKeys(passphrase, onProgress = null, reuse = null) {
  checkLength(passphrase);
  const kdf = reuse?.kdf || newKdf();
  const passKey = reuse?.passKey || (await vaultKey(passphrase, kdf, onProgress));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    return { record: await wrap(kdf, passKey, raw, b64url(crypto.getRandomValues(new Uint8Array(12)))), key: await importVaultKey(raw) };
  } finally {
    raw.fill(0);
  }
}

/**
 * The vault key of a record; throws `vault.error.wrong` for another passphrase.
 * @param {any} record
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 * @returns {Promise<CryptoKey>}
 */
export async function openKeys(record, passphrase, onProgress = null) {
  if (!isKeys(record)) throw fail('vault.error.broken', 'This vault cannot be read.');
  const raw = await unwrap(record, await vaultKey(passphrase, record.kdf, onProgress));
  try {
    return await importVaultKey(raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * The same vault key under a new passphrase (a new salt): asks for the current one, as the key in
 * memory cannot be taken out again. The entries stay as they are; open pages stay open.
 * @param {any} record
 * @param {string} current
 * @param {string} next
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function changePassphrase(record, current, next, onProgress = null) {
  checkLength(next);
  const half = onProgress ? (s) => onProgress(s / 2) : null;
  const raw = await unwrap(record, await vaultKey(current, record.kdf, half));
  try {
    const kdf = newKdf();
    return await wrap(kdf, await vaultKey(next, kdf, onProgress ? (s) => onProgress(0.5 + s / 2) : null), raw, record.id);
  } finally {
    raw.fill(0);
  }
}

// ---- entries ----

async function pipe(bytesIn, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytesIn);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const aad = (d, version) => te.encode(`wjs-vault|${d}|${version}`);

/**
 * An entry's content: version(1) || iv(12) || AES-GCM(vaultKey, JSON), base64url; version 2 is gzipped JSON.
 * @param {CryptoKey} key
 * @param {string} d  the entry's address (its event's d tag)
 * @param {any} value
 */
export async function sealItem(key, d, value) {
  let plain = te.encode(JSON.stringify(value));
  let version = 1;
  if (plain.length > 1024 && typeof CompressionStream !== 'undefined') {
    const zipped = await pipe(plain, new CompressionStream('gzip'));
    if (zipped.length < plain.length) {
      plain = zipped;
      version = 2;
    }
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(d, version) }, key, plain));
  const out = new Uint8Array(13 + ct.length);
  out[0] = version;
  out.set(iv, 1);
  out.set(ct, 13);
  return b64url(out);
}

/** An entry's value; throws when the key is not the vault's or the content was moved from another address. */
export async function openItem(key, d, content) {
  const u8 = fromB64url(content);
  const version = u8[0];
  if (version !== 1 && version !== 2) throw new Error('Unknown entry version');
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(1, 13), additionalData: aad(d, version) }, key, u8.subarray(13)));
  if (version === 2) plain = await pipe(plain, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(plain));
}

// ---- backups ----

export const BACKUP_TYPE = 'kiwi-vault-backup';

/**
 * A backup file's object: the keys record and every entry as it is on the relays, still sealed.
 * @param {any} record
 * @param {{ d: string, content: string }[]} entries
 */
export const backupOf = (record, entries) => ({ type: BACKUP_TYPE, v: 2, keys: record, entries });

/**
 * The entries' values in a backup file (this vault's, or 0.26's authenticator's), opened with that backup's passphrase.
 * @param {any} file  the parsed JSON
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 * @returns {Promise<{ kind: 'vault' | 'authenticator', items: any[] }>}
 */
export async function readBackup(file, passphrase, onProgress = null) {
  if (file?.type === BACKUP_TYPE && isKeys(file.keys) && Array.isArray(file.entries)) {
    const key = await openKeys(file.keys, passphrase, onProgress);
    const items = [];
    for (const e of file.entries) {
      if (typeof e?.d !== 'string' || typeof e?.content !== 'string' || !e.content) continue;
      try {
        const value = await openItem(key, e.d, e.content);
        if (value && !value.deleted) items.push(value);
      } catch {
        /* an entry sealed with another key (a vault made anew): not this backup's */
      }
    }
    return { kind: 'vault', items };
  }
  if (file?.type === 'kiwi-authenticator-backup' && isVault(file.vault)) {
    return { kind: 'authenticator', items: (await openVault(file.vault, passphrase, onProgress)).items };
  }
  throw fail('vault.error.notBackup', 'This is not a backup of a vault.');
}

// ---- the first form (0.26's authenticator) ----

/** A v1 record with these items, sealed with the passphrase key (a fresh IV each time). */
export async function sealVault(record, key, items) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ v: 1, items }))));
  return { v: 1, kdf: record.kdf, iv: b64url(iv), data: b64url(data) };
}

/**
 * A v1 vault for a passphrase (0.26's form; kept for tests and old backups).
 * @param {string} passphrase
 * @param {any[]} [items]
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function createVault(passphrase, items = [], onProgress = null) {
  checkLength(passphrase);
  const kdf = newKdf();
  const key = await vaultKey(passphrase, kdf, onProgress);
  return { record: await sealVault({ kdf }, key, items), key };
}

/** Is this a v1 record? */
export const isVault = (r) => Boolean(r && r.v === 1 && isKdf(r.kdf) && typeof r.iv === 'string' && typeof r.data === 'string');

/**
 * The items of a v1 vault, and its passphrase key; throws `vault.error.wrong` for another passphrase.
 * @param {any} record
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function openVault(record, passphrase, onProgress = null) {
  if (!isVault(record)) throw fail('vault.error.broken', 'This vault cannot be read.');
  const key = await vaultKey(passphrase, record.kdf, onProgress);
  return { items: await readVault(record, key), key };
}

/** The items of a v1 vault with its passphrase key. */
export async function readVault(record, key) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(record.iv) }, key, fromB64url(record.data));
  } catch {
    throw fail('vault.error.wrong', 'That is not the passphrase.');
  }
  const body = JSON.parse(td.decode(plain));
  return Array.isArray(body?.items) ? body.items : [];
}

/**
 * The same v1 items under a new passphrase.
 * @param {any[]} items
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function rekeyVault(items, passphrase, onProgress = null) {
  return createVault(passphrase, items, onProgress);
}
