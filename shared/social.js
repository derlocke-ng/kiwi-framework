// What people do with the posts a page shows (the feed's entries, the
// market's listings): likes (NIP-25, `k` naming the posts' kind), comments
// (kind 30822, sealed with the post's key) and reports (NIP-56). A page tells
// it which posts it shows (`watch`); it reads what the device holds, then
// asks the relays, for those posts only, and follows them live. A report by
// one of the space's moderators folds a post away by itself.
import { addressOf, KINDS, supersedes } from './events.js';
import { isModerator } from './spaces.js';

const KINDS_SOCIAL = [KINDS.REACTION, KINDS.REPORT, KINDS.FEED_COMMENT];
const CHUNK = 100;
const COLLAPSE_REPORTS = 3;

export class Social {
  /**
   * @param {{ db: any, pool: any }} net  the feed's content network
   * @param {{ pk: string }} identity
   * @param {{ space?: any, kind?: number }} [options]  space: its moderators' reports count as enough on their own;
   *   kind: the posts' kind, which a like names in its `k` tag (the feed's entries by default)
   */
  constructor(net, identity, { space = null, kind = KINDS.FEED_ENTRY } = {}) {
    this.net = net;
    this.pk = identity.pk;
    this.space = space;
    this.kind = kind;
    this.addresses = new Set();
    this.likes = new Map(); // entry address -> Map(pk -> { on, at, id })
    this.reports = new Map(); // entry address -> Map(pk -> at)
    this.comments = new Map(); // entry address -> Map(comment address -> event)
    this.subs = [];
    this.listeners = new Set();
    this.timer = null;
    this.version = 0;
  }

  start() {
    this.offStore = this.net.db.subscribe((ev) => this.receive(ev)); // anything stored from now on: the relays' and this device's own
    return this;
  }

  stop() {
    this.offStore?.();
    for (const s of this.subs) s.close();
    this.subs = [];
    clearTimeout(this.timer);
    this.listeners.clear();
  }

  /** Follow these entries' likes, comments and reports (those not followed yet). */
  watch(addresses) {
    const fresh = [...new Set(addresses)].filter((a) => a && !this.addresses.has(a));
    if (!fresh.length) return;
    for (const a of fresh) this.addresses.add(a);
    for (let i = 0; i < fresh.length; i += CHUNK) this.load(fresh.slice(i, i + CHUNK)).catch(() => {});
  }

  async load(list) {
    const filters = [{ kinds: KINDS_SOCIAL, '#a': list }];
    for (const ev of await this.net.db.query(filters)) this.receive(ev);
    this.subs.push(this.net.pool.subscribe(filters, { onevent: (ev) => this.net.db.put(ev) }));
  }

  /** The entry an event is about, when it is one this page follows. */
  target(ev) {
    return ev.tags.find((t) => t[0] === 'a' && this.addresses.has(t[1]))?.[1] || null;
  }

  receive(ev) {
    if (!KINDS_SOCIAL.includes(ev.kind)) return;
    const a = this.target(ev);
    if (!a) return;
    if (ev.kind === KINDS.REACTION) {
      if (!ev.tags.some((t) => t[0] === 'k' && t[1] === String(this.kind))) return;
      if (!this.likes.has(a)) this.likes.set(a, new Map());
      const cur = this.likes.get(a).get(ev.pubkey);
      if (cur && (cur.at > ev.created_at || (cur.at === ev.created_at && cur.id <= ev.id))) return;
      this.likes.get(a).set(ev.pubkey, { on: ev.content === '+', at: ev.created_at, id: ev.id });
    } else if (ev.kind === KINDS.REPORT) {
      if (!this.reports.has(a)) this.reports.set(a, new Map());
      if (this.reports.get(a).has(ev.pubkey)) return;
      this.reports.get(a).set(ev.pubkey, ev.created_at);
    } else {
      const ca = addressOf(ev);
      if (!this.comments.has(a)) this.comments.set(a, new Map());
      const cur = this.comments.get(a).get(ca);
      if (cur && (cur.id === ev.id || !supersedes(ev, cur))) return;
      this.comments.get(a).set(ca, ev);
    }
    this.changed();
  }

  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.version++;
      for (const fn of this.listeners) fn();
    }, 40);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * How many people like an entry (people I blocked left out).
   * @param {string} address
   * @param {(pk: string) => boolean} [isBlocked]
   */
  likeCount(address, isBlocked = () => false) {
    let n = 0;
    for (const [pk, l] of this.likes.get(address) || []) if (l.on && !isBlocked(pk)) n++;
    return n;
  }

  liked(address) {
    return Boolean(this.likes.get(address)?.get(this.pk)?.on);
  }

  /**
   * The comment events on an entry (the newest version of each), oldest first; people I blocked left out.
   * @param {string} address
   * @param {(pk: string) => boolean} [isBlocked]
   */
  commentEvents(address, isBlocked = () => false) {
    return [...(this.comments.get(address)?.values() || [])].filter((ev) => !isBlocked(ev.pubkey)).sort((x, y) => x.created_at - y.created_at || (x.id < y.id ? -1 : 1));
  }

  /** Did I report it? */
  reportedByMe(address) {
    return Boolean(this.reports.get(address)?.has(this.pk));
  }

  /**
   * Why an entry is folded away, or null: a report by one of the space's moderators is enough on its own,
   * else three reports by people I have not blocked. My own entries are never folded for me.
   * @param {{ pubkey: string, address: string }} entry
   * @param {(pk: string) => boolean} [isBlocked]
   */
  collapsed(entry, isBlocked = () => false) {
    if (entry.pubkey === this.pk) return null;
    const all = this.reports.get(entry.address);
    if (!all) return null;
    let n = 0;
    for (const pk of all.keys()) {
      if (pk !== this.pk && isBlocked(pk)) continue;
      if (isModerator(this.space, pk)) return 'moderator';
      n++;
    }
    return n >= COLLAPSE_REPORTS ? 'reports' : null;
  }
}
