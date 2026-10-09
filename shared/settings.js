// Settings that follow an account to every device: one encrypted addressable
// event per namespace (kind 30791, d = 'suite' | 'loadout' | …) under the
// user's own key, cached in localStorage so screens draw before relays answer.

import { KINDS, makeAddressable, seal, open } from './events.js';
import { selfKey } from './account.js';
import { store } from './util.js';

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
    this.net = net;
    this.d = d;
    this.cacheKey = `wjs.settings.${d}.${this.pk.slice(0, 16)}`;
    this.data = store.get(this.cacheKey, {});
    this.listeners = new Set();
    this.seq = 0;
  }

  get filter() {
    return { kinds: [KINDS.SETTINGS], authors: [this.pk], '#d': [this.d] };
  }

  async start() {
    const { db, pool } = this.net;
    for (const ev of (await db.query([this.filter])).reverse()) await this.receive(ev);
    this.offStore = db.subscribe((ev) => {
      if (ev.kind === KINDS.SETTINGS && ev.pubkey === this.pk) this.receive(ev);
    });
    this.sub = pool.subscribe([this.filter], { onevent: (ev) => db.put(ev) });
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
  }

  async receive(ev) {
    if (ev.tags.find((t) => t[0] === 'd')?.[1] !== this.d) return;
    const n = ++this.seq;
    let data;
    try {
      data = await open(this.key, ev.content);
    } catch {
      return;
    }
    if (this.seq !== n || !data || typeof data !== 'object') return;
    if ((data.u || 0) < (this.data.u || 0)) return;
    this.data = data;
    this.persist();
  }

  get(key, fallback) {
    return this.data[key] === undefined ? fallback : this.data[key];
  }

  async set(patch) {
    this.data = { ...this.data, ...patch, u: Date.now() };
    this.persist();
    await this.net.sync.publish(makeAddressable(KINDS.SETTINGS, this.d, await seal(this.key, this.data), this.sk));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  persist() {
    store.set(this.cacheKey, this.data);
    for (const fn of this.listeners) fn(this.data);
  }

  forgetLocal() {
    store.remove(this.cacheKey);
  }
}
