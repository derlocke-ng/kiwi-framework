// The feed's data: entries (kind 30820), comments on them (30822), likes
// (NIP-25), reports (NIP-56). An entry is always sealed: to "the space" (its
// key derives from the space's address, shared/spaces.js), or to one of the
// author's audiences (friends, a circle, only me: shared/audiences.js). Its
// `key` tag names the key's id, so a reader knows which key opens it; a reader
// without that key never sees the entry. Photos are encrypted with keys of
// their own, which travel inside the sealed content.
//
// Entries made on a mount on a space carry the space's `a` tag; a feed on a
// space reads only those, a feed on no space only entries in none. Comments
// are sealed with the entry's key, so whoever reads the entry reads its
// comments; likes and reports are plain (relays see who liked what, not what
// it says). An entry its writer did not mark 18+ or as an ad can be marked by
// reports and by the space's moderators (shared/social.js, Marks).
import { addressOf, isHex64, KINDS, makeAddressable, now, open, seal, sign, stamp } from '../../../shared/events.js';
import { keyTag, SpaceSeal } from '../../../shared/sealed.js';
import { MARKS, markTags } from '../../../shared/social.js';
import { fail, randomId } from '../../../shared/util.js';

export { keyTag };

export const LIMITS = { text: 5000, media: 6, tags: 10, tag: 32, name: 40, comment: 1000 };
/** What a writer may say an entry is: for adults, or an ad. Such an entry is shown to people with an account only. */
export const LABELS = ['adult', 'ad'];
/** The app's own settings in the account (kind 30791, d = 'feed'): the audience new entries start with. */
export const NAMESPACE = 'feed';
const HEX64 = /^[0-9a-f]{64}$/;

/** #hashtags in a text, lowercased, once each, at most ten. */
export function hashtags(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_][\p{L}\p{N}_-]{1,31})/gu)) {
    const tag = m[2].toLowerCase();
    if (!out.includes(tag)) out.push(tag);
  }
  return out.slice(0, LIMITS.tags);
}

const file = (f) =>
  f && typeof f === 'object' && typeof f.url === 'string' && HEX64.test(String(f.sha256))
    ? { url: f.url.slice(0, 500), sha256: f.sha256, ...(Number(f.width) > 0 ? { width: Math.round(f.width), height: Math.round(Number(f.height) || 0) } : {}) }
    : null;

/** A photo as an entry carries it (what uploadMedia returned), or null when it is not one. */
export function cleanMedia(m) {
  const main = file(m);
  if (!main) return null;
  return {
    ...main,
    size: Math.max(0, Number(m.size) || 0),
    mime: String(m.mime || 'application/octet-stream').slice(0, 80),
    ...(HEX64.test(String(m.key || '')) ? { key: m.key } : {}),
    ...(file(m.thumb) ? { thumb: file(m.thumb) } : {}),
  };
}

/** What an entry says, checked: text, photos, hashtags, the writer's name, when it was first posted (ms). Null when it says nothing. */
export function cleanEntry(v) {
  if (!v || typeof v !== 'object') return null;
  const text = String(v.text || '').slice(0, LIMITS.text);
  const media = (Array.isArray(v.media) ? v.media : []).map(cleanMedia).filter(Boolean).slice(0, LIMITS.media);
  if (!text.trim() && !media.length) return null;
  const tags = (Array.isArray(v.tags) ? v.tags : [])
    .map((x) => String(x).toLowerCase().slice(0, LIMITS.tag))
    .filter(Boolean)
    .slice(0, LIMITS.tags);
  const label = LABELS.includes(v.label) ? v.label : '';
  return { text, media, tags, name: String(v.name || '').slice(0, LIMITS.name), at: Number(v.at) > 0 ? Number(v.at) : 0, label };
}

/** An entry's route: `#/e/<author>/<d>`, with the space and hints in the query (ui/spaces.ts). */
export const entryHash = (entry, query = '') => `#/e/${entry.pubkey}/${encodeURIComponent(entry.d)}${query ? `?${query}` : ''}`;

