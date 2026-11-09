// Who you are: a nostr key. Every browser starts with its own key; a username
// and password make the same key available on every device:
//
//   scrypt(username, password) → lookup key pair + wrapping key
//   account event: kind 30790, signed by YOUR key, d = the lookup pubkey,
//   content = your key encrypted with the wrapping key, on your relays.
//
// Only someone who knows username AND password can compute the lookup key, so
// nobody can find, spam or overwrite your account event. Login is one request
// for one event. Names need not be unique: a different password is a
// different lookup key. Because your key authors the event, your key can also
// retire it: a password change publishes the entry for the new password and
// an empty one at the old address (newest wins), with a deletion for good
// measure, so the old password stops opening the account on every relay that
// follows. The first form (v1) had the lookup key as author; it is still read,
// and a sign-in with it republishes the entry in this form and retires the old.
//
// A hub whose relay lets only its members write (kiwi-modules' members relay)
// takes a new account entry from anyone as the sign-up when it carries NIP-13
// proof of work: `policy.registerPow` bits, set where the hub runs. The work is
// done in the shared miners (pow.js) before the entry is signed.

import { generateSecretKey, getPublicKey, nip19, nip49, scryptAsync, sha256, hexToBytes, bytesToHex } from './nostr.mjs';
import { KINDS, dTag, makeAddressable, now, open, seal, sign, stamp, deriveKey, isHex64 } from './events.js';
import { minePow } from './pow.js';
import { store, timeout, fail } from './util.js';

export const ID_KEY = 'wjs.identity';
const LEGACY_D = 'account'; // the first form's d tag: authored by the lookup key
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
 * import). A device key it had before is kept aside so every app can carry
 * its data over to the new key on its next start; see previousIdentities().
 * An account it was signed in as is never kept: an account's data is its
 * own and must not follow a sign-in to another account on the same device.
 */
export function adoptIdentity(next) {
  const current = store.get(ID_KEY);
  const deviceKey = current?.sk && !current.alias && !current.accountPk;
  if (deviceKey && current.pk !== next.pk) {
    const prev = previousIdentities().filter((p) => p.pk !== current.pk && p.pk !== next.pk);
    prev.push({ sk: current.sk, pk: current.pk, since: Date.now() });
    store.set(PREV_KEY, prev.slice(-5));
  }
  saveIdentity(next);
}

/** Device keys this device used before the current one, oldest first; never an account. */
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

/**
 * The account entry for a username and password: authored by the key it holds, at the address only the password finds.
 * `pow` bits of proof of work go on it when the hub's relay asks for them of a sign-up (onProgress gets seconds).
 * @param {{ name: string, lookupPk: string, wrapKey: Uint8Array }} lookup
 * @param {string} skHex
 * @param {{ pow?: number, onProgress?: ((seconds: number) => void) | null }} [options]
 */
export async function buildAccountEvent({ name, lookupPk, wrapKey }, skHex, { pow = 0, onProgress = null } = {}) {
  const content = await seal(wrapKey, { v: 2, sk: skHex, alias: name });
  if (!(pow > 0)) return makeAddressable(KINDS.ACCOUNT, lookupPk, content, skHex, [['v', '2']]);
  const pubkey = getPublicKey(hexToBytes(skHex));
  const template = { kind: KINDS.ACCOUNT, pubkey, created_at: stamp(`${KINDS.ACCOUNT}:${pubkey}:${lookupPk}`), tags: [['d', lookupPk], ['v', '2']], content };
  return sign(await minePow(template, pow, { onProgress: ({ ms }) => onProgress?.(Math.round(ms / 1000)) }), skHex);
}

/** The proof of work a hub asks of a new account entry, in bits (0: none). */
export const powBits = (bits) => (Number.isInteger(bits) && bits > 0 ? Math.min(bits, 32) : 0);

/** The first form, authored by the lookup key (kept for the tests of the upgrade). */
export async function buildLegacyAccountEvent({ name, lookupSk, wrapKey }, skHex) {
  const content = await seal(wrapKey, { v: 1, sk: skHex, alias: name });
  return makeAddressable(KINDS.ACCOUNT, LEGACY_D, content, lookupSk, [['v', '1']]);
}

/** 1: the first form (d = 'account', the lookup key as author); 2: today's (d = the lookup pubkey, the user's key as author). */
export const accountVersion = (event) => (dTag(event) === LEGACY_D ? 1 : 2);

