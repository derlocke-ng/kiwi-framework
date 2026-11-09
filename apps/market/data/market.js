// The market's data: listings (kind 30830), sealed like the feed's entries
// (shared/sealed.js): to the space, with the key derived from its address, or
// to one of the seller's audiences (friends, a circle). A listing expires
// (NIP-40), so a market holds what is on offer now; renewing republishes it.
//
// Search without plain words on the relays: a listing to the space carries
// search labels (NIP-32 `l` tags), keyed hashes under the space key of what a
// buyer filters by: its category, the country it is in, where it ships, and
// the pairs of those. A buyer in Austria looking for seeds asks for the
// labels of "seeds shipping to AT, to the EU or worldwide"; the relays match
// codes and learn no word. Anyone who knows the space computes the same codes:
// the labels keep a listing's category and countries off plain view, they do
// not make them secret. Free-text search runs on the device over what came.
//
// Buyers reach a seller in the chat (a message with the listing's link
// drafted), or by the contact the seller wrote, shown on request.
import { addressOf, isHex64, KINDS, makeAddressable, now, seal, sign } from '../../../shared/events.js';
import { destinationsFor, isCountry, isDestination } from '../../../shared/countries.js';
import { keyTag, SpaceSeal } from '../../../shared/sealed.js';
import { sellerTags } from '../../../shared/sellers.js';
import { fail, randomId } from '../../../shared/util.js';

export { keyTag };

export const CATEGORIES = ['seeds', 'cuttings', 'gear', 'other'];
export const STATUSES = ['open', 'reserved', 'sold'];
export const DURATIONS = [30, 60, 90]; // days a listing lives
export const LIMITS = { title: 100, text: 3000, price: 40, media: 8, contact: 200, ships: 30, name: 40 };
/** The app's own settings in the account (kind 30791, d = 'market'): my country, a default contact, saved listings. */
export const NAMESPACE = 'market';
const HEX64 = /^[0-9a-f]{64}$/;

const file = (f) =>
  f && typeof f === 'object' && typeof f.url === 'string' && HEX64.test(String(f.sha256))
    ? { url: f.url.slice(0, 500), sha256: f.sha256, ...(Number(f.width) > 0 ? { width: Math.round(f.width), height: Math.round(Number(f.height) || 0) } : {}) }
    : null;

/** A photo as a listing carries it (what uploadMedia returned), or null. */
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

/** What a listing says, checked; null when it lacks a title, a category or a country. */
export function cleanListing(v) {
  if (!v || typeof v !== 'object') return null;
  const title = String(v.title || '')
    .trim()
    .slice(0, LIMITS.title);
  const category = CATEGORIES.includes(v.category) ? v.category : null;
  const from = isCountry(v.from) ? v.from : null;
  if (!title || !category || !from) return null;
  const ships = [...new Set((Array.isArray(v.ships) ? v.ships : []).map(String).filter(isDestination))].slice(0, LIMITS.ships);
  return {
    title,
    text: String(v.text || '').slice(0, LIMITS.text),
    category,
    price: String(v.price || '')
      .trim()
      .slice(0, LIMITS.price),
    from,
    ships,
    pickup: Boolean(v.pickup) || !ships.length,
    media: (Array.isArray(v.media) ? v.media : []).map(cleanMedia).filter(Boolean).slice(0, LIMITS.media),
    contact: String(v.contact || '')
      .trim()
      .slice(0, LIMITS.contact),
    status: STATUSES.includes(v.status) ? v.status : 'open',
    name: String(v.name || '').slice(0, LIMITS.name),
    at: Number(v.at) > 0 ? Number(v.at) : 0,
  };
}

/** The words a listing can be found by: its category, its country, where it ships, pickup, and the pairs a buyer filters by. */
export function wordsOf(listing) {
  const c = listing.category;
  return [
    `cat:${c}`,
    `from:${listing.from}`,
    ...listing.ships.flatMap((d) => [`to:${d}`, `cat:${c}|to:${d}`]),
    ...(listing.pickup ? [`pickup:${listing.from}`, `cat:${c}|pickup:${listing.from}`] : []),
  ];
}

/**
 * The words a buyer asks the relays for (any of them matches): a category, listings that reach a country
 * (shipping to it, to the EU when it is a member, or worldwide), or pickup in that country. Null: no filter.
 * @param {{ category?: string | null, country?: string | null, pickup?: boolean }} search
 */
export function searchWords({ category = null, country = null, pickup = false }) {
  const cat = CATEGORIES.includes(category) ? category : null;
  if (country && isCountry(country)) {
    if (pickup) return [cat ? `cat:${cat}|pickup:${country}` : `pickup:${country}`];
    return destinationsFor(country).map((d) => (cat ? `cat:${cat}|to:${d}` : `to:${d}`));
  }
  return cat ? [`cat:${cat}`] : null;
}

/** A listing's route: `#/l/<seller>/<d>`, with the space and hints in the query (ui/spaces.ts). */
export const listingHash = (listing, query = '') => `#/l/${listing.pubkey}/${encodeURIComponent(listing.d)}${query ? `?${query}` : ''}`;

/** The expiration a listing carries (NIP-40), in seconds, or 0. */
export const expiresAt = (ev) => Number(ev?.tags?.find((t) => t[0] === 'expiration')?.[1]) || 0;

export class MarketData {
  /**
   * @param {{ db: any, pool: any, sync: any }} net  the market's content network (a space's relays, or the mount's)
   * @param {{ sk: string, pk: string, alias?: string | null }} identity
   * @param {{ space?: any, audiences: () => any }} options
   */
  constructor(net, identity, { space = null, audiences }) {
    this.net = net;
    this.identity = identity;
    this.space = space;
    this.seal = new SpaceSeal(net, identity, { space, audiences });
    this.cache = new Map(); // event id -> Promise<opened | null>
  }

