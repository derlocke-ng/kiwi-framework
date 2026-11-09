// Files people send each other: encrypted on the device with a key of their
// own, uploaded to the sender's media servers (Blossom, the same servers
// Outpost's photos go to), and described by a small object the message
// carries inside its seal: where the file is, its key and nonce, its type,
// name and size, and two hashes (of the encrypted bytes, which the server and
// the reader check, and of the file itself, which the reader checks after
// decrypting). The recipient need not be online when it is sent.
//
// The format is NIP-17's file message (kind 15): AES-GCM, the key and nonce in
// hex, `x` the SHA-256 of the encrypted file, `ox` of the original. A file
// carries no thumbnail: NIP-17 encrypts one with the same key and nonce as the
// file, which AES-GCM must never do.
//
//   const file = await uploadFile(input.files[0], { servers: kiwi.mediaServers(), sk });
//   rumor.tags.push(...fileTags(file)); rumor.content = file.url;   // a kind 15 rumor
//   const back = fileFromRumor(rumor);                               // the reader's side
//   const bytes = await openFile(back, { servers });                  // checked and decrypted
import { fetchBlob, sha256Hex, upload } from './blossom.js';
import { bytesToHex, hexToBytes } from './nostr.mjs';
import { fail } from './util.js';

/** The largest file sent this way: media servers refuse bigger ones, and the page holds it in memory twice. */
export const MAX_FILE = 100 * 1024 * 1024;
const HEX = /^[0-9a-f]+$/;
const NAME = 200;

/**
 * Encrypt bytes with a fresh key and nonce (AES-256-GCM).
 * @param {Uint8Array} bytes
 * @returns {Promise<{ data: Uint8Array, key: string, nonce: string }>}  data: the ciphertext with its tag, nothing in front
 */
export async function encryptFile(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, bytes));
  return { data, key: bytesToHex(raw), nonce: bytesToHex(nonce) };
}

/** The bytes back; throws when the key, the nonce or the bytes are not the ones it was sealed with. */
export async function decryptFile(data, keyHex, nonceHex) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(nonceHex) }, key, data));
}

/**
 * A file as a message carries it, cleaned: null when something it needs is missing or malformed.
 * @param {any} f
 */
export function cleanFile(f) {
  if (!f || typeof f !== 'object') return null;
  const url = String(f.url || '');
  if (!/^https?:\/\//.test(url)) return null;
  const hex = (v, n) => (typeof v === 'string' && v.length === n && HEX.test(v) ? v : null);
  const x = hex(f.x, 64);
  const ox = hex(f.ox, 64);
  const key = hex(f.key, 64);
  const nonce = hex(f.nonce, 24);
  if (!x || !key || !nonce) return null;
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(f.type || '')) ? String(f.type) : 'application/octet-stream';
  const name = String(f.name || '').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, NAME) || 'file';
  const size = Number.isSafeInteger(f.size) && f.size >= 0 ? f.size : null;
  const dim = /^\d{1,5}x\d{1,5}$/.test(String(f.dim || '')) ? String(f.dim) : null;
  return { url, x, ...(ox ? { ox } : {}), key, nonce, type, name, ...(size != null ? { size } : {}), ...(dim ? { dim } : {}) };
}

/**
 * Encrypt a file and upload it to the first of `servers` that takes it.
 * @param {Blob & { name?: string }} file
 * @param {{ servers: string[], sk: string, onProgress?: ((share: number) => void) | null }} options
 */
export async function uploadFile(file, { servers, sk, onProgress = null }) {
  if (file.size > MAX_FILE) throw fail('files.error.tooBig', 'The file is too big to send (at most 100 MB).', { max: '100 MB' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ox = await sha256Hex(bytes);
  const { data, key, nonce } = await encryptFile(bytes);
  const dim = await imageSize(file);
  const up = await upload(servers, data, { type: 'application/octet-stream', sk, name: 'file', onProgress });
  onProgress?.(1);
  return cleanFile({ url: up.url, x: up.sha256, ox, key, nonce, type: file.type, name: file.name, size: bytes.byteLength, dim });
}

/** An image's size as `<w>x<h>` (NIP-17's `dim`), else null; browser only. */
async function imageSize(file) {
  if (!/^image\//.test(file.type) || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const dim = `${bmp.width}x${bmp.height}`;
    bmp.close?.();
    return dim;
  } catch {
    return null;
  }
}

/**
 * The bytes of a file a message carried: fetched from its URL or the given servers, checked against `x`,
 * decrypted, checked against `ox` when the sender gave it.
 * @param {{ url: string, x: string, ox?: string, key: string, nonce: string }} f
 * @param {{ servers?: string[] }} [options]
 */
export async function openFile(f, { servers = [] } = {}) {
  const data = await fetchBlob({ url: f.url, sha256: f.x }, { servers });
  const bytes = await decryptFile(data, f.key, f.nonce);
  if (f.ox && (await sha256Hex(bytes)) !== f.ox) throw fail('files.error.changed', 'The file is not the one that was sent.');
  return bytes;
}

/** NIP-17 kind 15 tags for a file (the rumor's content is its URL); `file-name` is ours (not `name`, which a chat message uses for its writer), other clients ignore it. */
export function fileTags(f) {
  return [
    ['file-type', f.type],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', f.key],
    ['decryption-nonce', f.nonce],
    ['x', f.x],
    ...(f.ox ? [['ox', f.ox]] : []),
    ...(f.size != null ? [['size', String(f.size)]] : []),
    ...(f.dim ? [['dim', f.dim]] : []),
    ['file-name', f.name],
  ];
}

/** The file a kind 15 rumor describes, or null (another algorithm, a missing key, a URL that is not one). */
export function fileFromRumor(rumor) {
  const tag = (k) => rumor?.tags?.find((t) => t[0] === k)?.[1];
  if ((tag('encryption-algorithm') || '').toLowerCase() !== 'aes-gcm') return null;
  const size = Number(tag('size'));
  return cleanFile({
    url: String(rumor.content || '').trim(),
    x: tag('x'),
    ox: tag('ox'),
    key: (tag('decryption-key') || '').toLowerCase(),
    nonce: (tag('decryption-nonce') || '').toLowerCase(),
    type: tag('file-type'),
    name: tag('file-name') || '',
    size: Number.isSafeInteger(size) ? size : undefined,
    dim: tag('dim'),
  });
}

/** A size for people in their language: 1.2 MB, 1,2 MB. */
export function fileSize(n, lang = 'en') {
  if (!Number.isFinite(n) || n < 0) return '';
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return new Intl.NumberFormat(lang, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i && v < 10 ? 1 : 0 }).format(v);
}
