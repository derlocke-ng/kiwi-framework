// Posts sealed in a space, for any app on one (the feed's entries, the
// market's listings): sealed to "the space" with the key derived from its
// address (shared/spaces.js), or to one of the writer's audiences (friends, a
// circle, only me: shared/audiences.js). An event names the key it is sealed
// with in a `key` tag (the key's id), so a reader knows which of the keys it
// holds opens it; a reader without the key never sees the post.
//
// Search labels: what a relay may filter on without reading it. A label is a
// keyed hash of a word (`cat:seeds`, `to:DE`) under the space key, so a relay
// matches labels a reader asks for while it sees opaque codes; anyone who
// knows the space computes the same codes, so a label keeps a word off plain
// view, it does not make it secret (as the space key itself).
//
//   const seal = new SpaceSeal(net, identity, { space, audiences: () => kiwi.audiences });
//   const { k, kid } = await seal.sealFor('space');   // or 'friends', 'c:<id>', 'me'
//   makeAddressable(kind, d, await seal(k, value), sk, [...seal.tags(kid), ...seal.labels(['cat:seeds'])])
//   const opened = await seal.open(ev);                // { value, k, kid, audience } or null
import { deriveKey, open } from './events.js';
import { bytesToHex } from './nostr.mjs';
import { spaceOf, spaceReadKey, spaceTag } from './spaces.js';
import { fail } from './util.js';

/** The id of the key an event is sealed with (its `key` tag), or null. */
export const keyTag = (ev) => ev?.tags?.find((t) => t[0] === 'key')?.[1] || null;

/** A search label: the keyed hash of a word under a space's key, 16 hex characters. */
export const blindLabel = (k, word) => bytesToHex(deriveKey(bytesToHex(k), `wjs/label/v1|${word}`)).slice(0, 16);

/** The namespace of our labels (NIP-32 `L`), so other clients know they are not words. */
export const LABEL_NAMESPACE = 'wjs/label';

export class SpaceSeal {
  /**
   * @param {{ pool: any }} net  the app's content network (a relay of it goes into the space tag)
   * @param {{ pk: string }} identity
   * @param {{ space?: any, audiences: () => any }} options  space: the mount's (none: the app is on no space)
   */
  constructor(net, identity, { space = null, audiences }) {
    this.net = net;
    this.identity = identity;
    this.space = space;
    this.audiences = audiences;
    this.spaceKey = space ? spaceReadKey(space) : null;
  }

  /** Does an event belong to this app's page: in its space, or in none for an app on no space? */
  inSpace(ev) {
    return spaceOf(ev) === (this.space?.address || null);
  }

  /** The key `kid` of `author`'s, when this device has it: the space's, one of mine, or one I was given. */
  key(author, kid) {
    if (!kid) return null;
    if (this.spaceKey && kid === this.spaceKey.kid) return this.spaceKey.k;
    return this.audiences()?.key(author, kid) || null;
  }

  /** Who a post is for, as a page names it: 'space', one of my audiences ('friends', 'c:…', 'me'), or 'shared' (I am in one of theirs). */
  audienceOf(ev) {
    const kid = keyTag(ev);
    if (this.spaceKey && kid === this.spaceKey.kid) return 'space';
    if (ev.pubkey === this.identity.pk) return this.audiences()?.audienceOf(kid) || 'me';
    return 'shared';
  }

  /** The key a post to `audience` is sealed with: the space's, or the current key of one of my audiences. */
  async sealFor(audience) {
    if (audience === 'space') {
      if (!this.spaceKey) throw fail('fd.error.noSpace', 'This page serves no space.');
      return this.spaceKey;
    }
    const { k, kid } = await this.audiences().current(audience);
    return { k, kid };
  }

  /** What every post of the page carries: its space (with a relay where it lives) and, sealed, the key's id. */
  tags(kid = null) {
    const relay = this.net.pool.urls?.[0] || null;
    return [...(this.space ? [spaceTag(this.space, relay)] : []), ...(kid ? [['key', kid]] : [])];
  }

  /** Search labels for these words: NIP-32 `l` tags in our namespace, keyed with the space's key (none on no space). */
  labels(words) {
    if (!this.spaceKey || !words.length) return [];
    return [['L', LABEL_NAMESPACE], ...[...new Set(words)].map((w) => ['l', blindLabel(this.spaceKey.k, w), LABEL_NAMESPACE])];
  }

  /** The labels to ask relays for (`#l`), for words a reader is looking for. */
  query(words) {
    return this.spaceKey ? [...new Set(words)].map((w) => blindLabel(this.spaceKey.k, w)) : [];
  }

  /** A post's content opened with the key it names: { value, k, kid, audience }, or null (no key, not this page's, does not open). */
  async open(ev) {
    if (!this.inSpace(ev)) return null;
    const kid = keyTag(ev);
    const k = this.key(ev.pubkey, kid);
    if (!k) return null;
    try {
      return { value: await open(k, ev.content), k, kid, audience: this.audienceOf(ev) };
    } catch {
      return null;
    }
  }
}
