// Nostr events as the apps use them: our kind numbers, addressable-event
// rules, signing with monotonic timestamps, and symmetric encryption of
// event content.

import { finalizeEvent, hexToBytes, bytesToHex, sha256, hkdf, isAddressableKind, isReplaceableKind, isEphemeralKind } from './nostr.mjs';
import { bytesToB64url, b64urlToBytes } from './util.js';

export const KINDS = {
  // Addressable (30000–39999): relays keep the newest event per author and d tag.
  LOADOUT_WALLET: 30700, // one per board you keep, encrypted to yourself
  LOADOUT_INFO: 30701, // signed by the board key: title, type, mode
  LOADOUT_ITEM: 30702, // signed by the board key: one list item
  LOADOUT_DOC: 30703, // signed by the board key: the note body
  ACCOUNT: 30790, // username + password login, signed by a key derived from both
  SETTINGS: 30791, // per-account settings, encrypted to yourself
  // Ephemeral (20000–29999): relays pass them on and forget them.
  P2P_PRESENCE: 21700,
  P2P_SIGNAL: 21701,
  P2P_DATA: 21702,
  MUTE_LIST: 10000, // NIP-51: who we block (private entries)
  REPORT: 1984, // NIP-56
  REACTION: 7, // NIP-25: votes on DevBoard posts
  DELETION: 5, // NIP-09
  DEVBOARD_POST: 30810, // public noticeboard post, proof of work required
  GIFT_WRAP: 1059, // NIP-59: a sealed rumor for one recipient (friend requests, shares)
  SEAL: 13,
  // Rumor kinds inside a gift wrap; relays never see them as such.
  FRIEND_REQUEST: 7801,
  FRIEND_ACCEPT: 7802,
  FRIEND_REMOVE: 7803,
  SHARE: 7804,
};

export const now = () => Math.floor(Date.now() / 1000);
export const hex = bytesToHex;
export const bytes = hexToBytes;
export const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const dTag = (event) => event.tags.find((t) => t[0] === 'd')?.[1] ?? '';

/** `kind:pubkey:d` for replaceable and addressable events, null for the rest. */
export function addressOf(event) {
  if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}:`;
  if (isAddressableKind(event.kind)) return `${event.kind}:${event.pubkey}:${dTag(event)}`;
  return null;
}

/** NIP-01 ordering for replaceable events: newest wins, lowest id breaks ties. */
export const supersedes = (a, b) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

export { isEphemeralKind };

// created_at has one-second resolution. Two edits of the same item within a
// second would otherwise tie, and the tie-break by id could pick the older
// one, so each address gets a strictly increasing timestamp on this device.
// And a new version must be newer than every version this device has seen:
// another device's clock may run ahead of ours (or ours did, before a
// reload, after quick edits), and relays and stores keep only the newest
// version, so an edit stamped by our clock alone would be dropped everywhere
// while the screen still showed it. The store reports every version it reads
// or receives (observe), and stamp() starts after the newest of them.
const lastStamp = new Map();
export function stamp(address) {
  const t = Math.max(now(), (lastStamp.get(address) ?? 0) + 1);
  lastStamp.set(address, t);
  return t;
}

/** A version of a replaceable or addressable event this device has seen: its next write there must be newer. */
export function observe(event) {
  const address = event && addressOf(event);
  if (address && event.created_at > (lastStamp.get(address) ?? 0)) lastStamp.set(address, event.created_at);
}

/** Sign an addressable event with a secret key (hex). */
export function makeAddressable(kind, d, content, skHex, extraTags = []) {
  const pubkey = getPubkeyCached(skHex);
  const created_at = stamp(`${kind}:${pubkey}:${d}`);
  return finalizeEvent({ kind, created_at, tags: [['d', d], ...extraTags], content }, hexToBytes(skHex));
}

/** Sign any event template; created_at defaults to now. */
export function sign(template, skHex) {
  return finalizeEvent({ created_at: now(), tags: [], ...template }, hexToBytes(skHex));
}

import { getPublicKey } from './nostr.mjs';
const pubkeys = new Map();
export function getPubkeyCached(skHex) {
  let pk = pubkeys.get(skHex);
  if (!pk) {
    pk = getPublicKey(hexToBytes(skHex));
    pubkeys.set(skHex, pk);
  }
  return pk;
}

// ---- symmetric content encryption ----
// AES-256-GCM (WebCrypto) with a random IV; large values are gzipped first so
// long notes stay well under relay message limits. Format, base64url:
//   version(1) || iv(12) || ciphertext   version 1 = JSON, 2 = gzip(JSON)

const te = new TextEncoder();
const td = new TextDecoder();
const cryptoKeys = new Map();

async function aesKey(keyBytes, usage) {
  const id = `${bytesToHex(keyBytes)}|${usage}`;
  let k = cryptoKeys.get(id);
  if (!k) {
    k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [usage]);
    cryptoKeys.set(id, k);
  }
  return k;
}

async function pipe(bytesIn, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytesIn);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Encrypt any JSON value with a 32-byte key. */
export async function seal(keyBytes, value) {
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
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([version]) }, await aesKey(keyBytes, 'encrypt'), plain));
  const out = new Uint8Array(13 + ct.length);
  out[0] = version;
  out.set(iv, 1);
  out.set(ct, 13);
  return bytesToB64url(out);
}

/** Decrypt a sealed payload. Throws on a wrong key or damaged data. */
export async function open(keyBytes, payload) {
  const u8 = b64urlToBytes(payload);
  const version = u8[0];
  if (version !== 1 && version !== 2) throw new Error('Unknown payload version');
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(1, 13), additionalData: new Uint8Array([version]) }, await aesKey(keyBytes, 'decrypt'), u8.subarray(13)));
  if (version === 2) plain = await pipe(plain, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(plain));
}

/** A 32-byte key derived from a secret (hex) for one purpose. */
export const deriveKey = (secretHex, label) => hkdf(sha256, hexToBytes(secretHex), undefined, te.encode(label), 32);

/** Short, human-comparable fingerprint of a public key. */
export const fingerprint = (pk) => String(pk || '').slice(0, 12).replace(/(.{4})(?=.)/g, '$1-');
