// Who you are: a nostr key. Every browser starts with its own key; a username
// and password make the same key available on every device:
//
//   scrypt(username, password) → lookup key (signs) + wrapping key (encrypts)
//   account event: kind 30790, signed by the lookup key, content = your key
//   encrypted with the wrapping key, published to your relays.
//
// Only someone who knows username AND password can compute the lookup key, so
// nobody can find, spam or overwrite your account event. Login is one request
// for one event. Names need not be unique: a different password is a
// different lookup key.

import { generateSecretKey, getPublicKey, nip19, nip49, scryptAsync, sha256, hexToBytes, bytesToHex } from './nostr.mjs';
import { KINDS, makeAddressable, seal, open, deriveKey, isHex64 } from './events.js';
import { store, timeout, fail } from './util.js';

export const ID_KEY = 'wjs.identity';
const ACCOUNT_D = 'account';
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, dkLen: 64 }; // ~1 s on a phone, 64 MB
const te = new TextEncoder();

/** @returns {{ sk: string, pk: string, alias: string|null, created: number }} */
export function loadIdentity() {
  const saved = store.get(ID_KEY);
  if (saved?.sk && saved.pk) return saved;
  const sk = bytesToHex(generateSecretKey());
  const id = { sk, pk: getPublicKey(hexToBytes(sk)), alias: null, created: Date.now() };
  saveIdentity(id);
  return id;
}

export function saveIdentity(id) {
  if (!store.set(ID_KEY, id)) throw fail('account.error.storage', 'Could not save your key in this browser (storage full or blocked).');
}

export const forgetIdentity = () => store.remove(ID_KEY);

const PREV_KEY = 'wjs.identity.prev';

/**
 * Switch this device to another identity (sign-in, account creation, key
 * import). The key it had before is kept aside so every app can carry its
 * data over to the new key on its next start; see previousIdentities().
 */
export function adoptIdentity(next) {
  const current = store.get(ID_KEY);
  if (current?.sk && current.pk !== next.pk) {
    const prev = previousIdentities().filter((p) => p.pk !== current.pk && p.pk !== next.pk);
    prev.push({ sk: current.sk, pk: current.pk, since: Date.now() });
    store.set(PREV_KEY, prev.slice(-5));
  }
  saveIdentity(next);
}

/** Keys this device used before the current one, oldest first. */
export const previousIdentities = () => store.get(PREV_KEY, []).filter((p) => isHex64(p?.sk) && isHex64(p?.pk));

/** An app marks a previous key as carried over; keys older than a day are dropped. */
export function markCarried(appName, pk) {
  const key = `wjs.carried.${pk.slice(0, 16)}`;
  const apps = store.get(key, []);
  if (!apps.includes(appName)) store.set(key, [...apps, appName]);
  const all = previousIdentities();
  const stale = all.filter((p) => Date.now() - (p.since || 0) > 86_400_000);
  if (stale.length) {
    store.set(PREV_KEY, all.filter((p) => !stale.includes(p)));
    for (const p of stale) store.remove(`wjs.carried.${p.pk.slice(0, 16)}`);
  }
}

export const wasCarried = (appName, pk) => store.get(`wjs.carried.${pk.slice(0, 16)}`, []).includes(appName);

export function normalizeUsername(name) {
  const n = String(name || '').trim().normalize('NFKC').toLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{2,39}$/u.test(n)) throw fail('account.error.username', 'Usernames are 3–40 characters: letters, digits, dot, dash or underscore.');
  return n;
}

export function checkPassword(pass) {
  if (String(pass || '').length < 10) throw fail('account.error.password', 'Use a password of at least 10 characters — it protects your key on public relays.');
}

/** The lookup key pair and wrapping key for a username + password. Slow on purpose. */
/** scrypt in a worker where there is one (the page stays responsive), on this thread otherwise (tests). */
function scryptOffThread(password, salt, params, onProgress) {
  const opts = onProgress ? { ...params, onProgress } : params; // scrypt refuses a null callback
  if (typeof Worker !== 'function') return scryptAsync(password, salt, opts);
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./account-worker.js', import.meta.url), { type: 'module' });
    } catch {
      return scryptAsync(password, salt, opts).then(resolve, reject);
    }
    w.onmessage = (e) => {
      if (e.data.progress != null) return onProgress?.(e.data.progress);
      w.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(new Uint8Array(e.data.dk));
    };
    w.onerror = () => {
      w.terminate();
      scryptAsync(password, salt, opts).then(resolve, reject);
    };
    w.postMessage({ password, salt, params });
  });
}

/** @param onProgress gets the derivation's progress as a fraction 0…1 */
export async function deriveLookup(username, password, onProgress = null) {
  const name = normalizeUsername(username);
  const salt = sha256(te.encode(`wjs/account/v1|${name}`));
  const dk = await scryptOffThread(te.encode(String(password).normalize('NFKC')), salt, SCRYPT, onProgress);
  const lookupSk = bytesToHex(dk.slice(0, 32));
  return { name, lookupSk, lookupPk: getPublicKey(dk.slice(0, 32)), wrapKey: dk.slice(32, 64) };
}

export async function buildAccountEvent({ name, lookupSk, wrapKey }, skHex) {
  const content = await seal(wrapKey, { v: 1, sk: skHex, alias: name });
  return makeAddressable(KINDS.ACCOUNT, ACCOUNT_D, content, lookupSk, [['v', '1']]);
}