  inSpace(ev) {
    return this.seal.inSpace(ev);
  }

  /** The labels to ask the relays for (`#l`), for a buyer's search; null: ask for everything in the space. */
  labelsFor(search) {
    const words = searchWords(search);
    return words ? this.seal.query(words) : null;
  }

  /** A listing, opened; null when this device holds no key for it or it does not open. Expired ones say so. */
  openListing(ev) {
    let p = this.cache.get(ev.id);
    if (!p) {
      p = this.readListing(ev);
      this.cache.set(ev.id, p);
      p.then((r) => r || this.cache.delete(ev.id)); // a key may arrive later
    }
    return p;
  }

  async readListing(ev) {
    if (ev.kind !== KINDS.MARKET_LISTING) return null;
    const opened = await this.seal.open(ev);
    if (!opened) return null;
    const { value: v, k, kid, audience } = opened;
    const address = addressOf(ev);
    const exp = expiresAt(ev);
    const base = { address, d: address.split(':').slice(2).join(':'), pubkey: ev.pubkey, event: ev, id: ev.id, kid, k, audience, created_at: ev.created_at, expires: exp };
    if (v?.del) return { ...base, deleted: true };
    const clean = cleanListing(v);
    if (!clean) return null;
    return { ...base, ...clean, at: clean.at || ev.created_at * 1000, expired: exp > 0 && exp <= now() };
  }

  /**
   * Post a listing, or a new version of one (`d`, `at` of the old). It lives `days` days from now.
   * @param {object} listing  title, text, category, price, from, ships, pickup, media, contact, status
   * @param {{ audience?: string, days?: number, d?: string, at?: number }} [options]
   */
  async post(listing, { audience = 'space', days = 30, d = randomId(), at = Date.now() } = {}) {
    const value = cleanListing({ ...listing, name: this.identity.alias || '', at });
    if (!value) throw fail('mk.error.incomplete', 'A listing needs a title, a category and a country.');
    const { k, kid } = await this.seal.sealFor(audience);
    const created = now();
    const tags = [
      ...this.seal.tags(kid),
      ['expiration', String(created + Math.min(90, Math.max(1, days)) * 86_400)],
      // search labels only for the space: a listing for friends is found by its seller, not by what it is
      ...(audience === 'space' ? this.seal.labels(wordsOf(value)) : []),
    ];
    const ev = makeAddressable(KINDS.MARKET_LISTING, d, await seal(k, { v: 1, ...value }), this.identity.sk, tags);
    await this.net.sync.publish(ev);
    return ev;
  }

  /** The same listing with another status (reserved, sold, open again), keeping when it expires. */
  async setStatus(listing, status) {
    if (!STATUSES.includes(status)) throw new Error(`no such status: ${status}`);
    const days = Math.max(1, Math.ceil((listing.expires - now()) / 86_400));
    return this.post({ ...listing, status }, { audience: listing.audience === 'shared' ? 'space' : listing.audience, days, d: listing.d, at: listing.at });
  }

  /** Delete a listing everywhere: a tombstone under the same key, gone from relays in a day. */
  /**
   * A moderator's decision on a seller (NIP-32, kind 1985, wjs/seller): 'approved' or 'revoked'. Stamped after
   * `after`, the newest decision seen, so the one made last is the one that counts.
   */
  async decideSeller(pk, decision, after = 0) {
    const ev = sign({ kind: KINDS.LABEL, created_at: Math.max(now(), after + 1), tags: [...sellerTags(pk, decision), ...this.seal.tags()], content: '' }, this.identity.sk);
    await this.net.sync.publish(ev, { wait: 'one' });
    return ev;
  }

  async remove(listing) {
    const tags = [...this.seal.tags(listing.kid), ['expiration', String(now() + 86_400)]];
    const ev = makeAddressable(KINDS.MARKET_LISTING, listing.d, await seal(listing.k, { del: 1, u: Date.now() }), this.identity.sk, tags);
    await this.net.sync.publish(ev);
  }

  /** Report a listing (NIP-56): to the space's moderators, the relays and other people. */
  async report(listing, type, note = '') {
    const ev = sign(
      {
        kind: KINDS.REPORT,
        created_at: now(),
        tags: [['p', listing.pubkey, type], ['e', listing.id, type], ['a', listing.address], ['k', String(KINDS.MARKET_LISTING)], ...this.seal.tags()],
        content: String(note || '').slice(0, 500),
      },
      this.identity.sk,
    );
    await this.net.sync.publish(ev, { wait: 'one' });
    return ev;
  }
}

/**
 * A route in the market: the listings, one listing, one seller, the settings.
 * @param {string} hash
 * @returns {{ page: 'home' } | { page: 'settings' } | { page: 'seller', pk: string } | { page: 'listing', pk: string, d: string, params: URLSearchParams }}
 */
export function parseRoute(hash) {
  const h = String(hash || '');
  const l = /^#\/l\/([0-9a-f]{64})\/([^/?]+)(?:\?(.*))?$/.exec(h);
  if (l) return { page: 'listing', pk: l[1], d: decodeURIComponent(l[2]), params: new URLSearchParams(l[3] || '') };
  const s = /^#\/s\/([0-9a-f]{64})/.exec(h);
  if (s && isHex64(s[1])) return { page: 'seller', pk: s[1] };
  if (h.startsWith('#/settings')) return { page: 'settings' };
  return { page: 'home' };
}
