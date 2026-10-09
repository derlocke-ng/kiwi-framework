// Proof of work (NIP-13) for every app: mine a nonce in parallel web workers,
// check what arrives. How many bits an app demands is its policy; this is
// the engine.
//
//   const mined = await minePow(template, 18, { onProgress });  // template + nonce tag + id
//   const event = sign(mined, sk);
//   hasPow(event, 18);                                           // true when it carries the work
//
// The template needs pubkey and created_at (the id covers both). Mining
// serialises the event once and patches the nonce digits into the bytes, so
// every try costs one SHA-256; the workers split the nonce space by stride.
import { sha256, getEventHash, nip13 } from './nostr.mjs';
import { store } from './util.js';

export const CORES_KEY = 'wjs.pow.cores';
const WORKER_URL = new URL('./pow-worker.js', import.meta.url);

export const powOf = (event) => nip13.getPow(event.id);

/** True when the id has `bits` leading zero bits and the nonce tag targets at least that (NIP-13). */
export function hasPow(event, bits) {
  if (!(bits > 0)) return true;
  const nonce = event.tags.find((x) => x[0] === 'nonce');
  return Number(nonce?.[2]) >= bits && nip13.getPow(event.id) >= bits;
}

export const hardwareCores = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;

/** Workers to mine with: the device setting, else every core but one, but at least four — Tor Browser and locked-down phones report two cores whatever they have, and over-subscribing costs nothing here. */
export function cores() {
  const chosen = Number(store.get(CORES_KEY));
  if (chosen >= 1) return Math.min(16, Math.floor(chosen));
  return Math.max(4, Math.min(8, hardwareCores() - 1));
}

function zeroBits(hash) {
  let bits = 0;
  for (let i = 0; i < hash.length; i++) {
    const b = hash[i];
    if (b === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(b) - 24;
    break;
  }
  return bits;
}

/** Serialise once; `bytes(n)` patches nonce n into the buffer, `finish(n)` builds the event with its id. */
function prepare(template, bits) {
  if (!template.pubkey || !template.created_at) throw new Error('mining needs pubkey and created_at');
  const base = { ...template, tags: (template.tags || []).filter((x) => x[0] !== 'nonce') };
  let parts;
  for (let attempt = 0; attempt < 5 && !parts; attempt++) {
    const marker = `nonce-${Math.random().toString(36).slice(2)}`;
    const serialized = JSON.stringify([0, base.pubkey, base.created_at, base.kind, [...base.tags, ['nonce', marker, String(bits)]], base.content]);
    const split = serialized.split(marker);
    if (split.length === 2) parts = split;
  }
  if (!parts) throw new Error('cannot serialise the event for mining');
  const enc = new TextEncoder();
  const head = enc.encode(parts[0]);
  const tail = enc.encode(parts[1]);
  const buf = new Uint8Array(head.length + 24 + tail.length);
  buf.set(head, 0);
  let len = 0;
  return {
    bytes(n) {
      const digits = String(n);
      if (digits.length !== len) {
        len = digits.length;
        buf.set(tail, head.length + len);
      }
      for (let i = 0; i < len; i++) buf[head.length + i] = digits.charCodeAt(i);
      return buf.subarray(0, head.length + len + tail.length);
    },
    finish(n) {
      const event = { ...base, tags: [...base.tags, ['nonce', String(n), String(bits)]] };
      event.id = getEventHash(event);
      if (nip13.getPow(event.id) < bits) throw new Error('mining produced a mismatching id');
      return event;
    },
  };
}

/**
 * Mine on this thread with the bundled SHA-256, trying nonces start,
 * start+stride, start+2·stride, … Returns { event, tried }.
 */
export function mineNonce(template, bits, { start = 0, stride = 1, onCount = null, every = 4096 } = {}) {
  const p = prepare(template, bits);
  let tried = 0;
  for (let n = start; ; n += stride) {
    tried++;
    if (zeroBits(sha256(p.bytes(n))) >= bits) return { event: p.finish(n), tried };
    if (onCount && tried % every === 0) onCount(tried);
  }
}

/**
 * The same with the browser's native SHA-256 (WebCrypto), a few digests in
 * flight. A little slower than the bundled one when the JavaScript JIT is
 * on; dozens of times faster when it is off (Tor Browser's safer levels,
 * locked-down phones), where pure JavaScript hashing crawls.
 */
export async function mineNonceSubtle(template, bits, { start = 0, stride = 1, onCount = null, inflight = 8 } = {}) {
  const p = prepare(template, bits);
  let tried = 0;
  for (let n = start; ; ) {
    const batch = [];
    const nonces = [];
    for (let k = 0; k < inflight; k++, n += stride) {
      nonces.push(n);
      batch.push(crypto.subtle.digest('SHA-256', p.bytes(n))); // digest copies the bytes before returning
    }
    const hashes = await Promise.all(batch);
    tried += inflight;
    for (let k = 0; k < hashes.length; k++) if (zeroBits(new Uint8Array(hashes[k])) >= bits) return { event: p.finish(nonces[k]), tried };
    if (onCount) onCount(tried);
  }
}

/** Which hasher is faster here, measured for a few milliseconds each: 'subtle' or 'sync'. */
export async function pickMiner(template, ms = 30) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return 'sync';
  const p = prepare(template, 1);
  let js = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    sha256(p.bytes(js));
    js++;
  }
  const jsRate = js / Math.max(1, Date.now() - t0);
  let native = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < ms) {
    await Promise.all(Array.from({ length: 8 }, (_, k) => crypto.subtle.digest('SHA-256', p.bytes(native + k))));
    native += 8;
  }
  const nativeRate = native / Math.max(1, Date.now() - t1);
  return nativeRate > jsRate ? 'subtle' : 'sync';
}

