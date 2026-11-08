// Where people are reached: relay lists (NIP-65, kind 10002) and inbox lists
// (NIP-17, kind 10050), and the hints a link carries.
//
// Every person publishes, on each network the hub has, the lists that name
// that network's relays, on that network's relays (and, outside a locked
// hub's own network, on the hub's directory relays). A private hub's relays
// are therefore never named anywhere outside it. To send a sealed note, the
// sender asks for the reader's inbox on the network they are reached on: the
// relays the reader named inside their last sealed note, else their lists
// from the network's relays and the directories; the note goes to those
// relays as guests (shared/relays.js) besides the network's own. Every
// sealed note carries the sender's relays for its network, inside the seal.
//
// A link (a board, a group, a room) carries up to three of the relays where
// its events live, as `r=` hints without the scheme; a hub that opens it
// reads (and writes) there as a guest. A locked hub neither puts hints in
// its links nor follows them: its relays are its own.
import { DISTRIBUTION } from './distribution.js';
import { KINDS, sign } from './events.js';
import { normalizeRelayUrl, relaysLocked } from './relays.js';
import { isSpaceNetwork } from './spaces.js';
import { store } from './util.js';

const MAX = 4;
const LIST_EVERY = 86_400_000; // own lists: published again a day later at the latest, at once when the relays change
const INBOX_TTL = 86_400_000; // someone's inbox from their lists: asked again after a day

/** May this network's links carry hints and its pages follow them? Not a locked hub's own network. */
export const hintsAllowed = (network) => network !== 'hub' || !relaysLocked();

/**
 * The relays where people's lists are asked for and published to, besides the network's own (distribution or
 * hub.local.json). A device can set its own list in `wjs.directory` (an empty list: no directory at all);
 * the browser suites do, so no test ever writes to a real directory.
 */
export function directoryRelays() {
  const own = store.get('wjs.directory');
  return (Array.isArray(own) ? own : DISTRIBUTION.directoryRelays || []).map(normalizeRelayUrl).filter(Boolean);
}

/** Relays as hints for a link: without the scheme (wss is implied, ws for localhost), at most three. */
export const toHints = (urls) => [...new Set((urls || []).map((u) => String(u).replace(/^wss?:\/\//, '')))].slice(0, 3);

/** Hints from a link's query (`r=`), as relay URLs. */
export function readHints(params) {
  const raw = typeof params?.getAll === 'function' ? params.getAll('r') : [];
  return [...new Set(raw.flatMap((r) => String(r).split(',')).map(normalizeRelayUrl).filter(Boolean))].slice(0, 3);
}

/** `r=…&r=…` for a link's query, or ''. */
export const hintQuery = (urls) => toHints(urls)
  .map((h) => `r=${encodeURIComponent(h)}`)
  .join('&');

export const buildRelayList = (urls, skHex) => sign({ kind: KINDS.RELAY_LIST, tags: urls.map((u) => ['r', u]), content: '' }, skHex);
export const buildInboxRelays = (urls, skHex) => sign({ kind: KINDS.INBOX_RELAYS, tags: urls.map((u) => ['relay', u]), content: '' }, skHex);

/** The relays a person reads on, from their lists: the inbox list first, else the relay list's read (and unmarked) relays. */
export function inboxFromLists(events) {
  const newest = (kind) => events.filter((e) => e.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];
  const inbox = newest(KINDS.INBOX_RELAYS);
  if (inbox) return clean(inbox.tags.filter((t) => t[0] === 'relay').map((t) => t[1]));
  const list = newest(KINDS.RELAY_LIST);
  if (list) return clean(list.tags.filter((t) => t[0] === 'r' && t[2] !== 'write').map((t) => t[1]));
  return [];
}

const clean = (urls) => [...new Set(urls.map(normalizeRelayUrl).filter(Boolean))].slice(0, MAX);

export class RelayLists {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {any} pool  the whole pool (every network)
   * @param {{ peers?: any }} [options]  peers: what people told us inside their sealed notes (shared/peers.js)
   */
  constructor(identity, pool, { peers = null } = {}) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.pool = pool;
    this.peers = peers;
    this.key = `wjs.lists.${this.pk.slice(0, 16)}`;
    this.inboxKey = `wjs.inbox.${this.pk.slice(0, 16)}`;
  }

  /** My lists on every network people are reached on (not a space's relays), naming that network's relays; skipped while they are current. */
  async publishOwn({ force = false } = {}) {
    const done = store.get(this.key, {}) || {};
    for (const network of Object.keys(this.pool.networks || {})) {
      if (isSpaceNetwork(network)) continue; // a space's relays carry its posts; people are reached on the hub's or the public network
      const urls = this.pool.urlsOf(network);
      if (!urls.length || !this.pool.onlineOf(network)) continue;
      const sig = urls.join(' ');
      if (!force && done[network]?.sig === sig && Date.now() - (done[network].at || 0) < LIST_EVERY) continue;
      const events = [buildRelayList(urls, this.sk), buildInboxRelays(urls, this.sk)];
      let ok = false;
      for (const ev of events) {
        const res = await this.pool.publish(ev, { network });
        ok ||= res.ok.length > 0;
        if (hintsAllowed(network)) this.pool.publishAt(directoryRelays(), ev).catch(() => {});
      }
      if (ok) done[network] = { sig, at: Date.now() };
    }
    store.set(this.key, done);
  }

  /** The relays `pk` reads on, on `network`: what they told us, else their lists, asked for once a day. */
  async inbox(pk, network) {
    const told = this.peers?.relaysOf?.(pk, network) || [];
    const cache = store.get(this.inboxKey, {}) || {};
    const hit = cache[`${network}:${pk}`];
    let listed = hit && Date.now() - hit.at < INBOX_TTL ? hit.urls : null;
    if (!listed) {
      const filter = [{ kinds: [KINDS.INBOX_RELAYS, KINDS.RELAY_LIST], authors: [pk] }];
      const [own, dir] = await Promise.all([
        this.pool.fetch(filter, { network, ms: 4000 }).catch(() => []),
        hintsAllowed(network) ? this.pool.fetchAt(directoryRelays(), filter, { ms: 4000 }).catch(() => []) : [],
      ]);
      listed = inboxFromLists([...own, ...dir]);
      cache[`${network}:${pk}`] = { urls: listed, at: Date.now() };
      const keys = Object.keys(cache);
      if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete cache[k];
      store.set(this.inboxKey, cache);
    }
    return clean([...told, ...listed]);
  }

  /** A sealed note's way to `pk` beyond the network's own relays: their inbox relays as guests (none on a locked hub's network). */
  async deliver(pk, network, event) {
    if (!hintsAllowed(network)) return [];
    const extra = this.pool.guestUrls(await this.inbox(pk, network), 3);
    return extra.length ? this.pool.publishAt(extra, event) : [];
  }
}

/** The relays to put inside a sealed note on `network`, so the reader can answer: that network's relays. */
export const myRelays = (pool, network) => (pool?.urlsOf ? pool.urlsOf(network).slice(0, MAX) : []);

/** A sealed note's `relays` tag, read back: the writer's relays on the network it came over. */
export const relaysTag = (rumor) => clean((rumor?.tags || []).find((t) => t[0] === 'relays')?.slice(1) || []);
