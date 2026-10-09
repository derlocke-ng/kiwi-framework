// Files on Blossom servers (https://github.com/hzrd149/blossom): photos and
// attachments for every app. A blob is addressed by the SHA-256 of its bytes,
// so any server that has it can serve it and nobody can swap it: every
// download is checked against the hash. Uploads are signed by the person's
// key (a kind 24242 event, BUD-01/02). Files are encrypted before they leave
// the device unless the app says they are public; servers then hold random
// bytes. Photos are re-encoded first: smaller, and without the metadata
// cameras put in them (location, device).
//
//   const media = await uploadMedia(file, { servers, sk, encrypt: true, onProgress });
//   // → { url, sha256, size, mime, width, height, key?, thumb?: { url, sha256, width, height } }
//   const bytes = await openMedia(media, { servers });   // fetched, checked, decrypted
//
// Apps keep the media object inside their own (encrypted) events: the key
// never travels on its own.
import { finalizeEvent, hexToBytes, bytesToHex } from './nostr.mjs';
import { fail } from './util.js';

export const AUTH_KIND = 24242;
export const SERVER_LIST_KIND = 10063; // BUD-03, for later

/** A server's base URL without a trailing slash (paths are kept: https://host/media), or null. */
export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

const b64 = (text) => {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** A signed authorization for one action on one blob, valid for `ttl` seconds. */
export function authEvent({ verb, sha256 = null, sk, ttl = 300, content = verb }) {
  const now = Math.floor(Date.now() / 1000);
  const tags = [['t', verb], ['expiration', String(now + ttl)]];
  if (sha256) tags.push(['x', sha256]);
  return finalizeEvent({ kind: AUTH_KIND, created_at: now, tags, content }, hexToBytes(sk));
}
export const authHeader = (event) => `Nostr ${b64(JSON.stringify(event))}`;

// ---- encryption: AES-256-GCM, a fresh key per file, the IV in front of the ciphertext ----

export async function encryptBlob(bytes, keyHex = null) {
  const raw = keyHex ? hexToBytes(keyHex) : crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const data = new Uint8Array(12 + ct.length);
  data.set(iv);
  data.set(ct, 12);
  return { data, key: bytesToHex(raw) };
}

export async function decryptBlob(data, keyHex) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)));
}

// ---- photos: re-encoded in the browser ----

/** Scale a photo down to `max` pixels on its long side and re-encode it (no metadata survives). Browser only. */
export async function prepareImage(file, { max = 2048, quality = 0.85 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw fail('media.error.notImage', 'This file is not a photo this browser can read.');
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  // Transparent images stay transparent (WebP); everything else becomes a JPEG.
  const type = /png|webp/.test(file.type) ? 'image/webp' : 'image/jpeg';
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type, quality }) : await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob, width, height };
}

// ---- talking to servers ----

const reasonOf = (res) => res.headers.get('x-reason') || res.statusText || `HTTP ${res.status}`;

/** PUT with upload progress where the platform has it (XMLHttpRequest), plain fetch otherwise. */
function put(url, data, headers, onProgress) {
  if (onProgress && typeof XMLHttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, reason: xhr.getResponseHeader('x-reason') || xhr.statusText, text: xhr.responseText });
      xhr.onerror = () => reject(new Error('unreachable, or it does not allow this site (CORS)'));
      xhr.send(data);
    });
  }
  return fetch(url, { method: 'PUT', headers, body: data }).then(async (res) => ({ ok: res.ok, status: res.status, reason: reasonOf(res), text: await res.text() }));
}

/**
 * Upload bytes to the first server that takes them. Big files are announced
 * first (BUD-06 HEAD /upload) so a server that would refuse them is skipped
 * without sending them. Resolves with { url, sha256, size, type, server,
 * errors }; when no server takes the file, rejects with every server's reason.
 * @param {string[]} servers
 * @param {Uint8Array} data
 * @param {{ type?: string, sk: string, name?: string, onProgress?: ((share: number) => void) | null }} options
 */
