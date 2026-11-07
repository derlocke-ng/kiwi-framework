// The device's copy of every event it has seen or written, in IndexedDB.
// Apps read from here first (so they work offline and start instantly) and
// relays only fill it up. The same copy is what gets re-published when relays
// forget, and what goes into backups.

import { matchFilters } from './nostr.mjs';
import { addressOf, supersedes, isEphemeralKind, observe } from './events.js';

const DB_VERSION = 3;

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Entries record who accepted them; older ones don't, so for those "waiting for every relay" is the sign that nothing left this device. */
const unsynced = (o, relayCount) => (o.acked ? o.acked.length === 0 : o.pending.length >= relayCount);

export class LocalStore {
  constructor(db) {
    this.db = db;
    this.listeners = new Set();
  }

  static open(name = 'wjs') {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = (e) => {
        const db = r.result;
        if (e.oldVersion < 1) {
          const events = db.createObjectStore('events', { keyPath: 'id' });
          events.createIndex('pubkey', 'pubkey');
          events.createIndex('address', 'address');
          events.createIndex('kind', 'kind');
          db.createObjectStore('outbox', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'k' });
        }
        if (e.oldVersion < 2) {
          // Private messages once unwrapped: the gift wraps stay in `events` (synced, backed up,
          // healed); this is what the chat reads, by conversation, without unwrapping again.
          const chat = db.createObjectStore('chat', { keyPath: 'id' });
          chat.createIndex('conv', 'conv');
          chat.createIndex('convAt', ['conv', 'at']);
        }
        if (e.oldVersion < 3) {
          // Which network an event belongs to (the hub's relays, or the public ones): what was published or
          // received on one network is never healed onto the other. An event without an entry is the hub's.
          db.createObjectStore('nets', { keyPath: 'id' });
        }
      };
      r.onsuccess = () => resolve(new LocalStore(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Database is open in another tab with an older version'));
    });
  }

  tx(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  /**
   * The same store seen from one network: what is written through it is marked as that network's, and
   * what is read (query, byAuthor, the change feed) is that network's alone. Listeners are shared.
   * @param {string} network  'hub' or 'public'
   */
  scope(network) {
    const base = this;
    const scoped = Object.create(base);
    scoped.network = network;
    scoped.base = base;
    scoped.put = (event) => base.put(event, network);
    scoped.query = (filters) => base.query(filters, network);
    scoped.byAuthor = (pubkey) => base.byAuthor(pubkey, network);
    scoped.subscribe = (fn) => base.subscribe((event, net) => (net || 'hub') === network && fn(event, net));
    scoped.scope = (n) => base.scope(n);
    scoped.all = () => base.all();
    return scoped;
  }

  /** event id -> network, for every event that has one. */
  async netMap() {
    return new Map((await req(this.tx('nets').getAll())).map((r) => [r.id, r.net]));
  }

  /** The network an event belongs to: the hub's unless recorded otherwise. */
  async netOf(id) {
    return (await req(this.tx('nets').get(id)))?.net || 'hub';
  }

  // ---- events ----

  /**
   * Store an event unless something newer at its address is already here.
   * @returns {Promise<'stored'|'ignored'>}
   */
  async put(event, network = null) {
    if (isEphemeralKind(event.kind)) return 'ignored';
    observe(event); // even when it is older than ours: our next write must beat every version anyone has
    const address = addressOf(event);
    const os = this.tx('events', 'readwrite');
    let replaced = null;
    if (address) {
      const current = await req(os.index('address').get(address));
      if (current && !supersedes(event, current.event)) return 'ignored';
      if (current) {
        await req(os.delete(current.id));
        replaced = current.id;
      }
    } else if (await req(os.getKey(event.id))) {
      return 'ignored';
    }
    await req(os.put({ id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at, ...(address ? { address } : {}), event }));
    // the nets table after the events transaction is done: a request on another store in between would let it commit early
    if (replaced) await req(this.tx('nets', 'readwrite').delete(replaced));
    if (network && network !== 'hub') await req(this.tx('nets', 'readwrite').put({ id: event.id, net: network }));
    for (const fn of this.listeners) fn(event, network || 'hub');
    return 'stored';
  }

  async get(id) {
    const event = (await req(this.tx('events').get(id)))?.event ?? null;
    observe(event);
    return event;
  }

  async getByAddress(kind, pubkey, d = '') {
    const event = (await req(this.tx('events').index('address').get(`${kind}:${pubkey}:${d}`)))?.event ?? null;
    observe(event);
    return event;
  }

  /** Events matching nostr filters, newest first. */
  async query(filters, network = null) {
    const list = Array.isArray(filters) ? filters : [filters];
    const authors = list.every((f) => f.authors?.length) ? [...new Set(list.flatMap((f) => f.authors))] : null;
    const os = this.tx('events');
    let rows = authors ? (await Promise.all(authors.map((pk) => req(os.index('pubkey').getAll(pk))))).flat() : await req(os.getAll());
    if (network) rows = await this.onNetwork(rows, network);
    const events = rows
      .map((r) => r.event)
      .filter((e) => matchFilters(list, e))
      .sort((a, b) => b.created_at - a.created_at);
    for (const e of events) observe(e); // what an app shows is what its next edit must supersede
    return events;
  }

  async byAuthor(pubkey, network = null) {
    let rows = await req(this.tx('events').index('pubkey').getAll(pubkey));
    if (network) rows = await this.onNetwork(rows, network);
    return rows.map((r) => r.event);
  }

  /** The rows among `rows` that belong to `network` (one lookup of the nets table, not one per row). */
  async onNetwork(rows, network) {
    if (!rows.length) return rows;
    const nets = network === 'hub' && rows.length < 8 ? null : await this.netMap();
    const netOf = async (id) => (nets ? nets.get(id) : (await req(this.tx('nets').get(id)))?.net) || 'hub';
    const out = [];
    for (const r of rows) if ((await netOf(r.id)) === network) out.push(r);
    return out;
  }

  async remove(id) {
    await req(this.tx('events', 'readwrite').delete(id));
    await req(this.tx('nets', 'readwrite').delete(id));
  }

  async removeByAuthor(pubkey) {
    const os = this.tx('events', 'readwrite');
    const ids = await req(os.index('pubkey').getAllKeys(pubkey));
    for (const id of ids) await req(os.delete(id));
    const nets = this.tx('nets', 'readwrite');
    for (const id of ids) await req(nets.delete(id));
  }

  /** Called with every event that was stored (local writes and relay arrivals alike). */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Every event this device holds (backups). */
  async all() {
    return (await req(this.tx('events').getAll())).map((r) => r.event);
  }

  // ---- outbox: which relays still need an event ----

  async setPending(id, urls) {
    if (!urls.length) return;
    const os = this.tx('outbox', 'readwrite');
    const cur = await req(os.get(id));
    const acked = cur?.acked || [];
    const pending = [...new Set([...(cur?.pending || []), ...urls])].filter((u) => !acked.includes(u));
    await req(os.put({ id, pending, acked, since: cur?.since || Date.now() }));
  }

  /** A relay accepted the event (or refused it for good): it no longer waits for that relay. */
  async ack(id, url, { accepted = true } = {}) {
    const os = this.tx('outbox', 'readwrite');
    const cur = await req(os.get(id));
    if (!cur) return;
    const pending = cur.pending.filter((u) => u !== url);
    const acked = accepted && !(cur.acked || []).includes(url) ? [...(cur.acked || []), url] : cur.acked || [];
    if (pending.length) await req(os.put({ ...cur, pending, acked }));
    else await req(os.delete(id));
  }

  async pendingFor(url) {
    return (await req(this.tx('outbox').getAll())).filter((o) => o.pending.includes(url)).map((o) => o.id);
  }

  /**
   * Events no relay has accepted yet: what "to sync" means to a person. An
   * entry still waiting for every one of the `relayCount` configured relays
   * never left this device; one that some relay already took is only
   * waiting for the slow ones (entries from before acceptance was recorded
   * have no `acked` list, so the pending count is what tells them apart).
   */
  async pendingCount(relayCount = Infinity) {
    return (await req(this.tx('outbox').getAll())).filter((o) => unsynced(o, relayCount)).length;
  }

  /** { unsynced, total, waiting: { url: count } } for the settings screen. */
  async outboxSummary(relayCount = Infinity) {
    const all = await req(this.tx('outbox').getAll());
    const waiting = {};
    for (const o of all) for (const u of o.pending) waiting[u] = (waiting[u] || 0) + 1;
    return { unsynced: all.filter((o) => unsynced(o, relayCount)).length, total: all.length, waiting };
  }

  /** Relays that left the list take their outbox entries with them. */
  async pruneOutbox(urls) {
    const os = this.tx('outbox', 'readwrite');
    for (const o of await req(os.getAll())) {
      const pending = o.pending.filter((u) => urls.includes(u));
      if (pending.length === o.pending.length) continue;
      if (pending.length) await req(os.put({ ...o, pending }));
      else await req(os.delete(o.id));
    }
  }

  async clearOutbox() {
    await req(this.tx('outbox', 'readwrite').clear());
  }

  // ---- meta ----

  async getMeta(k, fallback = null) {
    return (await req(this.tx('meta').get(k)))?.v ?? fallback;
  }

  async setMeta(k, v) {
    await req(this.tx('meta', 'readwrite').put({ k, v }));
  }

  /** Forget everything (sign-out, wipe). */
  async clear() {
    for (const name of ['events', 'outbox', 'meta', 'chat', 'nets']) await req(this.tx(name, 'readwrite').clear());
  }

  // ---- chat: unwrapped private messages, by conversation ----

  /** @param {{ id: string, conv: string, from: string, at: number, text: string, wrap: string, [k: string]: any }} message */
  async putMessage(message) {
    await req(this.tx('chat', 'readwrite').put(message));
    for (const fn of this.chatListeners || []) fn(message);
  }

  async hasMessage(id) {
    return Boolean(await req(this.tx('chat').get(id)));
  }

  /** The newest `limit` messages of a conversation before `before` (a time), oldest first; within one second by the writers' milliseconds, then as this device took them. */
  messages(conv, { before = Infinity, limit = 50 } = {}) {
    return new Promise((resolve, reject) => {
      const out = [];
      const range = IDBKeyRange.bound([conv, 0], [conv, before], false, true);
      const r = this.tx('chat').index('convAt').openCursor(range, 'prev');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c || out.length >= limit) return resolve(out.sort((a, b) => (a.t || a.at * 1000) - (b.t || b.at * 1000) || (a.seq || 0) - (b.seq || 0) || (a.id < b.id ? -1 : 1)));
        out.push(c.value);
        c.continue();
      };
    });
  }

  /** Every conversation with its newest message, newest first. */
  conversations() {
    return new Promise((resolve, reject) => {
      const seen = new Map();
      const r = this.tx('chat').index('convAt').openCursor(null, 'prev');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve([...seen.values()].sort((a, b) => b.at - a.at));
        if (!seen.has(c.value.conv)) seen.set(c.value.conv, c.value);
        c.continue();
      };
    });
  }

  async removeConversation(conv) {
    const os = this.tx('chat', 'readwrite');
    const keys = await req(os.index('conv').getAllKeys(conv));
    for (const k of keys) await req(os.delete(k));
  }

  /** Called with every message put, from this page or another. */
  subscribeChat(fn) {
    this.chatListeners ||= new Set();
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  close() {
    this.db.close();
  }
}
