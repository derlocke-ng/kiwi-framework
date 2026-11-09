// Spaces: the named, owned communities a hub's mounts serve (docs/architecture.md,
// "Spaces"; docs/protocol.md §12). A space is a NIP-72 community definition,
// kind 34550, under its owner's key, with the space's id as its `d`: its
// address `34550:<owner>:<id>` is what every post in it names in an `a` tag,
// and what a mount reads. Two hubs that name the same owner and id serve the
// same space; a space's relays, when it has some, are a network of their own
// (shared/relays.js), so a mount on it reads and writes there and nowhere else.
//
// The distribution's config seeds a space (name, description, relays,
// moderators, …) so the hub can draw it before any relay answered; the
// definition event rules for an owned space, as the owner's newest word on
// moderators and texts. A space without an owner belongs to its hub's config:
// its key is derived from the hub's id and its own, so the space has an
// address and other nostr clients find a definition, and the hub itself
// publishes that definition when the relays lack it.
import { DISTRIBUTION } from './distribution.js';
import { addressOf, deriveKey, KINDS, keyId, makeAddressable, supersedes } from './events.js';
import { bytesToHex, getPublicKey, hexToBytes, nip19, sha256, verifyEvent } from './nostr.mjs';

/** A space's id: a short slug, the `d` of its definition and the word in a distribution's config. */
export const SPACE_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RELAY = /^wss?:\/\/\S+$/;
const te = new TextEncoder();
const LIMITS = { name: 80, description: 600, rules: 2000 };

const relayUrl = (u) => {
  const s = String(u || '').trim();
  return RELAY.test(s) ? s.replace(/\/$/, '') : null;
};
const relayList = (list) => [...new Set((Array.isArray(list) ? list : []).map(relayUrl).filter(Boolean))];

/** The key of a space nobody owns: made from the hub's id and the space's, so every build of the hub finds the same address. */
export function spaceKey(hubId, spaceId) {
  return bytesToHex(sha256(te.encode(`wjs/space/v1|${hubId}|${spaceId}`)));
}

export const spaceAddress = (owner, id) => `${KINDS.SPACE}:${owner}:${id}`;

/** A moderator as configured, an npub (what a person can copy from their account page) or 64 hex characters, as hex; else null. */
export function moderatorKey(v) {
  const s = String(v || '').trim();
  if (HEX64.test(s)) return s;
  try {
    const { type, data } = nip19.decode(s);
    return type === 'npub' && HEX64.test(String(data)) ? String(data) : null;
  } catch {
    return null;
  }
}

/**
 * The spaces of a distribution, filled in: the owner's key (or the derived one), the address, the
 * network their relays make. The order is the config's.
 * @param {any} config  a DISTRIBUTION
 */
export function resolveSpaces(config) {
  const hubId = String(config?.id || 'hub');
  // the hub's own moderators (its operators) moderate every space the hub defines itself, besides each space's own
  const hubMods = Array.isArray(config?.moderators) ? config.moderators : [];
  return (config?.spaces || []).filter((s) => s && SPACE_ID.test(String(s.id))).map((s) => resolveSpace(s, hubId, hubMods));
}

function resolveSpace(s, hubId, hubMods = []) {
  const id = String(s.id);
  const owned = HEX64.test(String(s.owner || ''));
  const sk = owned ? null : spaceKey(hubId, id);
  const owner = owned ? String(s.owner) : getPublicKey(hexToBytes(sk));
  const relays = relayList(s.relays);
  return {
    id,
    owner,
    owned,
    /** the derived secret key of a space nobody owns; null for an owned one */
    sk,
    address: spaceAddress(owner, id),
    name: String(s.name || id).slice(0, LIMITS.name),
    description: String(s.description || '').slice(0, LIMITS.description),
    relays,
    /** the network a mount on this space is on: its own relays, or null for the mount's */
    network: relays.length ? `space:${id}` : null,
    // an owned space's moderators are its owner's to name (its definition); a space the hub defines also has the hub's
    moderators: [...new Set([...(Array.isArray(s.moderators) ? s.moderators : []), ...(owned ? [] : hubMods)].map(moderatorKey).filter(Boolean))],
    adult: Boolean(s.adult),
    langs: (Array.isArray(s.langs) ? s.langs : []).map(String).filter((l) => /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l)),
    region: String(s.region || '').slice(0, 40),
    rules: String(s.rules || '').slice(0, LIMITS.rules),
  };
}