/** Where an account for this lookup key may live: today's address, and the first form's. */
export const accountFilters = (lookupPk) => [
  { kinds: [KINDS.ACCOUNT], '#d': [lookupPk] },
  { kinds: [KINDS.ACCOUNT], authors: [lookupPk], '#d': [LEGACY_D] },
];

/**
 * @returns {Promise<{sk: string, alias: string, version: 1|2}|null>} null when the event is not ours, is
 * retired (empty), or, in today's form, was not published by the key it holds.
 */
export async function openAccountEvent(event, wrapKey) {
  if (!event?.content) return null;
  try {
    const data = await open(wrapKey, event.content);
    if (!data?.sk || !isHex64(data.sk)) return null;
    const version = accountVersion(event);
    if (version === 2 && event.pubkey !== getPublicKey(hexToBytes(data.sk))) return null;
    return { sk: data.sk, alias: data.alias, version };
  } catch {
    return null;
  }
}

/** The account a lookup key opens, from the relays: the newest entry that opens, in either form. */
async function findAccount(pool, lookup, { ms = 8000 } = {}) {
  const events = await pool.fetch(accountFilters(lookup.lookupPk), { ms, until: (found) => found.some((e) => e.content) });
  for (const ev of events.sort((a, b) => b.created_at - a.created_at)) {
    const data = await openAccountEvent(ev, lookup.wrapKey);
    if (data) return { ...data, pk: getPublicKey(hexToBytes(data.sk)), event: ev };
  }
  return null;
}

/**
 * The entry at a lookup key's address stops opening the account: an empty entry replaces it (newest wins on
 * every relay) and a deletion follows. Today's form the user's key retires by itself; the first form only its
 * lookup key can, so that needs the password it was made with.
 * @param {{ publish: Function }} sync
 * @param {{ lookupPk: string, skHex: string, lookupSk?: string|null, today?: boolean }} entry
 *   today: retire today's form at this address (false when the address is being kept, as in an upgrade)
 */
export async function retireAccount(sync, { lookupPk, skHex, lookupSk = null, today = true }) {
  const pk = getPublicKey(hexToBytes(skHex));
  if (today) {
    await sync.publish(makeAddressable(KINDS.ACCOUNT, lookupPk, '', skHex, [['v', '2'], ['retired', '1']]), { wait: 'one' });
    await sync.publish(sign({ kind: KINDS.DELETE, created_at: now(), tags: [['a', `${KINDS.ACCOUNT}:${pk}:${lookupPk}`]], content: 'retired' }, skHex));
  }
  if (lookupSk) {
    await sync.publish(makeAddressable(KINDS.ACCOUNT, LEGACY_D, '', lookupSk, [['v', '1'], ['retired', '1']]), { wait: 'one' });
    await sync.publish(sign({ kind: KINDS.DELETE, created_at: now(), tags: [['a', `${KINDS.ACCOUNT}:${lookupPk}:${LEGACY_D}`]], content: 'retired' }, lookupSk));
  }
}

/** An account in the first form, right after a sign-in with its password: the same entry in today's form, the first form retired. */
export async function upgradeAccount({ sync }, lookup, skHex) {
  const event = await buildAccountEvent(lookup, skHex);
  await sync.publish(event, { wait: 'one' });
  await retireAccount(sync, { lookupPk: lookup.lookupPk, skHex, lookupSk: lookup.lookupSk, today: false });
  return event;
}

/**
 * A new password for the same key and name: the entry for the new password goes up, the old one is retired.
 * `old` is the current entry ({ lookupPk, version }); an entry in the first form (or of unknown form) needs
 * `oldPassword` too, since only its lookup key can retire it.
 * @param {{ pool: any, sync: any }} net
 * @param {{ skHex: string, username: string, newPassword: string, oldPassword?: string|null, old?: { lookupPk: string, version: number }|null, pow?: number, onProgress?: (msg: string, params?: Record<string, unknown>) => void }} options
 * @returns {Promise<{ event: object, lookupPk: string, alias: string }>}
 */
