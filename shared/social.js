// What people do with the posts a page shows (the feed's entries, the
// market's listings): likes (NIP-25, `k` naming the posts' kind), comments
// (kind 30822, sealed with the post's key) and reports (NIP-56). A page tells
// it which posts it shows (`watch`); it reads what the device holds, then
// asks the relays, for those posts only, and follows them live. A report by
// one of the space's moderators folds a post away by itself.
//
// Marks: a post can be for adults (18+) or an ad. Its writer says so inside
// the seal; when they did not, people report it as such (a NIP-56 report
// carrying a NIP-32 `l` tag in the namespace wjs/mark) and two such reports
// mark it, or a moderator of the space marks it (kind 1985 in the same
// namespace: adult, ad, or none for "fine as it is"). A moderator's mark is a
// review: the newest one decides the mark, and the reports before it no
// longer count, so a moderator can also lift a fold that reports caused. What
// a mark does is the page's: the feed shows a marked post to people with an
// account only.
import { addressOf, KINDS, supersedes } from './events.js';
import { isModerator } from './spaces.js';

const KINDS_SOCIAL = [KINDS.REACTION, KINDS.REPORT, KINDS.FEED_COMMENT, KINDS.LABEL];
const CHUNK = 100;
const READ_WAIT = 3000; // ms an entry waits for the relays' answer about its marks, at most
const COLLAPSE_REPORTS = 3;
const MARK_REPORTS = 2;

/** What a post can be marked as; 'none' in a moderator's mark means "fine as it is". */
export const MARKS = ['adult', 'ad'];
/** The NIP-32 namespace of marks. */
export const MARK_NAMESPACE = 'wjs/mark';

/** The mark an event carries ('adult', 'ad', 'none'), or null. */
export function markOf(ev) {
  const l = ev?.tags?.find((t) => t[0] === 'l' && t[2] === MARK_NAMESPACE)?.[1];
  return MARKS.includes(l) || l === 'none' ? l : null;
}

/** The tags that make a report or a label event a mark (NIP-32). */
export const markTags = (mark) => [
  ['L', MARK_NAMESPACE],
  ['l', mark, MARK_NAMESPACE],
];