/** The hub's spaces, as configured (shared/hubconfig.js adjusts their relays from hub.local.json before anything connects). */
export const SPACES = resolveSpaces(DISTRIBUTION);
export const spaceById = (id) => SPACES.find((s) => s.id === id) || null;
export const spaceByAddress = (address) => SPACES.find((s) => s.address === address) || null;
/** Is `network` a space's own ('space:<id>')? */
export const isSpaceNetwork = (network) => /^space:/.test(String(network || ''));
/** The spaces with relays of their own: each is a network, `space:<id>` → relays. */
export const spaceNetworks = () => Object.fromEntries(SPACES.filter((s) => s.network).map((s) => [s.network, [...s.relays]]));
/** A space's relays changed (hub.local.json): its network follows. */
export function setSpaceRelays(space, relays) {
  space.relays = relayList(relays);
  space.network = space.relays.length ? `space:${space.id}` : null;
}

/**
 * The key "the space" as an audience is sealed with: derived from the space's address, which is public, so
 * everyone using a hub that serves the space reads what is posted to it, and relays, crawlers and other
 * clients see ciphertext. Not a secret: a way to keep a community's posts off plain view.
 * @returns {{ k: Uint8Array, kid: string }}
 */
export function spaceReadKey(space) {
  const k = deriveKey(bytesToHex(sha256(te.encode(space.address))), 'wjs/space/read/v1');
  return { k, kid: keyId(k) };
}

/** Does `pk` moderate this space: its owner, or one of the moderators named? */
export const isModerator = (space, pk) => Boolean(space && pk && (space.owner === pk || space.moderators.includes(pk)));

/**
 * The definition event of a space, from what the hub knows of it: the NIP-72 tags other clients read
 * (name, description, relay, p … moderator) and ours (adult, lang, region, rules).
 * @param {ReturnType<typeof resolveSpace>} space
 * @param {string} skHex  the owner's key, or the derived key of a space nobody owns
 */
export function buildSpaceDefinition(space, skHex) {
  const tags = [
    ['name', space.name],
    ...(space.description ? [['description', space.description]] : []),
    ...space.relays.map((r) => ['relay', r]),
    ...space.moderators.map((p) => ['p', p, '', 'moderator']),
    ...(space.adult ? [['adult', '1']] : []),
    ...space.langs.map((l) => ['lang', l]),
    ...(space.region ? [['region', space.region]] : []),
    ...(space.rules ? [['rules', space.rules]] : []),
  ];
  return makeAddressable(KINDS.SPACE, space.id, '', skHex, tags);
}

/** A definition event read back, or null when it is not one. */
export function parseSpaceDefinition(ev) {
  if (!ev || ev.kind !== KINDS.SPACE || !Array.isArray(ev.tags)) return null;
  const tag = (k) => ev.tags.filter((t) => t[0] === k);
  const id = tag('d')[0]?.[1];
  if (!id || !SPACE_ID.test(id)) return null;
  return {
    address: addressOf(ev),
    owner: ev.pubkey,
    id,
    name: String(tag('name')[0]?.[1] || id).slice(0, LIMITS.name),
    description: String(tag('description')[0]?.[1] || '').slice(0, LIMITS.description),
    relays: relayList(tag('relay').map((t) => t[1])),
    moderators: [...new Set(tag('p').filter((t) => t[3] === 'moderator' && HEX64.test(String(t[1]))).map((t) => t[1]))],
    adult: tag('adult').some((t) => t[1] === '1' || t[1] === 'true'),
    langs: tag('lang').map((t) => String(t[1])),
    region: String(tag('region')[0]?.[1] || '').slice(0, 40),
    rules: String(tag('rules')[0]?.[1] || '').slice(0, LIMITS.rules),
    created_at: ev.created_at,
    event: ev,
  };
}

/** Do a definition and the config say the same (what a hub would republish for a space nobody owns)? */
export const sameDefinition = (a, b) =>
  Boolean(a && b) &&
  a.name === b.name &&
  a.description === b.description &&
  a.relays.join() === b.relays.join() &&
  [...a.moderators].sort().join() === [...b.moderators].sort().join() &&
  a.adult === b.adult &&
  a.langs.join() === b.langs.join() &&
  a.region === b.region &&
  a.rules === b.rules;

/** The `a` tag a post in a space carries: the space's address and, as NIP-72 wants, a relay where the post lives. */
export const spaceTag = (space, relayHint = null) => (relayHint ? ['a', space.address, relayHint] : ['a', space.address]);

/** The space address a post names, or null for a post in no space. */
export function spaceOf(event) {
  const prefix = `${KINDS.SPACE}:`;
  return (event?.tags || []).find((t) => t[0] === 'a' && String(t[1]).startsWith(prefix))?.[1] || null;
}