export async function upload(servers, data, { type = 'application/octet-stream', sk, name = 'file', onProgress } = {}) {
  const sha256 = await sha256Hex(data);
  const errors = [];
  for (const server of servers.map(normalizeServer).filter(Boolean)) {
    try {
      const auth = authHeader(authEvent({ verb: 'upload', sha256, sk, content: `Upload ${name}` }));
      if (data.byteLength > 256 * 1024) {
        const pre = await fetch(`${server}/upload`, { method: 'HEAD', headers: { Authorization: auth, 'X-SHA-256': sha256, 'X-Content-Length': String(data.byteLength), 'X-Content-Type': type } }).catch(() => null);
        if (pre && !pre.ok && ![404, 405, 501].includes(pre.status)) {
          errors.push({ server, status: pre.status, reason: reasonOf(pre) });
          continue;
        }
      }
      const res = await put(`${server}/upload`, data, { Authorization: auth, 'Content-Type': type }, onProgress);
      if (!res.ok) {
        errors.push({ server, status: res.status, reason: res.reason });
        continue;
      }
      let d = {};
      try {
        d = JSON.parse(res.text);
      } catch {}
      if (d.sha256 && d.sha256 !== sha256) {
        errors.push({ server, status: res.status, reason: 'stored different bytes' });
        continue;
      }
      return { url: d.url || `${server}/${sha256}`, sha256, size: data.byteLength, type, server, errors };
    } catch (err) {
      errors.push({ server, status: 0, reason: err?.message || String(err) });
    }
  }
  const reasons = errors.map((e) => `${new URL(e.server).host}: ${e.reason}`).join('; ') || 'no media server set';
  throw Object.assign(fail('media.error.noServer', `No media server took the file (${reasons}).`, { reasons }), { errors });
}

/**
 * The blob's bytes from its URL or, failing that, from any of `servers`; checked against its hash.
 * @param {{ url?: string, sha256: string }} blob
 * @param {{ servers?: string[] }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function fetchBlob({ url, sha256 }, { servers = [] } = {}) {
  const tries = [...new Set([url, ...servers.map(normalizeServer).filter(Boolean).map((s) => `${s}/${sha256}`)].filter(Boolean))];
  for (const u of tries) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      const data = new Uint8Array(await res.arrayBuffer());
      if (sha256 && (await sha256Hex(data)) !== sha256) continue; // not the file this was about: try the next server
      return data;
    } catch {}
  }
  throw fail('media.error.notFound', 'The file is on none of its servers.');
}

/** Ask a server to delete a blob this key uploaded. */
export async function removeBlob(server, sha256, sk) {
  const s = normalizeServer(server);
  const res = await fetch(`${s}/${sha256}`, { method: 'DELETE', headers: { Authorization: authHeader(authEvent({ verb: 'delete', sha256, sk, content: 'Delete' })) } });
  return res.ok;
}

// ---- media: what apps store ----

/**
 * Prepare, (encrypt,) upload a file and its thumbnail. Returns the media
 * object an app keeps in its event; `key` is there only when encrypted.
 * @param {Blob & { name?: string }} file
 * @param {{ servers: string[], sk: string, encrypt?: boolean, max?: number, thumb?: number, onProgress?: ((share: number) => void) | null }} options
 */