/** @returns {Promise<{sk: string, alias: string}|null>} null when the event is not ours. */
export async function openAccountEvent(event, wrapKey) {
  try {
    const data = await open(wrapKey, event.content);
    return data?.sk ? { sk: data.sk, alias: data.alias } : null;
  } catch {
    return null;
  }
}

export const accountFilter = (lookupPk) => ({ kinds: [KINDS.ACCOUNT], authors: [lookupPk], '#d': [ACCOUNT_D] });

/**
 * Publish an account event for this key. Refuses when the same username and
 * password already belong to a different key.
 */
/**
 * Publish an account for a key. Needs a relay: the event must land somewhere
 * other devices can find it, so this waits for the first relay to accept it
 * (the outbox delivers it to the others).
 * @param {{ pool: import('./relays.js').RelayPool, sync: import('./sync.js').Sync }} net
 * @param {string} username
 * @param {string} password
 * @param {string} skHex
 * @param {(msg: string, params?: Record<string, unknown>) => void} [onProgress]
 * @returns {Promise<{ event: { pubkey: string, [k: string]: any }, alias: string }>}
 */
export async function createAccount({ pool, sync }, username, password, skHex, onProgress = () => {}) {
  checkPassword(password);
  onProgress('account.progress.derive');
  const lookup = await deriveLookup(username, password, (p) => onProgress('account.progress.derivePct', { p: Math.floor(p * 100) }));
  if (!pool.online) throw fail('account.error.offlineCreate', 'No relay connected — accounts live on relays, so you need to be online to create one.');
  onProgress('account.progress.check');
  const existing = await pool.fetch([accountFilter(lookup.lookupPk)], { ms: 5000, until: (events) => events.length > 0 });
  for (const ev of existing) {
    const data = await openAccountEvent(ev, lookup.wrapKey);
    if (data && data.sk !== skHex) throw fail('account.error.exists', 'An account with this username and password already exists. Sign in instead, or pick a different password.');
  }
  const event = await buildAccountEvent(lookup, skHex);
  onProgress('account.progress.publish');
  try {
    await sync.publish(event, { wait: 'one' });
  } catch (err) {
    const reason = String(err?.message || err);
    throw fail('account.error.rejected', `No relay accepted the account (${reason}).`, { reason });
  }
  return { event, alias: lookup.name };
}

/**
 * @param {import('./relays.js').RelayPool} pool
 * @param {string} username
 * @param {string} password
 * @param {(msg: string, params?: Record<string, unknown>) => void} [onProgress]
 * @returns {Promise<{sk: string, pk: string, alias: string, event: { pubkey: string, [k: string]: any }}>}
 */
export async function login(pool, username, password, onProgress = () => {}) {
  onProgress('account.progress.derive');
  const lookup = await deriveLookup(username, password, (p) => onProgress('account.progress.derivePct', { p: Math.floor(p * 100) }));
  if (!pool.online) throw fail('account.error.offline', 'No relay connected — are you online?');
  onProgress('account.progress.ask');
  const events = await timeout(pool.fetch([accountFilter(lookup.lookupPk)], { ms: 8000, until: (found) => found.length > 0 }), 12_000, 'No relay answered.');
  for (const ev of events.sort((a, b) => b.created_at - a.created_at)) {
    const data = await openAccountEvent(ev, lookup.wrapKey);
    if (data) return { sk: data.sk, pk: getPublicKey(hexToBytes(data.sk)), alias: data.alias || lookup.name, event: ev };
  }
  throw fail('account.error.wrongLogin', 'Wrong username or password — or none of your relays knows this account.');
}

// ---- keys in other forms ----

export const pubkeyOf = (skHex) => getPublicKey(hexToBytes(skHex));
export const npub = (pk) => nip19.npubEncode(pk);
export const nsec = (skHex) => nip19.nsecEncode(hexToBytes(skHex));

/** Accept an nsec, an ncryptsec (with password) or a hex key; returns the hex secret key. */
export function importKey(text, password = '') {
  const s = String(text || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (s.startsWith('ncryptsec1')) {
    if (!password) throw fail('key.error.needsPassword', 'This key is password-protected.');
    try {
      return bytesToHex(nip49.decrypt(s, password));
    } catch {
      throw fail('key.error.wrongPassword', 'Wrong password for this key.');
    }
  }
  if (s.startsWith('nsec1')) {
    const { type, data } = nip19.decode(s);
    if (type !== 'nsec') throw fail('key.error.notSecret', 'Not a secret key.');
    return bytesToHex(data);
  }
  throw fail('key.error.format', 'Paste an nsec1…, ncryptsec1… or 64-character hex key.');
}

export const exportEncrypted = (skHex, password) => nip49.encrypt(hexToBytes(skHex), password, 16);

/** Key for encrypting things to yourself (wallet entries, settings). */
export const selfKey = (skHex) => deriveKey(skHex, 'wjs/self');

/** A public key as hex, from an npub or 64 hex characters. */
export function decodeKey(text) {
  const t = String(text || '').trim();
  if (isHex64(t)) return t.toLowerCase();
  if (t.startsWith('npub1')) {
    const { type, data } = nip19.decode(t);
    if (type === 'npub') return data;
  }
  throw fail('key.error.format', 'Paste an npub1… or 64-character hex key.');
}