const newer = (x, y) => !y || x.at > y.at || (x.at === y.at && x.id < y.id);

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
    this.reports = new Map(); // entry address -> Map(pk -> at): reports that fold
    this.markReports = new Map(); // entry address -> Map(pk -> { mark, at, id }): reports that ask for a mark, the newest per person
    this.marks = new Map(); // entry address -> Map(pk -> { mark, at, id }): kind 1985 marks, the newest per person (only moderators' count)
    this.comments = new Map(); // entry address -> Map(comment address -> event)
    this.read = new Set(); // entry addresses whose likes, reports and marks this device holds have been read
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
    // read once the relays have answered too (and what they sent is stored, so received), or after a few seconds
    // without an answer: a mark made while this device was away is known before the entry shows
    await new Promise((resolve) => {
      const t = setTimeout(resolve, READ_WAIT);
      const arriving = [];
      this.subs.push(
        this.net.pool.subscribe(filters, {
          onevent: (ev) => {
            arriving.push(Promise.resolve(this.net.db.put(ev)).catch(() => {}));
          },
          oneose: () => {
            clearTimeout(t);
            Promise.all(arriving).then(() => resolve());
          },
        }),
      );
    });
    for (const a of list) this.read.add(a);
    this.changed();
  }

  /**
   * Whether what this device holds about an entry (its marks above all) has been read: until then a screen shows
   * the entry folded, so an entry marked 18+ or as an ad never shows for a moment before its mark is known.
   */
  isRead(address) {
    return this.read.has(address);
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
    } else if (ev.kind === KINDS.REPORT || ev.kind === KINDS.LABEL) {
      const mark = markOf(ev);
      if (ev.kind === KINDS.LABEL || (mark && mark !== 'none')) {
        if (!mark) return;
        const map = ev.kind === KINDS.LABEL ? this.marks : this.markReports;
        if (!map.has(a)) map.set(a, new Map());
        const next = { mark, at: ev.created_at, id: ev.id };
        if (!newer(next, map.get(a).get(ev.pubkey))) return;
        map.get(a).set(ev.pubkey, next);
      } else {
        if (!this.reports.has(a)) this.reports.set(a, new Map());
        if (this.reports.get(a).has(ev.pubkey)) return;
        this.reports.get(a).set(ev.pubkey, ev.created_at);
      }
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

  /** Did I report it (to fold it, or asking for a mark)? */
  reportedByMe(address) {
    return Boolean(this.reports.get(address)?.has(this.pk) || this.markReports.get(address)?.has(this.pk));
  }

  /**
   * The newest review of an entry by a moderator of the space: their newest mark, or a report of theirs
   * asking for one. Moderators count whoever blocked them: a mark is the space's, not one person's view.
   * @returns {{ mark: string, at: number, id: string } | null}
   */
  review(address) {
    let best = null;
    for (const map of [this.marks, this.markReports])
      for (const [pk, m] of map.get(address) || []) if (isModerator(this.space, pk) && newer(m, best)) best = m;
    return best;
  }

  /**
   * What an entry is marked as beyond what its writer set, and by whom: the newest review by a moderator
   * ('none' clears), else two reports by people I have not blocked asking for the same mark (18+ first).
   * @param {string} address
   * @param {(pk: string) => boolean} [isBlocked]
   * @returns {{ mark: string, by: 'moderator' | 'reports' } | null}
   */
  marked(address, isBlocked = () => false) {
    const review = this.review(address);
    if (review) return review.mark === 'none' ? null : { mark: review.mark, by: 'moderator' };
    /** @type {Record<string, number>} */
    const count = { adult: 0, ad: 0 };
    for (const [pk, m] of this.markReports.get(address) || []) if (!isBlocked(pk) && m.mark in count) count[m.mark]++;
    const mark = MARKS.find((x) => count[x] >= MARK_REPORTS);
    return mark ? { mark, by: 'reports' } : null;
  }

  /**
   * Why an entry is folded away, or null: a report by one of the space's moderators is enough on its own,
   * else three reports by people I have not blocked made after a moderator last reviewed it. My own
   * entries are never folded for me.
   * @param {{ pubkey: string, address: string }} entry
   * @param {(pk: string) => boolean} [isBlocked]
   */
  collapsed(entry, isBlocked = () => false) {
    if (entry.pubkey === this.pk) return null;
    const all = this.reports.get(entry.address);
    if (!all) return null;
    const since = this.review(entry.address)?.at ?? -1;
    let n = 0;
    for (const [pk, at] of all) {
      if (pk !== this.pk && isBlocked(pk)) continue;
      if (isModerator(this.space, pk)) return 'moderator';
      if (at > since) n++;
    }
    return n >= COLLAPSE_REPORTS ? 'reports' : null;
  }

  /**
   * For a moderator: how many reports on an entry wait for a review (made after a moderator last reviewed
   * it, by people who are not moderators); none once a moderator reported it.
   * @param {string} address
   */
  pending(address) {
    const reports = this.reports.get(address);
    if (reports && [...reports.keys()].some((pk) => isModerator(this.space, pk))) return 0;
    const since = this.review(address)?.at ?? -1;
    let n = 0;
    for (const [pk, at] of reports || []) if (!isModerator(this.space, pk) && at > since) n++;
    for (const [pk, m] of this.markReports.get(address) || []) if (!isModerator(this.space, pk) && m.at > since) n++;
    return n;
  }

  /** The newest report or mark on an entry: a moderator's mark is stamped after it, so it reviews everything seen. */
  lastAt(address) {
    let at = 0;
    for (const t of this.reports.get(address)?.values() || []) at = Math.max(at, t);
    for (const map of [this.markReports, this.marks]) for (const m of map.get(address)?.values() || []) at = Math.max(at, m.at);
    return at;
  }
}