export async function changePassword({ pool, sync }, { skHex, username, newPassword, oldPassword = null, old = null, pow = 0, onProgress = () => {} }) {
  checkPassword(newPassword);
  onProgress('account.progress.derive');
  const next = await deriveLookup(username, newPassword, (p) => onProgress('account.progress.derivePct', { p: Math.floor(p * 100) }));
  if (old && next.lookupPk === old.lookupPk) throw fail('account.error.samePassword', 'That is the password you have.');
  if (!pool.online) throw fail('account.error.offline', 'No relay connected — are you online?');
  let oldLookupSk = null;
  if (old && old.version !== 2) {
    if (!oldPassword) throw fail('account.error.needOld', 'Enter your current password too: this account still has its first form, and only its password can retire it.');
    const prev = await deriveLookup(username, oldPassword);
    if (prev.lookupPk !== old.lookupPk) throw fail('account.error.wrongOld', 'That is not the current password.');
    oldLookupSk = prev.lookupSk;
  }
  onProgress('account.progress.check');
  const found = await findAccount(pool, next, { ms: 5000 });
  if (found && found.sk !== skHex) throw fail('account.error.exists', 'An account with this username and password already exists. Sign in instead, or pick a different password.');
  const work = powBits(pow);
  if (work) onProgress('account.progress.work', { s: 0 });
  const event = await buildAccountEvent(next, skHex, { pow: work, onProgress: (s) => onProgress('account.progress.work', { s }) });
  onProgress('account.progress.publish');
  try {
    await sync.publish(event, { wait: 'one' });
  } catch (err) {
    const reason = String(err?.message || err);
    throw fail('account.error.rejected', `No relay accepted the account (${reason}).`, { reason });
  }
  if (old) await retireAccount(sync, { lookupPk: old.lookupPk, skHex, lookupSk: oldLookupSk });
  return { event, lookupPk: next.lookupPk, alias: next.name };
}

/**
 * Publish an account for a key. Refuses when the same username and password
 * already belong to a different key. Needs a relay: the event must land somewhere
 * other devices can find it, so this waits for the first relay to accept it
 * (the outbox delivers it to the others). `pow`: the bits the hub asks of a sign-up.
 * @param {{ pool: import('./relays.js').RelayPool, sync: import('./sync.js').Sync }} net
 * @param {string} username
 * @param {string} password
 * @param {string} skHex
 * @param {(msg: string, params?: Record<string, unknown>) => void} [onProgress]
 * @returns {Promise<{ event: { pubkey: string, [k: string]: any }, alias: string, lookupPk: string }>}
 */
export async function createAccount({ pool, sync }, username, password, skHex, onProgress = () => {}, { pow = 0 } = {}) {
  checkPassword(password);
  onProgress('account.progress.derive');
  const lookup = await deriveLookup(username, password, (p) => onProgress('account.progress.derivePct', { p: Math.floor(p * 100) }));
  if (!pool.online) throw fail('account.error.offlineCreate', 'No relay connected — accounts live on relays, so you need to be online to create one.');
  onProgress('account.progress.check');
  const found = await findAccount(pool, lookup, { ms: 5000 });
  if (found && found.sk !== skHex) throw fail('account.error.exists', 'An account with this username and password already exists. Sign in instead, or pick a different password.');
  const work = powBits(pow);
  if (work) onProgress('account.progress.work', { s: 0 });
  const event = await buildAccountEvent(lookup, skHex, { pow: work, onProgress: (s) => onProgress('account.progress.work', { s }) });
  onProgress('account.progress.publish');
  try {
    await sync.publish(event, { wait: 'one' });
  } catch (err) {
    const reason = String(err?.message || err);
    throw fail('account.error.rejected', `No relay accepted the account (${reason}).`, { reason });
  }
  return { event, alias: lookup.name, lookupPk: lookup.lookupPk };
}

/**
 * @param {import('./relays.js').RelayPool} pool
 * @param {string} username
 * @param {string} password
 * @param {(msg: string, params?: Record<string, unknown>) => void} [onProgress]
 * @returns {Promise<{sk: string, pk: string, alias: string, event: object, version: 1|2, lookup: { lookupPk: string, lookupSk: string, name: string }}>}
 *   version 1 is the first form: the caller upgrades it (upgradeAccount) while it still holds the lookup key
 */
export async function login(pool, username, password, onProgress = () => {}) {
  onProgress('account.progress.derive');
  const lookup = await deriveLookup(username, password, (p) => onProgress('account.progress.derivePct', { p: Math.floor(p * 100) }));
  if (!pool.online) throw fail('account.error.offline', 'No relay connected — are you online?');
  onProgress('account.progress.ask');
  const found = await timeout(findAccount(pool, lookup), 12_000, 'No relay answered.');
  if (!found) throw fail('account.error.wrongLogin', 'Wrong username or password — or none of your relays knows this account.');
  return { sk: found.sk, pk: found.pk, alias: found.alias || lookup.name, event: found.event, version: found.version, lookup };
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
