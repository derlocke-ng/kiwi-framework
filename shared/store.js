// The device's copy of every event it has seen or written, in IndexedDB.
// Apps read from here first (so they work offline and start instantly) and
// relays only fill it up. The same copy is what gets re-published when relays
// forget, and what goes into backups.

import { matchFilters } from './nostr.mjs';
import { mergeCall } from './chatlog.js';
import { addressOf, expiryOf, supersedes, isEphemeralKind, observe } from './events.js';

const DB_VERSION = 3;

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** The key of a meta entry that says when something stored goes (`what`: `e` an event, `c` a record of the chat table): sorted by the time. */
const expKey = (at, what, id) => `exp:${String(at).padStart(12, '0')}:${what}:${id}`;
const nowS = () => Math.floor(Date.now() / 1000);
/** A message as a deletion leaves it: no text, no file. */
const erased = (m) => {
  const { file: _file, ...rest } = m;
  return { ...rest, text: '', deleted: true };
};

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
   * Store an event unless something newer at its address is already here. With `pending`, the
   * relays that still need it are recorded in the same transaction: a page that goes away right
   * after a change leaves the event either unstored or stored and owed to its relays, never
   * stored and forgotten.
   * @param {object} event
   * @param {string | null} [network]  the network the event belongs to ('hub' when none)
   * @param {{ pending?: string[] | null }} [options]
   * @returns {Promise<'stored'|'ignored'>}
   */
  async put(event, network = null, { pending = null } = {}) {
    if (isEphemeralKind(event.kind)) return 'ignored';
    observe(event); // even when it is older than ours: our next write must beat every version anyone has
    const address = addressOf(event);
    // A regular event with an expiration (NIP-40: a disappearing message's wrap) goes when it says; one that has
    // gone already is not taken, even from a relay that does not keep to NIP-40. (An addressable one is the
    // app's to judge: the market renews a listing that ran out.)
    const exp = address ? 0 : expiryOf(event);
    if (exp && exp <= nowS()) return 'ignored';
    // one transaction over every store touched: a request on a second transaction in between would let the first commit early
    const tx = this.db.transaction(['events', 'nets', 'outbox', 'meta'], 'readwrite');
    const os = tx.objectStore('events');
    const nets = tx.objectStore('nets');
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
    if (replaced) await req(nets.delete(replaced));
    if (network && network !== 'hub') await req(nets.put({ id: event.id, net: network }));
    if (pending?.length) await this.markPending(tx.objectStore('outbox'), event.id, pending);
    if (exp) await req(tx.objectStore('meta').put({ k: expKey(exp, 'e', event.id), v: 1 }));
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
    await this.markPending(this.tx('outbox', 'readwrite'), id, urls);
  }

  /** The outbox entry of `id` gains `urls`, on the given outbox store (part of a larger transaction, or its own). */
  async markPending(os, id, urls) {
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

  /**
   * A message (or a line the chat writes itself, `system`), stored erased when a deletion by its writer came first;
   * one with `expires` (seconds) goes then.
   * @param {{ id: string, conv: string, from: string, at: number, text: string, wrap: string, expires?: number, [k: string]: any }} message
   */
  async putMessage(message) {
    const tx = this.db.transaction(['chat', 'meta'], 'readwrite');
    const os = tx.objectStore('chat');
    const del = await req(os.get(`d:${message.id}`));
    const m = del?.by?.includes(message.from) ? erased(message) : message;
    await req(os.put(m));
    if (m.expires) await req(tx.objectStore('meta').put({ k: expKey(m.expires, 'c', m.id), v: 1 }));
    for (const fn of this.chatListeners || []) fn(m);
  }

  async hasMessage(id) {
    return Boolean(await req(this.tx('chat').get(id)));
  }

  /** One message by its id, or null. */
  async getMessage(id) {
    const m = await req(this.tx('chat').get(id));
    return m && m.at != null && !(m.expires && m.expires <= nowS()) ? m : null;
  }

  // ---- chat changes (shared/chatlog.js): reactions, edits, pins, deletions ----
  // Kept in the chat table beside the messages, under ids `x:<conv>:<id>` and without `at`: the index the
  // conversations are read by (conv, at) never sees them, forgetting a conversation (the `conv` index) takes
  // them along, and one conversation's changes are one key range. A deletion also leaves `d:<id>` for each
  // thing it deletes, so a message that arrives after its deletion is stored erased.

  /**
   * Store a change; false when it was here already, or is an edit of something deleted. A deletion by the writer
   * erases the message (text and file) and the edits of it at once.
   */
  async putChange(change) {
    const tx = this.db.transaction(['chat', 'meta'], 'readwrite');
    const os = tx.objectStore('chat');
    const id = `x:${change.conv}:${change.ref}`;
    if (await req(os.getKey(id))) return false;
    if (change.type === 'edit' && (await req(os.get(`d:${change.target}`)))?.by?.includes(change.from)) return false;
    await req(os.put({ ...change, id }));
    if (change.expires) await req(tx.objectStore('meta').put({ k: expKey(change.expires, 'c', id), v: 1 }));
    if (change.type === 'delete') {
      for (const target of change.targets) {
        const d = await req(os.get(`d:${target}`));
        await req(os.put({ id: `d:${target}`, conv: change.conv, by: [...new Set([...(d?.by || []), change.from])] }));
        const m = await req(os.get(target));
        if (m && m.at != null && m.from === change.from && !m.deleted) await req(os.put(erased(m)));
      }
      const range = IDBKeyRange.bound(`x:${change.conv}:`, `x:${change.conv}:\uffff`);
      for (const c of await req(os.getAll(range)))
        if (c.type === 'edit' && c.from === change.from && change.targets.includes(c.target)) await req(os.delete(c.id));
    }
    for (const fn of this.chatListeners || []) fn(change);
    return true;
  }

  /** A call's line (shared/chatlog.js callLine): merged with what is known of the call so far. Resolves with the line. */
  async putCall(line) {
    const tx = this.db.transaction(['chat', 'meta'], 'readwrite');
    const os = tx.objectStore('chat');
    const merged = mergeCall(await req(os.get(line.id)), { ...line, seq: line.seq || Date.now() });
    await req(os.put(merged));
    if (merged.expires) await req(tx.objectStore('meta').put({ k: expKey(merged.expires, 'c', merged.id), v: 1 }));
    for (const fn of this.chatListeners || []) fn(merged);
    return merged;
  }

  /** Every change in one conversation. */
  async changes(conv) {
    return req(this.tx('chat').getAll(IDBKeyRange.bound(`x:${conv}:`, `x:${conv}:\uffff`)));
  }

  /** The whole chat table, messages and changes (the search reads it). */
  async chatAll() {
    return req(this.tx('chat').getAll());
  }

  /**
   * Forget what has gone (NIP-40): expiring events with their network and outbox entries, messages and changes.
   * Resolves with how many went.
   */
  async purgeExpired(at = nowS()) {
    const tx = this.db.transaction(['meta', 'events', 'nets', 'outbox', 'chat'], 'readwrite');
    const meta = tx.objectStore('meta');
    const keys = await req(meta.getAllKeys(IDBKeyRange.bound('exp:', `exp:${String(at).padStart(12, '0')}:\uffff`)));
    for (const k of keys) {
      const [, , what, ...rest] = String(k).split(':');
      const id = rest.join(':');
      if (what === 'e') {
        await req(tx.objectStore('events').delete(id));
        await req(tx.objectStore('nets').delete(id));
        await req(tx.objectStore('outbox').delete(id));
      } else await req(tx.objectStore('chat').delete(id));
      await req(meta.delete(k));
    }
    if (keys.length) for (const fn of this.chatListeners || []) fn(null);
    return keys.length;
  }

  /** The newest `limit` messages of a conversation before `before` (a time), oldest first; within one second by the writers' milliseconds, then as this device took them. */
  messages(conv, { before = Infinity, limit = 50 } = {}) {
    return new Promise((resolve, reject) => {
      const out = [];
      const range = IDBKeyRange.bound([conv, 0], [conv, before], false, true);
      const r = this.tx('chat').index('convAt').openCursor(range, 'prev');
      r.onerror = () => reject(r.error);
      const at = nowS();
      r.onsuccess = () => {
        const c = r.result;
        if (!c || out.length >= limit) return resolve(out.sort((a, b) => (a.t || a.at * 1000) - (b.t || b.at * 1000) || (a.seq || 0) - (b.seq || 0) || (a.id < b.id ? -1 : 1)));
        if (!(c.value.expires && c.value.expires <= at)) out.push(c.value);
        c.continue();
      };
    });
  }

  /** The messages that carry a file, in conversations and groups, newest first (Payload's "Received"). */
  files({ limit = 300 } = {}) {
    return new Promise((resolve, reject) => {
      const out = [];
      const r = this.tx('chat').index('convAt').openCursor(null, 'prev');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve(out.sort((a, b) => (b.t || b.at * 1000) - (a.t || a.at * 1000)).slice(0, limit));
        if (c.value.file && !(c.value.expires && c.value.expires <= nowS())) out.push(c.value);
        c.continue();
      };
    });
  }

  /** Every conversation with its newest message, newest first. */
  conversations() {
    // The newest message of each conversation. The index orders by the second; two messages in one
    // second are told apart by the writer's millisecond, then by when this device took them, like
    // messages(): the unread count depends on the right one being the newest.
    const time = (m) => m.t || m.at * 1000;
    const newer = (a, b) => time(a) - time(b) || (a.seq || 0) - (b.seq || 0) || (a.id > b.id ? 1 : -1);
    const at = nowS();
    return new Promise((resolve, reject) => {
      const seen = new Map();
      const r = this.tx('chat').index('convAt').openCursor(null, 'prev');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve([...seen.values()].sort((a, b) => newer(b, a)));
        const have = seen.get(c.value.conv);
        if (!(c.value.expires && c.value.expires <= at) && (!have || newer(c.value, have) > 0)) seen.set(c.value.conv, c.value);
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
