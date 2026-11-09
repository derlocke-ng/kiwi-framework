// Entry for the vendored SSH bundle (shared/ssh-lib.mjs): Ed25519 from
// @noble/curves (keys and signatures for SSH keys and an SSH CA) and
// bcrypt-pbkdf (the key derivation of passphrase-protected OpenSSH key files).
// Bundled by `npm run vendor` with esbuild; only the password manager loads it.
import bcrypt from 'bcrypt-pbkdf';

export { ed25519 } from '@noble/curves/ed25519.js';
export const bcrypt_pbkdf = bcrypt.pbkdf;
