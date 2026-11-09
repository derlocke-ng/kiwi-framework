// The vault's entries on the relays and in this device's store: one
// addressable event per entry (kind 30792, d a random id, shared/vault.js
// seals the content), under the person's own key on the hub's network, like
// their settings. The events are held here sealed; while the vault is open the
// page also holds their values, in memory only, and forgets them on lock().
//
// Like every module of the data layer it listens to the store before it reads
// it, and the newest event per address wins (a read of the store can hand over
// an older version after a newer one came in live). A deleted entry is an
// event whose sealed value says so; an entry removed with the whole vault (its
// passphrase lost, so nothing can be sealed) is an event with empty content.
//
//   const vault = await new VaultStore(identity, kiwi.hubNet).start();
//   vault.unlock(await openKeys(record, passphrase));
//   await vault.put({ type: 'login', name: 'Shop', username: 'ada', password: '…' });
import { KINDS, makeAddressable, supersedes, dTag } from './events.js';
import { cleanEntry } from './totp.js';
import { openItem, sealItem } from './vault.js';
import { baseStore, whole } from './peers.js';

export const TYPES = ['login', 'note', 'card', 'totp', 'ssh', 'ca', 'cert'];
const HISTORY = 10; // earlier passwords kept per entry

/** The hub's own network's view of a net, or the net as given when it has no networks (as settings.js). */
const onHub = (net) => {
  const pool = whole(net.pool);
  const sync = whole(net.sync);
  const db = baseStore(net.db);
  if (typeof pool?.scope !== 'function' || typeof sync?.scope !== 'function' || typeof db?.scope !== 'function') return net;
  return { ...net, db: db.scope('hub'), pool: pool.scope('hub'), sync: sync.scope('hub') };
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const randomD = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const strings = (a, max, n) => (Array.isArray(a) ? a.map((x) => str(x, max).trim()).filter(Boolean).slice(0, n) : []);
const time = (v) => (v === null ? null : Number(v) || 0);

/** An SSH key (shared/ssh.js): its files, and, for a CA, the certificates it signed. */
function cleanSsh(k) {
  if (!k || typeof k !== 'object') return null;
  return {
    keyType: str(k.keyType, 20),
    publicKey: str(k.publicKey, 20000),
    privateKey: str(k.privateKey, 20000),
    fingerprint: str(k.fingerprint, 100),
    comment: str(k.comment, 200),
    ca: Boolean(k.ca),
    issued: Array.isArray(k.issued)
      ? k.issued
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({ serial: Number(c.serial) || 0, type: c.type === 'host' ? 'host' : 'user', keyId: str(c.keyId, 200), principals: strings(c.principals, 200, 50), validBefore: time(c.validBefore), at: Number(c.at) || 0, fingerprint: str(c.fingerprint, 100) }))
          .slice(-500)
      : [],
  };
}

/** A certificate authority, or a certificate it issued (shared/x509.js). */
function cleanPki(p) {
  if (!p || typeof p !== 'object') return null;
  const kinds = ['root', 'intermediate', 'server', 'client', 'both'];
  return {
    kind: kinds.includes(p.kind) ? p.kind : 'server',
    origin: ['ca', 'self', 'external'].includes(p.origin) ? p.origin : 'ca', // issued by a CA in the vault, self-signed, or by another CA
    keyType: str(p.keyType, 20),
    certPem: str(p.certPem, 30000),
    keyPem: str(p.keyPem, 20000),
    chainPem: str(p.chainPem, 60000),
    csrPem: str(p.csrPem, 20000),
    subject: { cn: str(p.subject?.cn, 64), o: str(p.subject?.o, 64), ou: str(p.subject?.ou, 64), c: str(p.subject?.c, 2), st: str(p.subject?.st, 64), l: str(p.subject?.l, 64) },
    permitted: { dns: strings(p.permitted?.dns, 253, 50), ips: strings(p.permitted?.ips, 50, 50) },
    days: Number(p.days) || 0,
    previous: Array.isArray(p.previous)
      ? p.previous
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({ serial: str(c.serial, 40), notAfter: Number(c.notAfter) || 0, at: Number(c.at) || 0 }))
          .slice(-20)
      : [],
    sans: { dns: strings(p.sans?.dns, 253, 100), ips: strings(p.sans?.ips, 45, 100), emails: strings(p.sans?.emails, 254, 100) },
    serial: str(p.serial, 40),
    notAfter: Number(p.notAfter) || 0,
    caId: str(p.caId, 64),
    issued: Array.isArray(p.issued)
      ? p.issued
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({ serial: str(c.serial, 40), cn: str(c.cn, 64), kind: kinds.includes(c.kind) ? c.kind : 'server', notAfter: Number(c.notAfter) || 0, at: Number(c.at) || 0, entryId: str(c.entryId, 64) }))
          .slice(-1000)
      : [],
  };
}

