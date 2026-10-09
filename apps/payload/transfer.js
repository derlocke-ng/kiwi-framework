// Chunking and integrity for Payload. Every file is cut into 64 KiB chunks;
// the sender hashes each with SHA-256 up front and publishes the root
// (SHA-256 of all chunk hashes in order). Receivers check every chunk as it
// arrives and the root at the end, so a single flipped bit anywhere is caught.

import { b64url, sha256 } from '../../shared/p2p.js';

export const CHUNK = 64 * 1024;

export const chunkCount = (size) => Math.max(1, Math.ceil(size / CHUNK));

/** Byte length of chunk i of a file of `size` bytes. */
export function chunkLength(size, i) {
  const n = chunkCount(size);
  if (i < 0 || i >= n) return -1;
  return i < n - 1 ? CHUNK : size - CHUNK * (n - 1);
}

export async function rootOf(hashes) {
  const all = new Uint8Array(hashes.length * 32);
  hashes.forEach((h, i) => all.set(h, i * 32));
  return b64url(await sha256(all));
}

/**
 * Hash a File/Blob chunk by chunk.
 * @returns {Promise<{ hashes: Uint8Array[], root: string }>}
 */
export async function hashBlob(blob, onProgress = () => {}) {
  const n = chunkCount(blob.size);
  const hashes = new Array(n);
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array(await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer());
    hashes[i] = await sha256(bytes);
    if (i % 16 === 0 || i === n - 1) onProgress((i + 1) / n);
  }
  return { hashes, root: await rootOf(hashes) };
}

/** Short, readable form of a root for comparing out loud. */
export const fingerprint = (root) => (root || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

/** Bytes per second over a sliding window. */
export class Meter {
  constructor(windowMs = 3000) {
    this.window = windowMs;
    this.samples = [];
  }
  add(bytes, now = Date.now()) {
    this.samples.push([now, bytes]);
    while (this.samples.length > 1 && now - this.samples[0][0] > this.window) this.samples.shift();
  }
  rate(now = Date.now()) {
    if (this.samples.length < 2) return 0;
    const span = (now - this.samples[0][0]) / 1000;
    const total = this.samples.slice(1).reduce((s, [, b]) => s + b, 0);
    return span > 0.2 ? total / span : 0;
  }
}
