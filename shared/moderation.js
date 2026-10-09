// Blocking and reporting, the nostr way.
//
// Block list: NIP-51 mute list (kind 10000), with every entry in the private,
// NIP-44-encrypted part so relays and other people never see who you blocked.
// Other nostr clients that know your key read the same list. Apps consult
// isBlocked() before showing a post, accepting a message or a friend request.
//
// Reports: NIP-56 (kind 1984) tell relay operators and other clients about
// spam, illegal content, impersonation…; they are public and signed by you.

import { KINDS, now, sign } from './events.js';
import { nip44, hexToBytes, getPublicKey } from './nostr.mjs';

export const REPORT_TYPES = ['spam', 'illegal', 'impersonation', 'nudity', 'malware', 'profanity', 'other'];

const selfKey = (skHex) => nip44.v2.utils.getConversationKey(hexToBytes(skHex), getPublicKey(hexToBytes(skHex)));

/** Decrypt the private entries of a kind 10000 event with the owner's secret key. */
export async function readBlockList(event, skHex) {
  if (!event?.content) return [];
  try {
    const tags = JSON.parse(nip44.v2.decrypt(event.content, selfKey(skHex)));
    return tags.filter((t) => Array.isArray(t) && t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1])).map((t) => ({ pubkey: t[1], reason: t[2] || '' }));
  } catch {
    return [];
  }
}

/** A kind 10000 event holding these entries privately. */
export function buildBlockList(entries, skHex) {
  const tags = entries.map((e) => (e.reason ? ['p', e.pubkey, e.reason] : ['p', e.pubkey]));
  return sign({ kind: KINDS.MUTE_LIST, created_at: now(), tags: [], content: nip44.v2.encrypt(JSON.stringify(tags), selfKey(skHex)) }, skHex);
}

/** A NIP-56 report of a person or one of their events. */
export function buildReport({ pubkey, eventId = null, type = 'other', text = '' }, skHex) {
  const kind = REPORT_TYPES.includes(type) ? type : 'other';
  const tags = [['p', pubkey, kind]];
  if (eventId) tags.push(['e', eventId, kind]);
  return sign({ kind: KINDS.REPORT, created_at: now(), tags, content: text.slice(0, 500) }, skHex);
}

/** The account's block list, live from the local store and the relays. */
export class BlockList {
  constructor(identity, net) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.net = net;
    this.entries = [];
    this.listeners = new Set();
    this.seq = 0;
  }

  get filter() {
    return { kinds: [KINDS.MUTE_LIST], authors: [this.pk] };
  }

  async start() {
    const { db, pool } = this.net;
    for (const ev of (await db.query([this.filter])).reverse()) await this.receive(ev);
    this.offStore = db.subscribe((ev) => {
      if (ev.kind === KINDS.MUTE_LIST && ev.pubkey === this.pk) this.receive(ev);
    });
    this.sub = pool.subscribe([this.filter], { onevent: (ev) => db.put(ev) });
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
  }

  async receive(ev) {
    const n = ++this.seq;
    const entries = await readBlockList(ev, this.sk);
    if (this.seq !== n) return;
    this.entries = entries;
    for (const fn of this.listeners) fn(this.entries);
  }

  list() {
    return [...this.entries];
  }

  isBlocked(pubkey) {
    return this.entries.some((e) => e.pubkey === pubkey);
  }

  async block(pubkey, reason = '') {
    if (this.isBlocked(pubkey)) return;
    await this.save([...this.entries, { pubkey, reason }]);
  }

  async unblock(pubkey) {
    await this.save(this.entries.filter((e) => e.pubkey !== pubkey));
  }

  async save(entries) {
    this.entries = entries;
    for (const fn of this.listeners) fn(this.entries);
    await this.net.sync.publish(buildBlockList(entries, this.sk));
  }

  /** Tell the relays about someone; resolves when the first relay took the report. */
  report(details) {
    return this.net.sync.publish(buildReport(details, this.sk), { wait: 'one' });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