export class FeedData {
  /**
   * @param {{ db: any, pool: any, sync: any }} net  the feed's content network (a space's relays, or the mount's)
   * @param {{ sk: string, pk: string, alias?: string | null }} identity
   * @param {{ space?: any, audiences: () => any }} options
   *   space: the one this feed serves (shared/spaces.js), none for a feed on no space;
   *   audiences: the runtime's Audiences (a function: the runtime makes a new one when the identity changes)
   */
  constructor(net, identity, { space = null, audiences }) {
    this.net = net;
    this.identity = identity;
    this.space = space;
    this.seal = new SpaceSeal(net, identity, { space, audiences }); // the space's key and the audiences' (shared/sealed.js)
    this.cache = new Map(); // event id -> Promise<opened | null>
  }

  /** Does an event belong to this feed: in its space, or in none for a feed on no space? */
  inSpace(ev) {
    return this.seal.inSpace(ev);
  }

  /** The key `kid` of `author`'s, when this device has it: the space's, one of mine, or one I was given. */
  key(author, kid) {
    return this.seal.key(author, kid);
  }

  /** Who an entry is for, as the page names it: 'space', one of my audiences ('friends', 'c:…', 'me'), or 'shared' (I am in one of theirs). */
  audienceOf(ev) {
    return this.seal.audienceOf(ev);
  }

  /** An entry, opened; null when this device holds no key for it (it is not for me) or it does not open. */
  openEntry(ev) {
    let p = this.cache.get(ev.id);
    if (!p) {
      p = this.readEntry(ev);
      this.cache.set(ev.id, p);
      p.then((r) => r || this.cache.delete(ev.id)); // a key may arrive later: try again then
    }
    return p;
  }

  async readEntry(ev) {
    if (ev.kind !== KINDS.FEED_ENTRY) return null;
    const opened = await this.seal.open(ev);
    if (!opened) return null;
    const { value: v, k, kid, audience } = opened;
    const address = addressOf(ev);
    const base = { address, d: address.split(':').slice(2).join(':'), pubkey: ev.pubkey, event: ev, id: ev.id, kid, k, audience, created_at: ev.created_at };
    if (v?.del) return { ...base, deleted: true, text: '', media: [], tags: [], name: '', at: ev.created_at * 1000 };
    const clean = cleanEntry(v);
    return clean ? { ...base, ...clean, at: clean.at || ev.created_at * 1000 } : null;
  }

  /** A comment on `entry`, opened with the entry's key; null when it does not open. */
  openComment(entry, ev) {
    const id = `${ev.id}:${entry.kid}`;
    let p = this.cache.get(id);
    if (!p) {
      p = this.readComment(entry, ev);
      this.cache.set(id, p);
      p.then((r) => r || this.cache.delete(id)); // its key may arrive later
    }
    return p;
  }

  async readComment(entry, ev) {
    const k = this.key(entry.pubkey, keyTag(ev)) || (keyTag(ev) === entry.kid ? entry.k : null);
    if (!k) return null;
    let v;
    try {
      v = await open(k, ev.content);
    } catch {
      return null;
    }
    const address = addressOf(ev);
    if (v?.del) return { address, id: ev.id, pubkey: ev.pubkey, deleted: true };
    const text = String(v?.text || '')
      .slice(0, LIMITS.comment)
      .trim();
    if (!text) return null;
    return { address, d: address.split(':').slice(2).join(':'), id: ev.id, pubkey: ev.pubkey, text, name: String(v.name || '').slice(0, LIMITS.name), at: Number(v.at) || ev.created_at * 1000 };
  }

  // ---- writing ----

  /** The key a post to `audience` is sealed with: the space's, or the current key of one of my audiences. */
  sealFor(audience) {
    return this.seal.sealFor(audience);
  }

  /** What every event of this feed carries: its space (with a relay where it lives), the key it is sealed with. */
  tags(kid = null) {
    return this.seal.tags(kid);
  }

  /**
   * Post an entry, or a new version of one (`d`, `at` of the old). Returns the event. `label`: 'adult' or 'ad', inside the seal.
   * @param {{ text: string, media?: any[], audience: string, d?: string, at?: number, label?: string }} entry
   */
  async post({ text, media = [], audience, d = randomId(), at = Date.now(), label = '' }) {
    const value = cleanEntry({ text, media, tags: hashtags(text), name: this.identity.alias || '', at, label });
    if (!value) throw fail('fd.error.empty', 'Write something or add a photo.');
    const { k, kid } = await this.sealFor(audience);
    const ev = makeAddressable(KINDS.FEED_ENTRY, d, await seal(k, { v: 1, ...value }), this.identity.sk, this.tags(kid));
    await this.net.sync.publish(ev);
    return ev;
  }

