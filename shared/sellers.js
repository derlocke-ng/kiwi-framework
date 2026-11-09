// Who may sell on a market. A market mount may ask its sellers to have shown
// up in the community first: so many posts in a feed space (Armory: Outpost)
// that other people liked, each liked by so many of them. Or a moderator of
// the market's space approves them. Without a rule anyone may sell, as before.
//
//   mount: { …, sellers: { space: 'outpost', posts: 3, likes: 3 } }
//
// A moderator's approval is a NIP-32 label (kind 1985) in the namespace
// wjs/seller on the person (`p`), in the market's space (`a`): `approved`, or
// `revoked` to take it back; the newest one by any of the space's moderators
// counts. Posts count when they are sealed to the feed's space (not to
// friends) and not deleted; a like counts when it is the newest reaction of
// someone other than the writer whom the reader has not blocked. Everything
// is checked on the reader's device: a listing by someone who does not
// qualify is not shown to buyers, their moderators see it marked.
import { KINDS, open } from './events.js';
import { keyTag } from './sealed.js';
import { isModerator, spaceReadKey } from './spaces.js';

export const SELLER_NAMESPACE = 'wjs/seller';
const RECHECK = 60_000; // a seller's posts and likes are looked at again after a minute

/** The tags of a moderator's decision on a seller (NIP-32). */
export const sellerTags = (pk, decision) => [
  ['L', SELLER_NAMESPACE],
  ['l', decision, SELLER_NAMESPACE],
  ['p', pk],
];

/**
 * A market's rule for sellers, cleaned: null when there is none (anyone sells).
 * @param {any} rule  the mount's `sellers`
 * @param {(id: string) => any} spaceById
 */
export function sellerRule(rule, spaceById) {
  if (!rule || typeof rule !== 'object') return null;
  const posts = Math.max(0, Math.min(100, Number.parseInt(rule.posts, 10) || 0));
  const likes = Math.max(0, Math.min(100, Number.parseInt(rule.likes, 10) || 0));
  const feed = posts && rule.space ? spaceById(String(rule.space)) : null;
  return { posts: feed ? posts : 0, likes: feed ? likes : 0, feed };
}

export class Sellers {
  /**
   * @param {{ market: any, feed?: any }} nets  market: the market space's network (where approvals are); feed: the feed space's
   * @param {{ pk: string }} identity
   * @param {{ space: any, rule: ReturnType<typeof sellerRule>, isBlocked?: (pk: string) => boolean }} options
   */
  constructor(nets, identity, { space, rule, isBlocked = () => false }) {
    this.market = nets.market;
    this.feed = nets.feed || null;
    this.pk = identity.pk;
    this.space = space;
    this.rule = rule;
    this.isBlocked = isBlocked;
    this.decisions = new Map(); // seller pk -> { decision, at, id } the newest by a moderator
    this.counts = new Map(); // seller pk -> { posts: number, at: ms } posts that count, when it was looked at
    this.checking = new Map(); // seller pk -> promise
    this.listeners = new Set();
    this.subs = [];
    this.version = 0;
  }

  /** Listen, then read, then ask the relays (the data layer's order): moderators' decisions on sellers in this space. */
  async start() {
    if (!this.rule || !this.space) return this;
    const filter = { kinds: [KINDS.LABEL], '#a': [this.space.address] };
    this.offStore = this.market.db.subscribe((ev) => this.receive(ev));
    for (const ev of await this.market.db.query([filter])) this.receive(ev, false);
    this.subs.push(this.market.pool.subscribe([filter], { onevent: (ev) => this.market.db.put(ev) }));
    this.changed();
    return this;
  }

  stop() {
    this.offStore?.();
    for (const s of this.subs) s.close();
    this.subs = [];
    this.listeners.clear();
  }

  receive(ev, notify = true) {
    if (ev.kind !== KINDS.LABEL || !isModerator(this.space, ev.pubkey)) return;
    if (!ev.tags.some((t) => t[0] === 'a' && t[1] === this.space.address)) return;
    const decision = ev.tags.find((t) => t[0] === 'l' && t[2] === SELLER_NAMESPACE)?.[1];
    const pk = ev.tags.find((t) => t[0] === 'p')?.[1];
    if (!['approved', 'revoked'].includes(decision) || !pk) return;
    const cur = this.decisions.get(pk);
    if (cur && (cur.at > ev.created_at || (cur.at === ev.created_at && cur.id <= ev.id))) return;
    this.decisions.set(pk, { decision, at: ev.created_at, id: ev.id });
    if (notify) this.changed();
  }

  changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Is there a rule at all? Without one, everyone sells. */
  get ruled() {
    return Boolean(this.rule);
  }

  /** A moderator's newest decision on someone: 'approved', 'revoked' or null. */
  decision(pk) {
    return this.decisions.get(pk)?.decision || null;
  }

  /**
   * Where someone stands: may they sell, and why. `posts` is how many of their posts count (null while it is being
   * looked at). Asks for their posts and likes when it does not know, or knew a minute ago.
   * @returns {{ ok: boolean | null, approved: boolean, revoked: boolean, posts: number | null, need: number, likes: number }}
   */
  status(pk) {
    const need = this.rule?.posts || 0;
    const likes = this.rule?.likes || 0;
    if (!this.rule) return { ok: true, approved: false, revoked: false, posts: null, need, likes };
    const decision = this.decision(pk);
    if (decision === 'approved') return { ok: true, approved: true, revoked: false, posts: this.counts.get(pk)?.posts ?? null, need, likes };
    const count = this.counts.get(pk);
    if (!count || Date.now() - count.at > RECHECK) this.check(pk);
    const revoked = decision === 'revoked';
    // a moderator who took the approval back has the last word over the posts
    if (revoked) return { ok: false, approved: false, revoked, posts: count?.posts ?? null, need, likes };
    if (!need) return { ok: false, approved: false, revoked, posts: null, need, likes };
    if (!count) return { ok: null, approved: false, revoked, posts: null, need, likes };
    return { ok: count.posts >= need, approved: false, revoked, posts: count.posts, need, likes };
  }

  /** Look at someone's posts in the feed space and the likes on them. */
  check(pk) {
    if (!this.feed || !this.rule?.feed || !this.rule.posts) return Promise.resolve(0);
    if (this.checking.has(pk)) return this.checking.get(pk);
    const p = this.count(pk)
      .then((posts) => {
        this.counts.set(pk, { posts, at: Date.now() });
        this.changed();
        return posts;
      })
      .catch(() => 0)
      .finally(() => this.checking.delete(pk));
    this.checking.set(pk, p);
    return p;
  }

  async count(pk) {
    const feed = this.rule.feed;
    const { k, kid } = spaceReadKey(feed);
    const entries = { kinds: [KINDS.FEED_ENTRY], authors: [pk], '#a': [feed.address] };
    const all = [...(await this.feed.db.query([entries])), ...(await this.feed.pool.fetch([entries]).catch(() => []))];
    // the newest version of each entry, sealed to the space, not deleted
    const newest = new Map();
    for (const ev of all) {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1];
      if (!d || keyTag(ev) !== kid) continue;
      const cur = newest.get(d);
      if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && ev.id < cur.id)) newest.set(d, ev);
    }
    const addresses = [];
    for (const [d, ev] of newest) {
      try {
        const value = await open(k, ev.content);
        if (value && !value.del) addresses.push(`${KINDS.FEED_ENTRY}:${pk}:${d}`);
      } catch {
        /* not sealed to the space after all */
      }
    }
    if (!addresses.length) return 0;
    const reactions = { kinds: [KINDS.REACTION], '#a': addresses };
    const likes = [...(await this.feed.db.query([reactions])), ...(await this.feed.pool.fetch([reactions]).catch(() => []))];
    // the newest reaction of each person on each post
    const last = new Map();
    for (const ev of likes) {
      if (ev.pubkey === pk || this.isBlocked(ev.pubkey)) continue;
      const a = ev.tags.find((t) => t[0] === 'a' && addresses.includes(t[1]))?.[1];
      if (!a) continue;
      const key = `${a}|${ev.pubkey}`;
      const cur = last.get(key);
      if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && ev.id < cur.id)) last.set(key, ev);
    }
    const per = new Map();
    for (const [key, ev] of last) if (ev.content === '+') per.set(key.split('|')[0], (per.get(key.split('|')[0]) || 0) + 1);
    return addresses.filter((a) => (per.get(a) || 0) >= this.rule.likes).length;
  }
}