/**
 * An entry as this version keeps it, or null when it is not one. Unknown fields are kept (a newer
 * version's), so an older page editing an entry does not drop what it does not know.
 * @param {any} e
 */
export function cleanItem(e) {
  if (!e || typeof e !== 'object') return null;
  const type = TYPES.includes(e.type) ? e.type : typeof e.type === 'string' && /^[a-z]{2,16}$/.test(e.type) ? e.type : null;
  if (!type) return null;
  const totp = e.totp ? cleanEntry({ ...e.totp, issuer: e.name, account: e.username }) : null;
  const card = e.card && typeof e.card === 'object' ? { holder: str(e.card.holder, 120), number: str(e.card.number, 40).replace(/[^\d ]/g, ''), exp: str(e.card.exp, 7), code: str(e.card.code, 8), brand: str(e.card.brand, 40) } : null;
  return {
    ...e,
    id: str(e.id, 64),
    type,
    name: str(e.name, 200),
    username: str(e.username, 500),
    password: str(e.password, 2000),
    urls: Array.isArray(e.urls) ? e.urls.map((u) => str(u, 2000).trim()).filter(Boolean).slice(0, 20) : [],
    notes: str(e.notes, 50000),
    totp: totp ? { secret: totp.secret, algorithm: totp.algorithm, digits: totp.digits, period: totp.period } : null,
    card,
    ssh: cleanSsh(e.ssh),
    pki: cleanPki(e.pki),
    fields: Array.isArray(e.fields)
      ? e.fields
          .filter((f) => f && typeof f === 'object')
          .map((f) => ({ name: str(f.name, 200), value: str(f.value, 5000), hidden: Boolean(f.hidden) }))
          .filter((f) => f.name || f.value)
          .slice(0, 50)
      : [],
    tags: Array.isArray(e.tags) ? [...new Set(e.tags.map((t) => str(t, 60).trim()).filter(Boolean))].slice(0, 20) : [],
    fav: Boolean(e.fav),
    history: Array.isArray(e.history)
      ? e.history
          .filter((h) => h && typeof h.password === 'string')
          .map((h) => ({ password: str(h.password, 2000), at: Number(h.at) || 0 }))
          .slice(0, HISTORY)
      : [],
    created: Number(e.created) || 0,
    updated: Number(e.updated) || 0,
    changed: Number(e.changed) || 0,
  };
}

/** A 0.26 authenticator entry (or an otpauth link's) as an entry of the vault. */
export const fromAuthenticator = (e) => ({
  type: 'totp',
  name: e.issuer || e.account || '',
  username: e.issuer ? e.account || '' : '',
  totp: { secret: e.secret, algorithm: e.algorithm, digits: e.digits, period: e.period },
});

/** Two entries that say the same (an import of what is already here): kind, name, login, password, 2FA secret, key, certificate and notes. */
export const sameItem = (a, b) =>
  (a.type || '') === (b.type || '') &&
  (a.name || '') === (b.name || '') &&
  (a.username || '') === (b.username || '') &&
  (a.password || '') === (b.password || '') &&
  (a.totp?.secret || '') === (b.totp?.secret || '') &&
  (a.ssh?.publicKey || '') === (b.ssh?.publicKey || '') &&
  (a.pki?.certPem || '') === (b.pki?.certPem || '') &&
  (a.notes || '') === (b.notes || '');

/** The entries to show: favourites first, then by name. */
export const byName = (a, b) => Number(b.fav) - Number(a.fav) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

