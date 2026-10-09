// Passphrase-encrypted backup files: PBKDF2-SHA-256 → AES-256-GCM, plain
// WebCrypto so the format is easy to audit and to open elsewhere.

import { bytesToB64url, b64urlToBytes, fail } from './util.js';

const enc = new TextEncoder();
export const BACKUP_KIND = 'wjs-backup';
const KINDS_ACCEPTED = [BACKUP_KIND, 'loadout-backup'];
const ITERATIONS = 600_000;

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(payload, passphrase, { iterations = ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
  return {
    kind: BACKUP_KIND,
    v: 1,
    created: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToB64url(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToB64url(iv) },
    data: bytesToB64url(ct),
  };
}

/** @throws {Error} with a user-facing message on a bad file or passphrase. */
export async function decryptBackup(file, passphrase) {
  if (!file || !KINDS_ACCEPTED.includes(file.kind) || file.v !== 1 || !file.kdf || !file.cipher || !file.data) {
    throw fail('backup.error.notBackup', 'This is not a backup file from this hub.');
  }
  const iterations = Number(file.kdf.iterations);
  if (!(iterations >= 100_000 && iterations <= 10_000_000)) throw fail('backup.error.unsupported', 'Unsupported backup settings.');
  const key = await deriveKey(passphrase, b64urlToBytes(file.kdf.salt), iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(file.cipher.iv) }, key, b64urlToBytes(file.data));
  } catch {
    throw fail('backup.error.wrongPassphrase', 'Wrong passphrase, or the file is damaged.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
