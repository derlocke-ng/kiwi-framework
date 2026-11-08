// Which network a person is reached on. A hub with a public area has two
// networks (shared/relays.js): its own relays and the public ones. A sealed
// note to someone goes to the network they are on, learned from where their
// notes reached us (a friend request that came over the public relays marks
// them public), or taken as the network of the page a conversation starts on.
// Someone once seen on the hub's own network stays there: an outsider cannot
// write to those relays, so that is the trustworthy sign. Per device and key.
import { store } from './util.js';

export class PeerNetworks {
  /**
   * @param {string} pk  the identity these peers belong to
   * @param {{ fallback?: string }} [options]  the network for someone not seen yet: the page's
   */
  constructor(pk, { fallback = 'hub' } = {}) {
    this.key = `wjs.peers.${pk.slice(0, 16)}`;
    this.fallback = fallback;
    this.map = store.get(this.key, {}) || {};
  }

  /** The network to reach `pk` on. */
  of(pk) {
    return this.map[pk] || this.fallback;
  }

  /** A note from `pk` arrived over `network`: remember, unless we already know them on the hub's own network. */
  learn(pk, network) {
    if (!pk || !network || this.map[pk] === network || this.map[pk] === 'hub') return;
    this.map[pk] = network;
    store.set(this.key, this.map);
  }

  /** The relays `pk` named inside a sealed note that came over `network` (or over a network not known: 'any'). */
  learnRelays(pk, network, urls) {
    if (!pk || !urls?.length) return;
    const all = store.get(this.relaysKey, {}) || {};
    all[`${network || 'any'}:${pk}`] = { urls: urls.slice(0, 4), at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete all[k];
    store.set(this.relaysKey, all);
  }

  /** What `pk` told us about their relays on `network`, within a month. */
  relaysOf(pk, network) {
    const all = store.get(this.relaysKey, {}) || {};
    const hit = all[`${network}:${pk}`] || all[`any:${pk}`];
    return hit && Date.now() - hit.at < 30 * 86_400_000 ? hit.urls : [];
  }

  get relaysKey() {
    return `${this.key}.relays`;
  }
}

/** The whole pool or sync behind a scoped one (shared/relays.js, shared/sync.js), or the thing itself. */
export const whole = (x) => x?.all || x;
/** The whole store behind a scoped one (shared/store.js), or the store itself. */
export const baseStore = (db) => db?.base || db;