export class VaultStore {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {{ pool: any, db: any, sync: any }} net
   */
  constructor(identity, net) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.net = onHub(net); // the vault lives on the hub's own network, whichever mount opens it
    this.events = new Map(); // d -> the newest event
    this.items = new Map(); // d -> its value, while open
    this.unreadable = new Set(); // ds whose newest event this key does not open (a vault made anew elsewhere)
    this.key = null;
    this.listeners = new Set();
    this.version = 0; // grows on every change: a screen's lists are made again only then
  }

  get filter() {
    return { kinds: [KINDS.VAULT_ITEM], authors: [this.pk] };
  }

  async start() {
    const { db, pool, sync } = this.net;
    // listen first, then read: an event stored between the two would be lost to this page otherwise
    this.offStore = db.subscribe((ev) => {
      if (ev.kind === KINDS.VAULT_ITEM && ev.pubkey === this.pk) this.receive(ev);
    });
    for (const ev of (await db.query([this.filter])).reverse()) await this.receive(ev);
    this.synced = new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      this.sub = pool.subscribe([this.filter], {
        onevent: (ev) => db.put(ev),
        oneose: () => {
          clearTimeout(t);
          setTimeout(resolve, 50);
        },
      });
    });
    sync.watch?.([this.pk]);
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
    this.lock();
  }

  /** The newest event per address wins; while open, its value replaces the entry's. */
  async receive(ev) {
    const d = dTag(ev);
    if (!d) return;
    const have = this.events.get(d);
    if (have && !supersedes(ev, have)) return;
    this.events.set(d, ev);
    if (this.key) await this.read(d, ev, this.key);
    this.emit();
  }

  async read(d, ev, key) {
    if (!ev.content) {
      this.items.delete(d);
      this.unreadable.delete(d);
      return;
    }
    let value;
    try {
      value = await openItem(key, d, ev.content);
    } catch {
      if (this.events.get(d)?.id === ev.id && this.key === key) {
        this.items.delete(d);
        this.unreadable.add(d);
      }
      return;
    }
    if (this.events.get(d)?.id !== ev.id || this.key !== key) return; // a newer version came meanwhile, or the vault was locked
    this.unreadable.delete(d);
    const item = value?.deleted ? null : cleanItem({ ...value, id: d });
    if (item) this.items.set(d, item);
    else this.items.delete(d);
  }

  /** Open: every entry read with the vault key. */
  async unlock(key) {
    this.key = key;
    this.items.clear();
    this.unreadable.clear();
    await Promise.all([...this.events].map(([d, ev]) => this.read(d, ev, key)));
    this.emit();
  }

  /** Locked: the key and every value forgotten. */
  lock() {
    this.key = null;
    this.items.clear();
    this.unreadable.clear();
    this.emit();
  }

  get open() {
    return Boolean(this.key);
  }

  list() {
    return [...this.items.values()].sort(byName);
  }

  get(id) {
    return this.items.get(id) || null;
  }

  /** How many entries the relays hold for this person, open or not (the deleted ones may be among them). */
  get count() {
    return [...this.events.values()].filter((e) => e.content).length;
  }

  /**
   * An entry made or changed: sealed, stored and owed to the relays in one step. A new password
   * puts the old one in the entry's history.
   * @param {any} patch  the entry, or the fields that change (with its id)
   * @returns {Promise<any>} the entry as kept
   */
  async put(patch) {
    if (!this.key) throw new Error('The vault is locked');
    const id = patch.id || randomD();
    const before = this.items.get(id) || null;
    const now = Date.now();
    const next = { ...(before || {}), ...patch, id, created: before?.created || patch.created || now, updated: now };
    if (before && before.password && patch.password !== undefined && patch.password !== before.password) {
      next.history = [{ password: before.password, at: now }, ...(before.history || [])].slice(0, HISTORY);
      next.changed = now;
    } else if (!before) {
      next.changed = patch.changed || now;
    }
    const item = cleanItem(next);
    if (!item) throw new Error('Not an entry');
    const key = this.key;
    this.items.set(id, item);
    this.emit();
    const value = { ...item };
    delete value.id; // the address says it
    await this.publish(id, await sealItem(key, id, value));
    return item;
  }

  /** Entries made at once (an import): each its own event. */
  async putAll(list) {
    const out = [];
    for (const patch of list) out.push(await this.put(patch));
    return out;
  }

  /** An entry deleted: its address keeps a sealed note that says so. */
  async remove(id) {
    if (!this.key) throw new Error('The vault is locked');
    const key = this.key;
    this.items.delete(id);
    this.emit();
    await this.publish(id, await sealItem(key, id, { deleted: true, updated: Date.now() }));
  }

  /** Every entry emptied, readable or not: the vault removed when its passphrase is lost. */
  async clear() {
    const ds = [...this.events.keys()].filter((d) => this.events.get(d)?.content);
    this.items.clear();
    this.unreadable.clear();
    this.emit();
    for (const d of ds) await this.publish(d, '');
  }

  async publish(d, content) {
    const event = makeAddressable(KINDS.VAULT_ITEM, d, content, this.sk);
    this.events.set(d, event);
    await this.net.sync.publish(event);
  }

  /** The entries as the relays hold them, sealed (a backup). */
  sealed() {
    return [...this.events].filter(([, ev]) => ev.content).map(([d, ev]) => ({ d, content: ev.content }));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
