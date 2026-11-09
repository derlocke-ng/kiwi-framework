// A pool of nostr relays. nostr-tools' Relay keeps a connection alive and
// re-sends open subscriptions after a drop; this adds retries for relays that
// were down when we started, a status feed for the UI, de-duplication across
// relays, per-relay publishing for the outbox, and NIP-11 info with caching.
//
// Relays belong to named networks: `hub`, the hub's own relays (inside a
// company's VPN for a private hub), and `public`, relays anyone reaches, for
// a semi-public hub's public area. A subscription, a fetch or a publish names
// its network and touches only that network's relays; pool.scope(network) is
// the pool seen from one network, which is what an app gets as its `net.pool`.
//
// Guests are relays outside the hub's networks, reached for one purpose only:
// a link's hint (where a board or group from another hub lives), someone's
// inbox (where they read sealed notes). A guest connection carries the one
// subscription or event it was opened for, never the pool's own, and closes
// when nothing uses it.

import { Relay, fetchRelayInformation } from './nostr.mjs';
import { DISTRIBUTION } from './distribution.js';
import { spaceNetworks } from './spaces.js';
import { store, timeout } from './util.js';

export const RELAYS_KEY = 'wjs.relays';

/** The hub's own relays as the distribution (and the host's hub.local.json, shared/hubconfig.js) name them. */
export const defaultRelays = () => DISTRIBUTION.relays.map(normalizeRelayUrl).filter(Boolean);

const RETRY_EVERY = 15_000;
const CONNECT_TIMEOUT = 8000;
const SEEN_MAX = 4000;
const STALE_AFTER = 15_000; // hidden this long, a phone may have cut the sockets without telling us: renew them on return
const GUEST_IDLE = 60_000; // a guest relay nothing uses any more is closed after this
const GUEST_RETRY = [5_000, 15_000, 45_000]; // a guest that did not connect or answer is tried again, then given up