  /** Delete an entry everywhere: a tombstone under the same key, so whoever could read it learns it is gone. */
  async remove(entry) {
    const ev = makeAddressable(KINDS.FEED_ENTRY, entry.d, await seal(entry.k, { del: 1, u: Date.now() }), this.identity.sk, this.tags(entry.kid));
    await this.net.sync.publish(ev);
  }

  /** A comment on `entry`, sealed with the entry's key. */
  async comment(entry, text) {
    const clean = String(text || '')
      .trim()
      .slice(0, LIMITS.comment);
    if (!clean) return null;
    const value = { text: clean, name: this.identity.alias || '', at: Date.now() };
    const ev = makeAddressable(KINDS.FEED_COMMENT, randomId(), await seal(entry.k, value), this.identity.sk, [['a', entry.address], ...this.tags(entry.kid)]);
    await this.net.sync.publish(ev);
    return ev;
  }

  async removeComment(entry, comment) {
    const ev = makeAddressable(KINDS.FEED_COMMENT, comment.d, await seal(entry.k, { del: 1, u: Date.now() }), this.identity.sk, [['a', entry.address], ...this.tags(entry.kid)]);
    await this.net.sync.publish(ev);
  }

  /** Like an entry, or take the like back. The newest reaction of a person counts. */
  async like(entry, on) {
    const ev = sign(
      {
        kind: KINDS.REACTION,
        created_at: stamp(`like:${entry.address}`),
        tags: [['a', entry.address], ['p', entry.pubkey], ['k', String(KINDS.FEED_ENTRY)], ...this.tags()],
        content: on ? '+' : '',
      },
      this.identity.sk,
    );
    await this.net.sync.publish(ev);
    return ev;
  }

  /**
   * Report an entry (NIP-56): to the space's moderators, the relays and other people. `type` 'adult' or
   * 'ad' asks for a mark instead of a fold: a report of type other carrying the mark (NIP-32).
   */
  async report(entry, type, note = '') {
    const mark = MARKS.includes(type) ? type : null;
    const kind = mark ? 'other' : type;
    const ev = sign(
      {
        kind: KINDS.REPORT,
        created_at: now(),
        tags: [
          ['p', entry.pubkey, kind],
          ['e', entry.id, kind],
          ['a', entry.address],
          ['k', String(KINDS.FEED_ENTRY)],
          ...(mark ? markTags(mark) : []),
          ...this.tags(),
        ],
        content: String(note || '').slice(0, 500),
      },
      this.identity.sk,
    );
    await this.net.sync.publish(ev, { wait: 'one' });
    return ev;
  }

  /**
   * A moderator's mark on an entry (NIP-32, kind 1985): 'adult', 'ad', or 'none' (fine as it is). It is
   * stamped after `after`, the newest report or mark seen on it (Social.lastAt), so it reviews all of them.
   */
  async mark(entry, mark, after = 0) {
    const ev = sign(
      {
        kind: KINDS.LABEL,
        created_at: Math.max(now(), after + 1),
        tags: [...markTags(mark), ['a', entry.address], ['p', entry.pubkey], ['k', String(KINDS.FEED_ENTRY)], ...this.tags()],
        content: '',
      },
      this.identity.sk,
    );
    await this.net.sync.publish(ev, { wait: 'one' });
    return ev;
  }
}

/**
 * A route in the feed: the feed, one entry, one person, the settings.
 * @param {string} hash
 * @returns {{ page: 'feed' } | { page: 'settings' } | { page: 'person', pk: string } | { page: 'entry', pk: string, d: string, params: URLSearchParams }}
 */
export function parseRoute(hash) {
  const h = String(hash || '');
  const e = /^#\/e\/([0-9a-f]{64})\/([^/?]+)(?:\?(.*))?$/.exec(h);
  if (e) return { page: 'entry', pk: e[1], d: decodeURIComponent(e[2]), params: new URLSearchParams(e[3] || '') };
  const p = /^#\/p\/([0-9a-f]{64})/.exec(h);
  if (p && isHex64(p[1])) return { page: 'person', pk: p[1] };
  if (h.startsWith('#/settings')) return { page: 'settings' };
  return { page: 'feed' };
}
