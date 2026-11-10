// Settings that follow an account to every device: one encrypted addressable
// event per namespace (kind 30791, d = 'suite' | 'loadout' | …) under the
// user's own key, cached in localStorage so screens draw before relays answer.
//
// The event holds the whole namespace, and the newest event wins, so a device
// must not write before it knows the newest one: it would put back what it
// had, with a newer date, over what another device changed meanwhile. A
// change is therefore applied here at once and kept as a patch (in
// localStorage too, so leaving the page loses nothing), and published only
// once the relays have answered (or after a few seconds without them), as the
// newest known event with the patch on top.

import { baseStore, whole } from './peers.js';
import { KINDS, makeAddressable, seal, open, supersedes } from './events.js';
import { selfKey } from './account.js';
import { store } from './util.js';

const SYNC_WAIT = 4000; // ms a change waits for the relays' first answer before it is published regardless

/** The hub's own network's view of a net (shared/relays.js, shared/sync.js, shared/store.js), or the net as given when it has no networks. */
const onHub = (net) => {
  const pool = whole(net.pool);
  const sync = whole(net.sync);
  const db = baseStore(net.db);
  if (typeof pool?.scope !== 'function' || typeof sync?.scope !== 'function' || typeof db?.scope !== 'function') return net;
  return { ...net, db: db.scope('hub'), pool: pool.scope('hub'), sync: sync.scope('hub') };
};

export class AccountSettings {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {{ pool: import('./relays.js').RelayPool, db: import('./store.js').LocalStore, sync: import('./sync.js').Sync }} net
   * @param {string} d namespace, e.g. 'suite' or an app name
   */
  constructor(identity, net, d) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.key = selfKey(identity.sk);
    this.net = onHub(net); // a person's settings live on the hub's own network, whichever mount they are changed from
    this.d = d;
    this.cacheKey = `wjs.settings.${d}.${this.pk.slice(0, 16)}`;
    this.patchKey = `${this.cacheKey}.patch`;
    this.base = store.get(this.cacheKey, {}) || {}; // what the newest event said, as far as this device knows
    this.patch = store.get(this.patchKey, {}) || {}; // changes made here that no event carries yet
    this.data = { ...this.base, ...this.patch };
    this.listeners = new Set();
    this.newest = null; // the newest event applied: an older one arriving later is ignored
    this.synced = Promise.resolve(); // start() replaces it: the relays' first answer
    this.applying = Promise.resolve(); // events are applied one after another (receive), so "all applied" can be awaited
  }

  get filter() {
    return { kinds: [KINDS.SETTINGS], authors: [this.pk], '#d': [this.d] };
  }

  async start() {
    const { db, pool } = this.net;
    // listen first, then read: an event stored between the two would be lost to this page otherwise
    this.offStore = db.subscribe((ev) => {
      if (ev.kind === KINDS.SETTINGS && ev.pubkey === this.pk) this.receive(ev);
    });
    for (const ev of (await db.query([this.filter])).reverse()) await this.receive(ev);
    // The relays' first answer (or a few seconds without one): from then on a change is written over the newest event.
    // Not before every event they sent has been stored and applied: a change written on top of a base that does not
    // have them yet would go out as the newest version and lose them (a device signing in once wrote its device
    // entry over the account's name this way, when the store was slow to take the account's settings).
    this.synced = new Promise((resolve) => {
      const t = setTimeout(resolve, SYNC_WAIT);
      const arriving = [];
      this.sub = pool.subscribe([this.filter], {
        onevent: (ev) => {
          arriving.push(Promise.resolve(db.put(ev)).catch(() => {}));
        },
        oneose: () => {
          clearTimeout(t);
          Promise.all(arriving)
            .then(() => this.applying) // the store handed them to receive() as it took them
            .then(() => resolve());
        },
      });
    });
    // a change made on a page that went away before it was published: published now
    if (Object.keys(this.patch).length) this.flush().catch(() => {});
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
  }

  /** An event of the namespace, applied after the ones before it. */
  receive(ev) {
    this.applying = this.applying.then(() => this.apply(ev)).catch(() => {});
    return this.applying;
  }

  /** The newest event wins, not the last call: a read of the store can hand over an older version after a newer one came in live. */
  async apply(ev) {
    if (ev.tags.find((t) => t[0] === 'd')?.[1] !== this.d) return;
    if (this.newest && !supersedes(ev, this.newest)) return;
    this.newest = ev;
    let data;
    try {
      data = await open(this.key, ev.content);
    } catch {
      return;
    }
    if (this.newest?.id !== ev.id || !data || typeof data !== 'object') return;
    if ((data.u || 0) < (this.base.u || 0)) return;
    this.base = data;
    this.data = { ...this.base, ...this.patch };
    this.persist();
  }

  get(key, fallback) {
    return this.data[key] === undefined ? fallback : this.data[key];
  }

  /** A change: shown here at once, published over the newest event once the relays have answered. */
  async set(patch) {
    this.patch = { ...this.patch, ...patch };
    store.set(this.patchKey, this.patch);
    this.data = { ...this.base, ...this.patch };
    this.persist();
    await this.flush();
  }

  /** Publish what is changed here, on top of the newest event known. */
  async flush() {
    await this.synced;
    if (!Object.keys(this.patch).length) return; // a change made meanwhile went out with an earlier call
    const payload = { ...this.base, ...this.patch, u: Math.max(Date.now(), (this.base.u || 0) + 1) };
    this.patch = {};
    this.base = payload;
    this.data = { ...this.base };
    this.persist();
    const event = makeAddressable(KINDS.SETTINGS, this.d, await seal(this.key, payload), this.sk);
    await this.net.sync.publish(event); // stored and owed to the relays in one step: from here on nothing is lost
    if (!Object.keys(this.patch).length) store.remove(this.patchKey);
    else store.set(this.patchKey, this.patch);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  persist() {
    store.set(this.cacheKey, this.base);
    for (const fn of this.listeners) fn(this.data);
  }

  forgetLocal() {
    store.remove(this.cacheKey);
    store.remove(this.patchKey);
  }
}
