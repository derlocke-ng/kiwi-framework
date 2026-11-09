// A vault: a list sealed with a key only a passphrase gives, kept in the
// account's settings so every device of the account has it, and opened only
// with that passphrase. The authenticator keeps its two-factor secrets in one
// (the owner's choice of November 2026: synced, with a passphrase of its own),
// so the account's own password alone does not give them.
//
//   key  = scrypt(NFKC(passphrase), salt, N = 2^16, r = 8, p = 1, 32 bytes)   (off the main thread, as the account's)
//   data = AES-256-GCM(key, iv, JSON({ v: 1, items }))
//
// The record { v, kdf: { name, N, r, p, salt }, iv, data } is all the settings
// hold; the passphrase and the key never leave the page.
//
//   const { record, key } = await createVault('a long passphrase', []);
//   const { items, key } = await openVault(record, 'a long passphrase');
//   const next = await sealVault(record, key, items);
import { scryptOffThread } from './account.js';
import { b64url, fromB64url } from './p2p.js';
import { fail } from './util.js';

const PARAMS = { N: 2 ** 16, r: 8, p: 1, dkLen: 32 };
export const MIN_PASSPHRASE = 8;
const te = new TextEncoder();
const td = new TextDecoder();

/**
 * The AES-GCM key a passphrase and salt give.
 * @param {string} passphrase
 * @param {{ salt: string, N: number, r: number, p: number }} kdf
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function vaultKey(passphrase, kdf, onProgress = null) {
  const raw = await scryptOffThread(te.encode(String(passphrase).normalize('NFKC')), fromB64url(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 }, onProgress);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** A record with these items, sealed with the key (a fresh IV each time). */
export async function sealVault(record, key, items) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ v: 1, items }))));
  return { v: 1, kdf: record.kdf, iv: b64url(iv), data: b64url(data) };
}

/**
 * A new vault for a passphrase.
 * @param {string} passphrase
 * @param {any[]} [items]
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function createVault(passphrase, items = [], onProgress = null) {
  if (String(passphrase).length < MIN_PASSPHRASE) throw fail('vault.error.short', `At least ${MIN_PASSPHRASE} characters.`, { n: MIN_PASSPHRASE });
  const kdf = { name: 'scrypt', N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, salt: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const key = await vaultKey(passphrase, kdf, onProgress);
  return { record: await sealVault({ kdf }, key, items), key };
}

/** Is this a vault record (and not something else under the same name)? */
export const isVault = (r) => Boolean(r && r.v === 1 && r.kdf?.name === 'scrypt' && typeof r.kdf.salt === 'string' && typeof r.iv === 'string' && typeof r.data === 'string');

/**
 * The items of a vault, and its key; throws `vault.error.wrong` when the passphrase is not the vault's.
 * @param {any} record
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function openVault(record, passphrase, onProgress = null) {
  if (!isVault(record)) throw fail('vault.error.broken', 'This vault cannot be read.');
  const key = await vaultKey(passphrase, record.kdf, onProgress);
  return { items: await readVault(record, key), key };
}

/** The items of a vault with a key already derived (another device changed it while this one was open). */
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
 * The same items under a new passphrase (a new salt, a new key).
 * @param {any[]} items
 * @param {string} passphrase
 * @param {((share: number) => void) | null} [onProgress]
 */
export async function rekeyVault(items, passphrase, onProgress = null) {
  return createVault(passphrase, items, onProgress);
}
