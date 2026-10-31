// Live rooms: a link's #secret names a room and is the key everything in it
// is sealed with. Messages and presence are ephemeral nostr events (kinds
// 21710 and 21700) tagged with the room's id, a hash of the secret: relays
// pass them to whoever is in the room right now and keep nothing, so a room
// has no history and is gone when the last person leaves. Everyone speaks
// under a key made for this visit, so relays learn no identity; the nickname
// travels inside the sealed content. This is what EnigmaJS did, on nostr.
//
//   const room = new Room(secret, net, { nick: 'ada' });
//   room.onChange(fn);  await room.join();  await room.say('hi');  room.leave();

import { KINDS, deriveKey, hex, now, open, seal } from '../../../shared/events.js';
import { bytesToHex, finalizeEvent, generateSecretKey, getPublicKey, sha256 } from '../../../shared/nostr.mjs';
import { randomSecret } from '../../../shared/p2p.js';

const te = new TextEncoder();
const PING = 30_000; // presence every 30 s, and at once when someone new appears; someone quiet for 75 s has left
const GONE = 75;
export const NICK = 24;
export const TEXT = 2000;
const KEEP = 500; // messages kept on screen

export { randomSecret };

/** The public name of a room on the relays: a hash, never the secret. */
export const roomId = (secret) => hex(sha256(te.encode(`wjs|room|chat|${secret}`)));

export class Room {
  /**
   * @param {string} secret  from the link's fragment
   * @param {{ pool: any }} net
   * @param {{ nick?: string }} [options]
   */
  constructor(secret, net, { nick = '' } = {}) {
    this.secret = secret;
    this.id = roomId(secret);
    this.key = deriveKey(bytesToHex(te.encode(secret)), 'wjs/room/chat');
    this.net = net;
    this.nick = String(nick || '').slice(0, NICK);
    this.sk = generateSecretKey(); // this visit's voice
    this.pk = getPublicKey(this.sk);
    this.messages = [];
    this.members = new Map(); // pk -> { nick, at }
    this.seen = new Set();
    this.listeners = new Set();
  }

  async join() {
    this.sub = this.net.pool.subscribe([{ kinds: [KINDS.ROOM_MESSAGE, KINDS.P2P_PRESENCE], '#h': [this.id] }], { onevent: (ev) => this.receive(ev) });
    this.members.set(this.pk, { nick: this.nick, at: now(), me: true });
    await this.ping();
    this.timer = setInterval(() => this.ping().catch(() => {}), PING);
    this.sweep = setInterval(() => this.prune(), PING / 2);
    this.emit();
  }

  leave() {
    clearInterval(this.timer);
    clearInterval(this.sweep);
    this.sub?.close();
    this.sub = null;
  }

  async setNick(nick) {
    this.nick = String(nick || '').slice(0, NICK);
    this.members.set(this.pk, { nick: this.nick, at: now(), me: true });
    this.emit();
    if (this.sub) await this.ping();
  }

  /** Tell the room we are here (and what we are called). */
  ping() {
    return this.publish(KINDS.P2P_PRESENCE, { nick: this.nick });
  }

  async say(text) {
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!content) return;
    await this.publish(KINDS.ROOM_MESSAGE, { nick: this.nick, text: content });
  }

  async publish(kind, body) {
    const event = finalizeEvent({ kind, created_at: now(), tags: [['h', this.id]], content: await seal(this.key, body) }, this.sk);
    if (kind === KINDS.ROOM_MESSAGE) this.take(event, body); // our own at once, whatever the relays do
    await this.net.pool.publish(event);
  }

  async receive(ev) {
    if (this.seen.has(ev.id) || !ev.tags.some((x) => x[0] === 'h' && x[1] === this.id)) return;
    let body;
    try {
      body = await open(this.key, ev.content);
    } catch {
      return; // not sealed with this room's key
    }
    this.take(ev, body);
  }

  take(ev, body) {
    if (this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    const nick = String(body?.nick || '').slice(0, NICK);
    const known = this.members.get(ev.pubkey);
    // Someone new: relays keep no presence, so tell them we are here, soon and not all at once.
    if (!known && ev.pubkey !== this.pk && this.sub) setTimeout(() => this.sub && this.ping().catch(() => {}), 200 + Math.random() * 600);
    this.members.set(ev.pubkey, { nick, at: Math.max(ev.created_at, known?.at || 0), me: ev.pubkey === this.pk });
    if (ev.kind === KINDS.ROOM_MESSAGE && typeof body?.text === 'string') {
      // in the order they reach this device: a live room has no history to reconcile, and clocks differ
      this.messages.push({ id: ev.id, from: ev.pubkey, nick, at: ev.created_at, text: body.text.slice(0, TEXT), me: ev.pubkey === this.pk });
      if (this.messages.length > KEEP) this.messages.splice(0, this.messages.length - KEEP);
    }
    this.emit();
  }

  prune() {
    const cut = now() - GONE;
    let changed = false;
    for (const [pk, m] of this.members) {
      if (!m.me && m.at < cut) {
        this.members.delete(pk);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Who is here now, me first. */
  present() {
    return [...this.members.entries()].map(([pk, m]) => ({ pk, ...m })).sort((a, b) => Number(b.me) - Number(a.me) || a.nick.localeCompare(b.nick));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }
}