export async function uploadMedia(file, { servers, sk, encrypt = true, max = 2048, thumb = 480, onProgress = null } = {}) {
  let blob = file;
  let width = null;
  let height = null;
  let small = null;
  const image = /^image\//.test(file.type) && file.type !== 'image/gif' && typeof createImageBitmap === 'function';
  if (image) {
    ({ blob, width, height } = await prepareImage(file, { max }));
    if (thumb && Math.max(width, height) > thumb) small = await prepareImage(file, { max: thumb, quality: 0.75 });
  }
  const mime = blob.type || file.type || 'application/octet-stream';
  let bytes = new Uint8Array(await blob.arrayBuffer());
  let key = null;
  if (encrypt) ({ data: bytes, key } = await encryptBlob(bytes));
  const type = encrypt ? 'application/octet-stream' : mime;
  const name = file.name || 'file';
  const total = bytes.byteLength + (small ? small.blob.size + 28 : 0);
  const main = await upload(servers, bytes, { type, sk, name, onProgress: onProgress && ((p) => onProgress((p * bytes.byteLength) / total)) });
  const media = { url: main.url, sha256: main.sha256, size: bytes.byteLength, mime, ...(width ? { width, height } : {}), ...(key ? { key } : {}) };
  if (small) {
    let tb = new Uint8Array(await small.blob.arrayBuffer());
    if (encrypt) tb = (await encryptBlob(tb, key)).data;
    const t = await upload([main.server, ...servers], tb, { type: encrypt ? 'application/octet-stream' : small.blob.type, sk, name: `thumb ${name}` });
    media.thumb = { url: t.url, sha256: t.sha256, width: small.width, height: small.height };
  }
  onProgress?.(1);
  return media;
}

/**
 * A media object's bytes, checked and decrypted; `small` takes the thumbnail when there is one.
 * @param {{ url?: string, sha256: string, key?: string, thumb?: { url?: string, sha256: string } }} media
 * @param {{ servers?: string[], small?: boolean }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function openMedia(media, { servers = [], small = false } = {}) {
  const which = small && media.thumb ? media.thumb : media;
  const data = await fetchBlob(which, { servers });
  return media.key ? decryptBlob(data, media.key) : data;
}

// ---- checking a server ----

/** A real 8×8 JPEG: what a server that only takes images is given when it is checked. */
const SAMPLE_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCYAnR3/9k=';
const sampleJpeg = () => Uint8Array.from(atob(SAMPLE_JPEG), (c) => c.charCodeAt(0));

/**
 * What a server does with this key's uploads, tried for real with a tiny
 * file that is deleted again: 'encrypted' (takes any file, so encrypted
 * ones too), 'imagesOnly', 'paid' (asks for payment), 'denied' (with the
 * reason), 'unreachable' (offline, gone, or it does not allow this site).
 * `cors` says whether the server lets web pages use it (null where the
 * platform does not show it).
 */
export async function probe(server, { sk }) {
  const base = normalizeServer(server);
  if (!base) return { server, result: 'denied', reason: 'not an https address' };
  const tryUpload = async (data, type) => {
    const sha256 = await sha256Hex(data);
    const res = await fetch(`${base}/upload`, { method: 'PUT', headers: { Authorization: authHeader(authEvent({ verb: 'upload', sha256, sk, content: 'Upload probe' })), 'Content-Type': type }, body: data });
    if (res.ok) await removeBlob(base, sha256, sk).catch(() => false);
    return res;
  };
  try {
    const opaque = (await encryptBlob(crypto.getRandomValues(new Uint8Array(64)))).data;
    const res = await tryUpload(opaque, 'application/octet-stream');
    // A page only gets an answer when the server allows it; elsewhere (node) the header tells.
    const cors = typeof window === 'undefined' ? Boolean(res.headers.get('access-control-allow-origin')) : true;
    if (res.ok) return { server: base, result: 'encrypted', reason: '', cors };
    if (res.status === 402) return { server: base, result: 'paid', reason: reasonOf(res), cors };
    const img = await tryUpload(sampleJpeg(), 'image/jpeg');
    if (img.ok) return { server: base, result: 'imagesOnly', reason: reasonOf(res), cors };
    return { server: base, result: img.status === 402 ? 'paid' : 'denied', reason: reasonOf(img), cors };
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message;
    return { server: base, result: 'unreachable', reason: [err?.message || String(err), cause].filter(Boolean).join(': '), cors: null };
  }
}