export const normalizeRelayUrl = (input) => {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^wss?:\/\//i.test(s)) return null; // another scheme (https://…) is not a relay
  if (!/^wss?:\/\//i.test(s)) s = (/^(localhost|127\.0\.0\.1)(:|$)/.test(s) ? 'ws://' : 'wss://') + s;
  try {
    const u = new URL(s);
    if (!/^wss?:$/.test(u.protocol)) return null;
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
};

/** A hub whose relays a person may not replace (a private hub: its relays are the company's). */
export const relaysLocked = () => DISTRIBUTION.policy?.relays === 'locked';

/** The hub's relays: the person's own list, unless the hub locks its relays. */
export function savedRelays() {
  if (relaysLocked()) return defaultRelays();
  const saved = store.get(RELAYS_KEY);
  return Array.isArray(saved) && saved.length ? saved : defaultRelays();
}

/** The relays of the public area, the distribution's (or the host's) choice; a person cannot change them. */
export const publicRelays = () => /** @type {string[]} */ ((DISTRIBUTION.publicRelays || []).map(normalizeRelayUrl).filter(Boolean));

/**
 * Every network this hub has, with its relays: `hub` always, `public` when public relays are named, and
 * `space:<id>` for each space with relays of its own (shared/spaces.js); those are fixed by the space.
 */
export function savedNetworks() {
  const pub = publicRelays();
  const spaces = Object.fromEntries(Object.entries(spaceNetworks()).map(([n, urls]) => [n, urls.map(normalizeRelayUrl).filter(Boolean)]));
  return { hub: savedRelays(), ...(pub.length ? { public: pub } : {}), ...spaces };
}

export function saveRelays(list) {
  const clean = [...new Set(list.map(normalizeRelayUrl).filter(Boolean))];
  if (!clean.length || clean.join() === defaultRelays().join()) store.remove(RELAYS_KEY);
  else store.set(RELAYS_KEY, clean);
  return clean;
}

/** A relay's final no: retrying would not help. */
export const isPermanent = (error) => /^(blocked|invalid|restricted|error: unknown)/.test(String(error || ''));

export class RelayPool {
  /** @param {Record<string, string[]> | string[]} networks  network -> relays; a plain list is the hub's network alone */
  constructor(networks = savedNetworks()) {
    this.networks = {}; // network -> [url]
    this.relays = new Map(); // url -> { relay, open, latency, connecting, lastError, networks: Set }
    this.statusListeners = new Set();
    this.connectListeners = new Set();
    this.subs = new Set();
    this.guests = new Map(); // url -> { relay, users, idle }
    // NIP-42: who signs a relay's challenge (the person's key, set by the runtime), and the networks whose relays
    // are answered as soon as they ask (a hub with locked relays: its relay may let only its members write)
    this.authSigner = null;
    this.eagerAuth = new Set();
    for (const [network, urls] of Object.entries(Array.isArray(networks) ? { hub: networks } : networks)) {
      this.networks[network] = [];
      for (const url of urls) this.add(url, network);
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.retryTimer = setInterval(() => this.retry(), RETRY_EVERY);
    this.hiddenAt = 0;
    if (typeof addEventListener === 'function') {
      addEventListener('online', () => this.wake());
      // "Back" can show the page as it was, from the browser's back/forward cache, as an app does; the browser
      // closed its sockets while it was put away. Shown again, every relay is connected anew at once, rather
      // than after a ping finds a socket dead or a back-off runs out. (Closing them ourselves on pagehide would
      // get the page thrown out of the cache: their close events arrive after it is frozen.)
      addEventListener('pageshow', (e) => (/** @type {PageTransitionEvent} */ (e).persisted ? this.resume() : this.wake()));
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this.hiddenAt = Date.now();
          else this.wake();
        });
      }
    }
  }

  get urls() {
    return [...this.relays.keys()];
  }

  /** The relays of one network (every relay when none is named). */
  urlsOf(network = null) {
    return network ? [...(this.networks[network] || [])] : this.urls;
  }

  /** The networks a relay serves (by our URL or nostr-tools', which ends in a slash). */
  networksOf(url) {
    const entry = this.relays.get(url) || this.relays.get(String(url).replace(/\/$/, ''));
    return [...(entry?.networks || [])];
  }

  /** The network a relay is counted on: the hub's when it serves both. */
  networkOf(url) {
    const nets = this.networksOf(url);
    return nets.includes('hub') ? 'hub' : nets[0] || null;
  }

  add(url, network = 'hub') {
    if (!this.networks[network]) this.networks[network] = [];
    if (!this.networks[network].includes(url)) this.networks[network].push(url);
    const have = this.relays.get(url);
    if (have) {
      have.networks.add(network);
      this.wireAuth(have);
      for (const sub of this.subs) this.attach(sub, have); // a subscription of this network may have skipped the relay
      return;
    }
    const relay = new Relay(url, { enablePing: true, enableReconnect: true });
    relay.onnotice = (msg) => console.info(`${url}: ${msg}`);
    // tried: a first connection attempt has finished (until then the page says it is connecting, not offline)
    const entry = { url, relay, open: false, latency: null, connecting: false, tried: false, lastError: null, publishError: null, publishErrorAt: 0, lastOkAt: 0, networks: new Set([network]) };
    this.relays.set(url, entry);
    this.wireAuth(entry);
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
    for (const list of Object.values(this.networks)) {
      const i = list.indexOf(url);
      if (i >= 0) list.splice(i, 1);
    }
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
      entry.tried = true;
      this.tick();
    }
  }

  /** Reconnect relays that nostr-tools gave up on (first connection failed). */
  retry() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    for (const entry of this.relays.values()) if (!entry.relay.connected) this.connect(entry);
  }

  /**
   * Back in the foreground, or back on the network: relays that dropped get a connection now, not after
   * nostr-tools' back-off, and after a long absence every connection is renewed, since a socket the phone
   * cut can still look open until a ping fails a minute later. Subscriptions follow on the new connections.
   */
  wake() {
    const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    for (const entry of this.relays.values()) {
      if (entry.relay.connected && away < STALE_AFTER) continue;
      if (entry.relay.connected) this.renew(entry);
      else this.connect(entry);
    }
  }

  /** Shown again from the back/forward cache: a fresh connection to every relay, now; the page says it is connecting meanwhile. */
  resume() {
    this.hiddenAt = 0;
    for (const entry of this.relays.values()) entry.tried = false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.tick();
    for (const entry of this.relays.values()) {
      if (entry.relay.connected) this.renew(entry);
      else this.connect(entry);
    }
  }

  /**
   * The key that answers relays' NIP-42 challenges (null: nobody answers), and the networks whose relays are
   * answered as soon as they ask. Elsewhere a relay learns the key only when it refuses something without it.
   * @param {((template: any) => any) | null} signer  signs a kind 22242 template with the person's key
   * @param {string[]} [eager]
   */
  setAuth(signer, eager = []) {
    this.authSigner = signer;
    this.eagerAuth = new Set(eager);
    for (const entry of this.relays.values()) this.wireAuth(entry);
  }

  /**
   * nostr-tools answers a challenge by itself when the relay has `onauth`: only relays of an eager network get it.
   * (An onauth that refuses would leave nostr-tools' auth promise pending for the rest of the connection.)
   */
  wireAuth(entry) {
    const eager = Boolean(this.authSigner) && [...entry.networks].some((n) => this.eagerAuth.has(n));
    entry.relay.onauth = eager ? (template) => this.answerAuth(entry.url, template) : undefined;
  }

  /**
   * Sign a relay's challenge; once the relay has said yes, what it refused before goes out again. The relay tag
   * names the relay as the hub does (no trailing slash): strfry compares it with its serviceUrl character for
   * character, and nostr-tools' own URL ends in a slash.
   */
  answerAuth(url, template) {
    const entry = this.relays.get(url);
    if (!this.authSigner || !entry) throw new Error('no key to answer with');
    template = { ...template, tags: (template.tags || []).map((t) => (t[0] === 'relay' ? ['relay', entry.url] : t)) };
    // once the relay has said yes, what it refused before goes out again (the outbox flushes on "connect")
    setTimeout(() => {
      entry.relay.authPromise
        ?.then(() => {
          for (const fn of this.connectListeners) fn(url);
        })
        .catch(() => {});
    }, 0);
    const signed = this.authSigner(template);
    // which key this connection proved: a sign-in later needs a fresh connection (reauthenticate)
    Promise.resolve(signed)
      .then((ev) => {
        entry.authedAs = ev?.pubkey || null;
      })
      .catch(() => {});
    return signed;
  }

  /**
   * The person changed (a sign-in, a sign-out, a key imported): a connection that proved another key would go
   * on writing as that one (a relay takes one answer per connection), so it is made anew and proves the new key
   * when the relay asks again.
   * @param {string} pk  the key now signed in
   */
  reauthenticate(pk) {
    for (const entry of this.relays.values()) {
      if (!entry.authedAs || entry.authedAs === pk) continue;
      entry.authedAs = null;
      if (entry.relay.connected) this.renew(entry);
    }
  }

  /** Answer a relay's challenge now (it refused a write or a read with "auth-required:"). Resolves true once it accepted. */
  async authenticate(url) {
    const entry = this.relays.get(url) || this.relays.get(String(url).replace(/\/$/, ''));
    if (!entry || !this.authSigner || !entry.relay.challenge) return false;
    try {
      await entry.relay.auth((template) => this.answerAuth(entry.url, template));
      return true;
    } catch {
      return false;
    }
  }

  /** A fresh connection to a relay whose socket we no longer trust; its subscriptions are sent again once it is up. */
  renew(entry) {
    try {
      entry.relay.close(); // tells our subscriptions, which forget this relay and take a new REQ on reconnect
    } catch {
      /* already closed */
    }
    entry.connecting = false;
    this.tick();
    // nostr-tools' close() sends each subscription's CLOSE on the old connection's promise, a microtask later and to
    // whatever socket the relay has by then: connecting first would hand them to the new socket while it is still
    // connecting (an InvalidStateError). They go first, to the old one, which drops them.
    queueMicrotask(() => this.connect(entry));
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

  /** The relays' state, of one network or of all. */
  status(network = null) {
    const list = [...this.relays]
      .filter(([, e]) => !network || e.networks.has(network))
      .map(([url, e]) => ({ url, open: e.open, pending: !e.open && !e.tried, latency: e.latency, error: e.lastError, publishError: e.publishError, publishErrorAt: e.publishErrorAt, lastOkAt: e.lastOkAt, networks: [...e.networks] }));
    // connecting: relays whose first attempt (since the page started, or came back) has not finished yet
    return { network, relays: list, total: list.length, connected: list.filter((r) => r.open).length, connecting: list.filter((r) => r.pending).length };
  }

  get online() {
    return [...this.relays.values()].some((e) => e.open);
  }

  /** Is any relay of this network connected? */
  onlineOf(network) {
    return [...this.relays.values()].some((e) => e.open && e.networks.has(network));
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
   * Subscribe on every relay of `network` (every relay when none is named); each event is delivered
   * once, as `onevent(event, url)`. `oneose(url)` fires per relay as it finishes its stored events.
   */
  subscribe(filters, { onevent, oneose, network = null } = {}) {
    const sub = { filters, onevent, oneose, network, seen: new Set(), handles: new Map(), closed: false };
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
    // Only live connections of the subscription's network take a REQ; tick() attaches the rest as relays come up.
    if (sub.closed || sub.handles.has(entry.relay.url) || !entry.relay.connected) return;
    if (sub.network && !entry.networks.has(sub.network)) return;
    let handle;
    try {
      handle = entry.relay.subscribe(sub.filters, {
        onevent: (event) => {
          if (sub.seen.has(event.id)) return;
          sub.seen.add(event.id);
          if (sub.seen.size > SEEN_MAX) sub.seen.delete(sub.seen.values().next().value);
          sub.onevent?.(event, entry.url);
        },
        oneose: () => sub.oneose?.(entry.url),
        onclose: (reason) => {
          sub.handles.delete(entry.relay.url);
          // a relay that reads to members only: say who we are, then ask again
          if (/^auth-required/.test(String(reason || '')))
            this.authenticate(entry.url)
              .then((ok) => ok && this.attach(sub, entry))
              .catch(() => {});
        },
      });
    } catch {
      return; // the connection dropped between the check and the send; tick() tries again when it is back
    }
    sub.handles.set(entry.relay.url, handle);
  }

  /** Fetch matching events once from every relay of `network` (until EOSE or timeout). */
  async fetch(filters, { ms = 6000, until = null, network = null } = {}) {
    const events = new Map();
    const open = this.urlsOf(network).filter((u) => this.relays.get(u).open);
    if (!open.length) return [];
    await new Promise((resolve) => {
      let waiting = open.length;
      const sub = this.subscribe(filters, {
        network,
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
   * Publish to every relay of `network` (every relay when none is named). `onResult(url, { ok, error,
   * permanent })` fires per relay as answers arrive; the promise resolves with the summary once every
   * relay answered or timed out.
   * @returns {Promise<{ok: string[], failed: {url: string, error: string, permanent: boolean}[]}>}
   */
  async publish(event, { onResult = null, network = null } = {}) {
    const ok = [];
    const failed = [];
    await Promise.all(
      this.urlsOf(network).map((url) =>
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
            // the relay wants to know who writes (NIP-42): say so; the outbox sends it again once the relay knows
            if (/^auth-required/.test(error)) this.authenticate(url).catch(() => {});
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
    for (const g of this.guests.values()) {
      clearTimeout(g.idle);
      try {
        g.relay.close();
      } catch {
        /* closed */
      }
    }
    this.guests.clear();
  }

  // ---- guests: relays outside the networks, for one subscription or event at a time ----

  /** The relays among `urls` that are guests: not one of the pool's own, normalized, at most `max`. */
  guestUrls(urls, max = 4) {
    const out = [];
    for (const u of urls || []) {
      const url = normalizeRelayUrl(u);
      if (url && !this.relays.has(url) && !out.includes(url)) out.push(url);
    }
    return out.slice(0, max);
  }

  /** A connected guest relay, or a rejection; `users` keeps it open, `release` lets it close when idle. */
  async useGuest(url) {
    let g = this.guests.get(url);
    if (!g) {
      g = { relay: new Relay(url, { enablePing: true, enableReconnect: true }), users: 0, idle: null };
      g.relay.onnotice = (msg) => console.info(`${url}: ${msg}`);
      this.guests.set(url, g);
    }
    g.users++;
    clearTimeout(g.idle);
    if (!g.relay.connected) {
      try {
        await g.relay.connect({ timeout: CONNECT_TIMEOUT });
      } catch (err) {
        this.releaseGuest(url);
        throw err;
      }
    }
    return g.relay;
  }

  releaseGuest(url) {
    const g = this.guests.get(url);
    if (!g) return;
    g.users = Math.max(0, g.users - 1);
    if (g.users) return;
    clearTimeout(g.idle);
    g.idle = setTimeout(() => {
      if (g.users) return;
      this.guests.delete(url);
      try {
        g.relay.close();
      } catch {
        /* closed */
      }
    }, GUEST_IDLE);
  }

  /**
   * Subscribe on guest relays (a link's hints): each gets this subscription alone, and is tried again a few
   * times when it does not connect. Events come once, as `onevent(event, url)`.
   */
  subscribeAt(urls, filters, { onevent } = {}) {
    const seen = new Set();
    const handles = [];
    const held = [];
    let closed = false;
    for (const url of this.guestUrls(urls)) {
      const attempt = async (n) => {
        if (closed) return;
        try {
          const relay = await this.useGuest(url);
          if (closed) return this.releaseGuest(url);
          held.push(url);
          handles.push(
            relay.subscribe(filters, {
              onevent: (event) => {
                if (seen.has(event.id)) return;
                seen.add(event.id);
                if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
                onevent?.(event, url);
              },
            }),
          );
        } catch {
          if (n < GUEST_RETRY.length) setTimeout(() => attempt(n + 1), GUEST_RETRY[n]);
        }
      };
      attempt(0);
    }
    return {
      close: () => {
        closed = true;
        for (const h of handles) {
          try {
            h.close();
          } catch {
            /* closed */
          }
        }
        for (const url of held.splice(0)) this.releaseGuest(url);
      },
    };
  }

  /** Publish to guest relays (someone's inbox, a link's hints), each tried again a few times; resolves with those that took it. */
  async publishAt(urls, event) {
    const ok = [];
    await Promise.all(
      this.guestUrls(urls).map(async (url) => {
        for (let n = 0; n <= GUEST_RETRY.length; n++) {
          try {
            const relay = await this.useGuest(url);
            try {
              await timeout(relay.publish(event), 10_000, 'publish timed out');
              ok.push(url);
              return;
            } finally {
              this.releaseGuest(url);
            }
          } catch (err) {
            if (isPermanent(String(err?.message || err)) || n === GUEST_RETRY.length) return;
            await new Promise((r) => setTimeout(r, GUEST_RETRY[n]));
          }
        }
      }),
    );
    return ok;
  }

  /** Events matching `filters` on guest relays (a directory, someone's relays), until each answers or `ms` passes. */
  async fetchAt(urls, filters, { ms = 5000 } = {}) {
    const events = new Map();
    await Promise.all(
      this.guestUrls(urls).map(async (url) => {
        let relay;
        try {
          relay = await this.useGuest(url);
        } catch {
          return;
        }
        await new Promise((resolve) => {
          let sub;
          const done = () => {
            clearTimeout(t);
            try {
              sub?.close();
            } catch {
              /* closed */
            }
            resolve();
          };
          const t = setTimeout(done, ms);
          try {
            sub = relay.subscribe(filters, { onevent: (e) => events.set(e.id, e), oneose: done, onclose: done });
          } catch {
            done();
          }
        });
        this.releaseGuest(url);
      }),
    );
    return [...events.values()];
  }

  /** This pool seen from one network: what an app on that network gets as its `net.pool`. */
  scope(network) {
    return new ScopedPool(this, network);
  }
}

/**
 * One network's view of the pool: the same connections, but subscriptions, fetches, publishes, the
 * status and the relay list are that network's alone. `all` is the whole pool, for the inbox, which
 * listens on every network a hub has.
 */
export class ScopedPool {
  constructor(pool, network) {
    this.all = pool;
    this.network = network;
  }
  get urls() {
    return this.all.urlsOf(this.network);
  }
  get relays() {
    return new Map([...this.all.relays].filter(([, e]) => e.networks.has(this.network)));
  }
  get online() {
    return this.all.onlineOf(this.network);
  }
  urlsOf(network = this.network) {
    return this.all.urlsOf(network);
  }
  networksOf(url) {
    return this.all.networksOf(url);
  }
  networkOf(url) {
    return this.all.networkOf(url);
  }
  onlineOf(network) {
    return this.all.onlineOf(network);
  }
  status() {
    return this.all.status(this.network);
  }
  onStatus(fn) {
    return this.all.onStatus(() => fn(this.status()));
  }
  onConnect(fn) {
    return this.all.onConnect((url) => this.all.networksOf(url).includes(this.network) && fn(url));
  }
  subscribe(filters, options = {}) {
    return this.all.subscribe(filters, { ...options, network: this.network });
  }
  fetch(filters, options = {}) {
    return this.all.fetch(filters, { ...options, network: this.network });
  }
  fetchFrom(url, filters, options) {
    return this.all.fetchFrom(url, filters, options);
  }
  publish(event, options = {}) {
    return this.all.publish(event, { ...options, network: this.network });
  }
  publishTo(url, event) {
    return this.all.publishTo(url, event);
  }
  notePublish(url, error) {
    return this.all.notePublish(url, error);
  }
  info(url) {
    return this.all.info(url);
  }
  scope(network) {
    return this.all.scope(network);
  }
  guestUrls(urls, max) {
    return this.all.guestUrls(urls, max);
  }
  subscribeAt(urls, filters, options) {
    return this.all.subscribeAt(urls, filters, options);
  }
  publishAt(urls, event) {
    return this.all.publishAt(urls, event);
  }
  fetchAt(urls, filters, options) {
    return this.all.fetchAt(urls, filters, options);
  }
  wake() {
    return this.all.wake();
  }
  retry() {
    return this.all.retry();
  }
}