/**
 * Mine in parallel workers (on this thread where there are none, e.g. tests).
 * onProgress gets { ms, hashes, rate }; signal cancels.
 * @returns {Promise<object>} the event with nonce tag and id, ready to sign
 */
export function minePow(template, bits, { onProgress = null, workers = cores(), signal = null } = {}) {
  if (!(bits > 0)) return Promise.resolve({ ...template, id: getEventHash(template) });
  if (typeof Worker !== 'function') return Promise.resolve().then(() => mineNonce(template, bits).event);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const pool = [];
    const counts = [];
    let done = false;
    const stop = () => {
      done = true;
      for (const w of pool) w.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (done) return;
      stop();
      reject(Object.assign(new Error('Cancelled'), { code: 'pow.cancelled' }));
    };
    const fail = (err) => {
      if (done) return;
      stop();
      reject(err);
    };
    signal?.addEventListener('abort', onAbort);
    for (let i = 0; i < Math.max(1, workers); i++) {
      let w;
      try {
        w = new Worker(WORKER_URL, { type: 'module' });
      } catch (err) {
        if (pool.length) break; // some workers are enough
        try {
          return resolve(mineNonce(template, bits).event); // no workers at all: here, then
        } catch (e) {
          return reject(e);
        }
      }
      const index = i;
      w.onmessage = (e) => {
        if (done) return;
        if (e.data.tried != null) {
          counts[index] = e.data.tried;
          const hashes = counts.reduce((a, b) => a + (b || 0), 0);
          const ms = Date.now() - started;
          onProgress?.({ ms, hashes, rate: ms ? Math.round((hashes / ms) * 1000) : 0 });
          return;
        }
        if (e.data.error) return fail(new Error(e.data.error));
        stop();
        resolve(e.data.event);
      };
      w.onerror = (e) => fail(new Error(e.message || 'proof of work failed'));
      pool.push(w);
    }
    pool.forEach((w, i) => w.postMessage({ template, bits, start: i, stride: pool.length }));
  });
}
