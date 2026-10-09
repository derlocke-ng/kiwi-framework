// Small helpers shared by every app. No DOM access here, so the nostr core
// stays testable under node.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function timeout(promise, ms, message = 'Timed out') {
  let t;
  return Promise.race([promise, new Promise((_, reject) => (t = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(t));
}

export function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Random url-safe id; 8 bytes = 11 chars is plenty for item keys. */
export const randomId = (bytes = 8) => bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** localStorage access that never throws (private mode, quota, disabled). */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** An Error with a stable `code` the UI can translate (see i18n.tErr) and optional `params`. */
export const fail = (code, message, params) => Object.assign(new Error(message), { code, params });
