// Payload's links: files that wait for whoever has the link, even when the
// sender is offline. Each file is encrypted on the device with a key of its own
// and uploaded to the sender's media servers (shared/files.js, as Uplink's
// files); a manifest lists them with their keys, is encrypted with a key of its
// own and uploaded beside them. The link carries the manifest's hash, its key
// and nonce and the server it is on, after the `#`, the part browsers never send
// to a server: the servers hold only ciphertext, and only the link opens it.
// The sender keeps the links they made (the app's settings, sealed to their
// key) and can delete the files from the servers.
//
//   const share = await createShare(files, { servers, sk, from: 'ada' });
//   const link = `${page}#/${shareFragment(share)}`;
//   const { files } = await openShare(parseShare(location.hash.slice(2)));
import { removeBlob, upload } from '../../../shared/blossom.js';
import { cleanFile, encryptFile, MAX_FILE, openFile, uploadFile } from '../../../shared/files.js';
import { bytesToHex, hexToBytes } from '../../../shared/nostr.mjs';
import { b64url, fromB64url } from '../../../shared/p2p.js';
import { fail } from '../../../shared/util.js';

/** Files in one link, and how big each may be (media servers refuse bigger ones). */
export const MAX_FILES = 20;
export { MAX_FILE };
const te = new TextEncoder();
const td = new TextDecoder();
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Upload files encrypted and the manifest that lists them. onProgress gets the share of the bytes done (0…1).
 * @param {File[]} files
 * @param {{ servers: string[], sk: string, from?: string, onProgress?: ((done: number) => void) | null }} options
 * @returns {Promise<{ x: string, key: string, nonce: string, server: string, files: any[], at: number }>}
 */
export async function createShare(files, { servers, sk, from = '', onProgress = null }) {
  if (!files.length) throw fail('pl.error.noFiles', 'Choose files first.');
  if (files.length > MAX_FILES) throw fail('pl.error.tooMany', `At most ${MAX_FILES} files in one link.`, { n: MAX_FILES });
  if (!servers.length) throw fail('pl.error.noServers', 'No media server to put the files on: choose one in the settings.');
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  let done = 0;
  const out = [];
  for (const file of files) {
    const f = await uploadFile(file, { servers, sk, onProgress: (p) => onProgress?.((done + p * file.size) / total) });
    done += file.size;
    out.push(f);
  }
  const at = Date.now();
  const manifest = { v: 1, from: String(from || '').slice(0, 60), at, files: out };
  const { data, key, nonce } = await encryptFile(te.encode(JSON.stringify(manifest)));
  const up = await upload(servers, data, { type: 'application/octet-stream', sk, name: 'manifest' });
  onProgress?.(1);
  return { x: up.sha256, key, nonce, server: new URL(up.url).origin, files: out, at };
}

/** The link's fragment for a share (after `#/`): l/<hash>.<key>.<nonce>.<server>, the binary parts in base64url. */
export function shareFragment({ x, key, nonce, server }) {
  return `l/${x}.${b64url(hexToBytes(key))}.${b64url(hexToBytes(nonce))}.${b64url(te.encode(server))}`;
}

/**
 * What a link's fragment names, or null when it is not one.
 * @param {string} fragment  `l/…` (with or without `#/` in front)
 */
export function parseShare(fragment) {
  const m = /^(?:#?\/)?l\/([0-9a-f]{64})\.([\w-]{43})\.([\w-]{16})\.([\w-]+)$/.exec(String(fragment || '').trim());
  if (!m) return null;
  try {
    const key = bytesToHex(fromB64url(m[2]));
    const nonce = bytesToHex(fromB64url(m[3]));
    const server = new URL(td.decode(fromB64url(m[4]))).origin;
    if (key.length !== 64 || nonce.length !== 24 || !/^https?:/.test(server)) return null;
    return { x: m[1], key, nonce, server };
  } catch {
    return null;
  }
}

/**
 * The manifest a link opens: who shared, when, and the files (as shared/files.js describes them).
 * @param {{ x: string, key: string, nonce: string, server: string }} ref
 */
export async function openShare(ref) {
  let manifest;
  try {
    const bytes = await openFile({ url: `${ref.server}/${ref.x}`, x: ref.x, key: ref.key, nonce: ref.nonce });
    manifest = JSON.parse(td.decode(bytes));
  } catch (err) {
    if (err?.code === 'media.error.notFound') throw fail('pl.error.gone', 'These files are not there any more: the sender deleted them, or the server let them go.');
    throw fail('pl.error.badLink', 'This link does not open: it was copied incompletely, or it is not a Payload link.');
  }
  const files = (Array.isArray(manifest?.files) ? manifest.files : []).map(cleanFile).filter(Boolean).slice(0, MAX_FILES);
  if (!files.length) throw fail('pl.error.badLink', 'This link does not open: it was copied incompletely, or it is not a Payload link.');
  return { from: String(manifest.from || '').slice(0, 60), at: Number(manifest.at) || 0, files };
}

/** Where a blob is: the origin of its URL. */
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Delete a share's files and manifest from the servers (as the key that uploaded them). Resolves with how many
 * blobs went and how many a server kept (a server may refuse, or be gone).
 * @param {{ x: string, server: string, files: { url: string, x: string }[] }} share
 * @param {string} sk
 */
export async function deleteShare(share, sk) {
  const blobs = [...share.files.map((f) => ({ server: originOf(f.url), x: f.x })), { server: share.server, x: share.x }].filter((b) => b.server && HEX64.test(b.x));
  let removed = 0;
  for (const b of blobs) {
    const ok = await removeBlob(b.server, b.x, sk).catch(() => false);
    if (ok) removed++;
  }
  return { removed, kept: blobs.length - removed };
}

/** A share as the sender keeps it in the app's settings (no file bytes, the link's parts). */
export const keptShare = (s) => ({
  x: s.x,
  key: s.key,
  nonce: s.nonce,
  server: s.server,
  at: s.at,
  files: s.files.map((f) => ({ name: f.name, size: f.size, type: f.type, url: f.url, x: f.x })),
});

