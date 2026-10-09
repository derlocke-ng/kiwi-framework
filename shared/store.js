// The device's copy of every event it has seen or written, in IndexedDB.
// Apps read from here first (so they work offline and start instantly) and
// relays only fill it up. The same copy is what gets re-published when relays
// forget, and what goes into backups.

import { matchFilters } from './nostr.mjs';
import { addressOf, supersedes, isEphemeralKind, observe } from './events.js';

const DB_VERSION = 1;

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
      r.onupgradeneeded = () => {
        const db = r.result;
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('pubkey', 'pubkey');
        events.createIndex('address', 'address');
        events.createIndex('kind', 'kind');
        db.createObjectStore('outbox', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(new LocalStore(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Database is open in another tab with an older version'));
    });
  }

  tx(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  // ---- events ----

  /**
   * Store an event unless something newer at its address is already here.
   * @returns {Promise<'stored'|'ignored'>}
   */
  async put(event) {
    if (isEphemeralKind(event.kind)) return 'ignored';
    observe(event); // even when it is older than ours: our next write must beat every version anyone has
    const address = addressOf(event);
    const os = this.tx('events', 'readwrite');
    if (address) {
      const current = await req(os.index('address').get(address));
      if (current && !supersedes(event, current.event)) return 'ignored';
      if (current) await req(os.delete(current.id));
    } else if (await req(os.getKey(event.id))) {
      return 'ignored';
    }
    await req(os.put({ id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at, ...(address ? { address } : {}), event }));
    for (const fn of this.listeners) fn(event);
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
  async query(filters) {
    const list = Array.isArray(filters) ? filters : [filters];
    const authors = list.every((f) => f.authors?.length) ? [...new Set(list.flatMap((f) => f.authors))] : null;
    const os = this.tx('events');
    const rows = authors ? (await Promise.all(authors.map((pk) => req(os.index('pubkey').getAll(pk))))).flat() : await req(os.getAll());
    const events = rows
      .map((r) => r.event)
      .filter((e) => matchFilters(list, e))
      .sort((a, b) => b.created_at - a.created_at);
    for (const e of events) observe(e); // what an app shows is what its next edit must supersede
    return events;
  }

  async byAuthor(pubkey) {
    return (await req(this.tx('events').index('pubkey').getAll(pubkey))).map((r) => r.event);
  }

  async remove(id) {
    await req(this.tx('events', 'readwrite').delete(id));
  }

  async removeByAuthor(pubkey) {
    const os = this.tx('events', 'readwrite');
    for (const id of await req(os.index('pubkey').getAllKeys(pubkey))) await req(os.delete(id));
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
    for (const name of ['events', 'outbox', 'meta']) await req(this.tx(name, 'readwrite').clear());
  }

  close() {
    this.db.close();
  }
}