/** `s=<address>` for a link into a space, or ''. */
export const spaceQuery = (space) => (space ? `s=${encodeURIComponent(space.address)}` : '');

/** The space address a link's query names, when well-formed. */
export function readSpaceParam(params) {
  const s = typeof params?.get === 'function' ? params.get('s') : null;
  return s && /^\d{5}:[0-9a-f]{64}:[a-z0-9-]{2,40}$/.test(s) ? s : null;
}

/**
 * The hub's spaces as the relays know them: the newest definition per space, read from the space's
 * own network (or the hub's), and the config's definition published for a space nobody owns when
 * the relays lack it or say something else. `get(id)` is the live view a page draws.
 */
export class Spaces {
  /**
   * @param {{ db: any, pool: any, sync: any }} net  the whole network (every relay)
   * @param {{ spaces?: any[] }} [options]
   */
  constructor(net, { spaces = SPACES } = {}) {
    this.net = net;
    this.spaces = spaces;
    /** address -> parsed definition (the newest seen) */
    this.defs = new Map();
    this.listeners = new Set();
    this.subs = [];
    this.published = new Set();
  }

  async start() {
    if (!this.spaces.length) return this;
    const { db, pool } = this.net;
    const filter = { kinds: [KINDS.SPACE], authors: [...new Set(this.spaces.map((s) => s.owner))], '#d': [...new Set(this.spaces.map((s) => s.id))] };
    this.offStore = db.subscribe((ev) => this.receive(ev)); // listen first, then read: nothing lands unseen in between
    for (const ev of await db.query([filter])) this.receive(ev);
    // each space on its own network: a definition is read where the space's posts are
    const byNetwork = new Map();
    for (const s of this.spaces) {
      const n = s.network || 'hub';
      if (!byNetwork.has(n)) byNetwork.set(n, []);
      byNetwork.get(n).push(s);
    }
    for (const [network, list] of byNetwork) {
      const f = { kinds: [KINDS.SPACE], authors: [...new Set(list.map((s) => s.owner))], '#d': [...new Set(list.map((s) => s.id))] };
      this.subs.push(
        pool.subscribe([f], {
          network,
          onevent: (ev) => db.put(ev, network),
          oneose: () => setTimeout(() => this.seed(list), 300), // the relays have spoken: fill in what they lack
        }),
      );
    }
    return this;
  }

  stop() {
    this.offStore?.();
    for (const s of this.subs) s.close();
    this.subs = [];
    this.listeners.clear();
  }

  receive(ev) {
    const def = parseSpaceDefinition(ev);
    if (!def || !verifyEvent(ev)) return;
    const space = this.spaces.find((s) => s.address === def.address);
    if (!space) return;
    const cur = this.defs.get(def.address);
    if (cur && !supersedes(ev, cur.event)) return;
    this.defs.set(def.address, def);
    for (const fn of this.listeners) fn(space.id);
  }

  /** A space nobody owns gets the config's definition on its relays when they have none, or an older or different one. */
  async seed(list) {
    for (const space of list) {
      if (space.owned || this.published.has(space.id)) continue;
      const have = this.defs.get(space.address);
      if (have && sameDefinition(have, space)) continue;
      this.published.add(space.id);
      try {
        await this.publish(space);
      } catch {
        this.published.delete(space.id);
      }
    }
  }

  /** Publish the config's definition of a space: with `skHex` the owner's key, else the derived key of a space nobody owns. */
  async publish(space, skHex = space.sk) {
    if (!skHex) throw new Error('this space is owned: its owner publishes the definition');
    const ev = buildSpaceDefinition(space, skHex);
    await this.net.db.put(ev, space.network || 'hub');
    await this.net.sync.publish(ev, { network: space.network || 'hub' });
    return ev;
  }

  /** The newest definition the relays gave for a space, or null. */
  definition(id) {
    const space = this.spaces.find((s) => s.id === id);
    return space ? this.defs.get(space.address) || null : null;
  }

  /**
   * A space as the page shows it: the config, and for an owned space the definition's name, texts and
   * moderators on top (the relays stay as built). Null for an unknown id.
   */
  get(id) {
    const space = this.spaces.find((s) => s.id === id);
    if (!space) return null;
    const def = this.defs.get(space.address);
    if (!def || !space.owned) return { ...space, definition: def || null };
    return { ...space, name: def.name, description: def.description, moderators: def.moderators, adult: def.adult, langs: def.langs, region: def.region, rules: def.rules, definition: def };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
