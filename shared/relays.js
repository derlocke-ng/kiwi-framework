// A pool of nostr relays. nostr-tools' Relay keeps a connection alive and
// re-sends open subscriptions after a drop; this adds retries for relays that
// were down when we started, a status feed for the UI, de-duplication across
// relays, per-relay publishing for the outbox, and NIP-11 info with caching.

import { Relay, fetchRelayInformation } from './nostr.mjs';
import { DISTRIBUTION } from './distribution.js';
import { store, timeout } from './util.js';

export const RELAYS_KEY = 'wjs.relays';

// Public relays that accept application data; replace the first entries with
// kiwi-network relays once the module runs. Users can edit the list.
export const DEFAULT_RELAYS = DISTRIBUTION.relays; // the distribution's choice (shared/distribution.js)

const RETRY_EVERY = 15_000;
const CONNECT_TIMEOUT = 8000;
const SEEN_MAX = 4000;

export const normalizeRelayUrl = (input) => {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^wss?:\/\//i.test(s)) s = (/^(localhost|127\.0\.0\.1)(:|$)/.test(s) ? 'ws://' : 'wss://') + s;
  try {
    const u = new URL(s);
    if (!/^wss?:$/.test(u.protocol)) return null;
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
};

export function savedRelays() {
  const saved = store.get(RELAYS_KEY);
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_RELAYS;
}

export function saveRelays(list) {
  const clean = [...new Set(list.map(normalizeRelayUrl).filter(Boolean))];
  if (!clean.length || clean.join() === DEFAULT_RELAYS.join()) store.remove(RELAYS_KEY);
  else store.set(RELAYS_KEY, clean);
  return clean;
}

/** A relay's final no: retrying would not help. */
export const isPermanent = (error) => /^(blocked|invalid|restricted|error: unknown)/.test(String(error || ''));

export class RelayPool {
  constructor(urls = savedRelays()) {
    this.relays = new Map(); // url -> { relay, open, latency, connecting, lastError }
    this.statusListeners = new Set();
    this.connectListeners = new Set();
    this.subs = new Set();
    for (const url of urls) this.add(url);
    this.timer = setInterval(() => this.tick(), 1000);
    this.retryTimer = setInterval(() => this.retry(), RETRY_EVERY);
    if (typeof addEventListener === 'function') addEventListener('online', () => this.retry());
  }

  get urls() {
    return [...this.relays.keys()];
  }

  add(url) {
    if (this.relays.has(url)) return;
    const relay = new Relay(url, { enablePing: true, enableReconnect: true });
    relay.onnotice = (msg) => console.info(`${url}: ${msg}`);
    const entry = { relay, open: false, latency: null, connecting: false, lastError: null, publishError: null, publishErrorAt: 0, lastOkAt: 0 };
    this.relays.set(url, entry);
    for (const sub of this.subs) this.attach(sub, entry);
    this.connect(entry);
  }

  remove(url) {
    const entry = this.relays.get(url);
    if (!entry) return;
    try {
      entry.relay.close();
    } catch {
      /* ignore */
    }
    this.relays.delete(url);
    this.tick();
  }

  async connect(entry) {
    if (entry.connecting || entry.relay.connected) return;
    entry.connecting = true;
    const t0 = performance.now();
    try {
      await entry.relay.connect({ timeout: CONNECT_TIMEOUT });
      entry.latency = Math.round(performance.now() - t0);
      entry.lastError = null;
    } catch (err) {
      entry.lastError = String(err?.message || err);
    } finally {
      entry.connecting = false;
      this.tick();
    }
  }

  /** Reconnect relays that nostr-tools gave up on (first connection failed). */
  retry() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    for (const entry of this.relays.values()) if (!entry.relay.connected) this.connect(entry);
  }

  tick() {
    let changed = false;
    for (const [url, entry] of this.relays) {
      const open = entry.relay.connected;
      if (open !== entry.open) {
        entry.open = open;
        changed = true;
        if (open) {
          for (const sub of this.subs) this.attach(sub, entry); // subscriptions the relay missed while it was down
          for (const fn of this.connectListeners) fn(url);
        }
      }
    }
    if (changed) this.emitStatus();
  }

  status() {
    const list = [...this.relays].map(([url, e]) => ({ url, open: e.open, latency: e.latency, error: e.lastError, publishError: e.publishError, publishErrorAt: e.publishErrorAt, lastOkAt: e.lastOkAt }));
    return { relays: list, total: list.length, connected: list.filter((r) => r.open).length };
  }

  get online() {
    return [...this.relays.values()].some((e) => e.open);
  }

  emitStatus() {
    const s = this.status();
    for (const fn of this.statusListeners) fn(s);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status());
    return () => this.statusListeners.delete(fn);
  }

  /** Called with the url every time a relay (re)connects. */
  onConnect(fn) {
    this.connectListeners.add(fn);
    return () => this.connectListeners.delete(fn);
  }

  /**
   * Subscribe on every relay; each event is delivered once. `oneose(url)`
   * fires per relay as it finishes its stored events.
   */
  subscribe(filters, { onevent, oneose } = {}) {
    const sub = { filters, onevent, oneose, seen: new Set(), handles: new Map(), closed: false };
    this.subs.add(sub);
    for (const entry of this.relays.values()) this.attach(sub, entry);
    return {
      close: () => {
        sub.closed = true;
        this.subs.delete(sub);
        for (const h of sub.handles.values()) h.close();
      },
    };
  }

  attach(sub, entry) {
    // Only live connections take a REQ; tick() attaches the rest as relays come up.
    if (sub.closed || sub.handles.has(entry.relay.url) || !entry.relay.connected) return;
    let handle;
    try {
      handle = entry.relay.subscribe(sub.filters, {
        onevent: (event) => {
          if (sub.seen.has(event.id)) return;
          sub.seen.add(event.id);
          if (sub.seen.size > SEEN_MAX) sub.seen.delete(sub.seen.values().next().value);
          sub.onevent?.(event);
        },
        oneose: () => sub.oneose?.(entry.relay.url),
        onclose: () => sub.handles.delete(entry.relay.url),
      });
    } catch {
      return; // the connection dropped between the check and the send; tick() tries again when it is back
    }
    sub.handles.set(entry.relay.url, handle);
  }

  /** Fetch matching events once from every relay (until EOSE or timeout). */
  async fetch(filters, { ms = 6000, until = null } = {}) {
    const events = new Map();
    const open = this.urls.filter((u) => this.relays.get(u).open);
    if (!open.length) return [];
    await new Promise((resolve) => {
      let waiting = open.length;
      const sub = this.subscribe(filters, {
        onevent: (e) => {
          events.set(e.id, e);
          if (until && until([...events.values()])) finish(); // enough: don't wait for slower relays
        },
        oneose: () => --waiting <= 0 && finish(),
      });
      const t = setTimeout(finish, ms);
      function finish() {
        clearTimeout(t);
        sub.close();
        resolve();
      }
    });
    return [...events.values()];
  }

  /** What one relay holds for these filters (until its EOSE or `ms`). Rejects when the relay is not connected. */
  fetchFrom(url, filters, { ms = 8000 } = {}) {
    const entry = this.relays.get(url);
    if (!entry?.relay.connected) return Promise.reject(new Error('offline'));
    return new Promise((resolve, reject) => {
      const events = [];
      let sub;
      const t = setTimeout(() => finish(), ms);
      const finish = () => {
        clearTimeout(t);
        try {
          sub?.close();
        } catch {
          /* closed already */
        }
        resolve(events);
      };
      try {
        sub = entry.relay.subscribe(filters, { onevent: (e) => events.push(e), oneose: finish, onclose: finish });
      } catch (err) {
        clearTimeout(t);
        reject(err);
      }
    });
  }

  /** Remember the last answer a relay gave to a publish, for the settings screen. */
  notePublish(url, error) {
    const entry = this.relays.get(url);
    if (!entry) return;
    if (error) {
      entry.publishError = error;
      entry.publishErrorAt = Date.now();
    } else {
      entry.publishError = null;
      entry.lastOkAt = Date.now();
    }
    this.emitStatus();
  }

  /** Publish to one relay. Resolves on OK; rejects with the relay's reason or a network error. */
  publishTo(url, event) {
    const entry = this.relays.get(url);
    if (!entry) return Promise.reject(new Error('unknown relay'));
    if (!entry.relay.connected) return Promise.reject(new Error('offline'));
    return timeout(entry.relay.publish(event), 10_000, 'publish timed out');
  }

  /**
   * Publish to every relay. `onResult(url, { ok, error, permanent })` fires per
   * relay as answers arrive; the promise resolves with the summary once every
   * relay answered or timed out.
   * @returns {Promise<{ok: string[], failed: {url: string, error: string, permanent: boolean}[]}>}
   */
  async publish(event, { onResult = null } = {}) {
    const ok = [];
    const failed = [];
    await Promise.all(
      this.urls.map((url) =>
        this.publishTo(url, event).then(
          () => {
            ok.push(url);
            this.notePublish(url, null);
            onResult?.(url, { ok: true });
          },
          (reason) => {
            const error = String(reason?.message || reason);
            // "blocked:" / "invalid:" / "restricted:" are the relay's final answer; everything else is worth retrying.
            const permanent = isPermanent(error);
            failed.push({ url, error, permanent });
            if (error !== 'offline') this.notePublish(url, error);
            onResult?.(url, { ok: false, error, permanent });
          },
        ),
      ),
    );
    return { ok, failed };
  }

  /** NIP-11 information document, cached for a day. */
  async info(url) {
    const key = `wjs.nip11.${url}`;
    const cached = store.get(key);
    if (cached && Date.now() - cached.at < 86_400_000) return cached.info;
    try {
      const info = await timeout(fetchRelayInformation(url), 6000, 'no answer');
      const slim = { name: info.name, description: info.description, countries: info.relay_countries || [], software: info.software, limitation: info.limitation || {}, contact: info.contact };
      store.set(key, { at: Date.now(), info: slim });
      return slim;
    } catch {
      return null;
    }
  }

  close() {
    clearInterval(this.timer);
    clearInterval(this.retryTimer);
    for (const url of this.urls) this.remove(url);
  }
}
