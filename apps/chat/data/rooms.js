// Live rooms: a link's #secret names a room and is the key everything in it
// is sealed with. Messages and presence are ephemeral nostr events (kinds
// 21710 and 21700) tagged with the room's id, a hash of the secret: relays
// pass them to whoever is in the room right now and keep nothing, so a room
// has no history and is gone when the last person leaves. Everyone speaks
// under a key made for this visit, so relays learn no identity; the nickname
// travels inside the sealed content. This is what EnigmaJS did, on nostr.
//
//   const room = new Room(secret, net, { nick: 'ada' });
//   room.onChange(fn);  room.join();  await room.say('hi');  room.leave();
//
// A tab remembers the rooms it is in (session storage, this tab only): name
// and the visit's key, so a reload puts the person straight back in as the
// same person, not as a newcomer beside a ghost of themselves.

import { KINDS, deriveKey, hex, now, open, seal } from '../../../shared/events.js';
import { bytesToHex, finalizeEvent, generateSecretKey, getPublicKey, hexToBytes, sha256 } from '../../../shared/nostr.mjs';
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

const sessionKey = (id) => `wjs.room.${id.slice(0, 16)}`;
const session = {
  get: (id) => {
    try {
      const v = JSON.parse(sessionStorage.getItem(sessionKey(id)) || 'null');
      return v && typeof v.nick === 'string' && /^[0-9a-f]{64}$/.test(v.sk || '') ? v : null;
    } catch {
      return null;
    }
  },
  set: (id, visit) => {
    try {
      if (visit) sessionStorage.setItem(sessionKey(id), JSON.stringify(visit));
      else sessionStorage.removeItem(sessionKey(id));
    } catch {
      /* no session storage: a reload asks for the name again */
    }
  },
};

/** The visit this tab was in the room with before a reload ({ nick, sk }), or null. */
export const remembered = (secret) => session.get(roomId(secret));

export class Room {
  /**
   * @param {string} secret  from the link's fragment
   * @param {{ pool: any }} net
   * @param {{ nick?: string, sk?: string, relays?: string[] }} [options]  sk: the visit's key from before a reload; relays: guests to follow
   */
  constructor(secret, net, { nick = '', sk = '', relays = [] } = {}) {
    this.secret = secret;
    this.relays = relays; // where the room is besides this hub's relays (a link's hints): followed as guests
    this.id = roomId(secret);
    this.key = deriveKey(bytesToHex(te.encode(secret)), 'wjs/room/chat');
    this.net = net;
    this.nick = String(nick || '').slice(0, NICK);
    this.sk = /^[0-9a-f]{64}$/.test(sk) ? hexToBytes(sk) : generateSecretKey(); // this visit's voice
    this.pk = getPublicKey(this.sk);
    this.messages = [];
    this.members = new Map(); // pk -> { nick, at }
    this.seen = new Set();
    this.listeners = new Set();
    this.onWake = () => {
      // back in the foreground: say we are here (the others may have given us up) and drop who went quiet meanwhile
      if (this.sub && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.prune();
        this.hello().catch(() => {});
      }
    };
  }

  /** In: subscribe, show ourselves, keep showing ourselves. Returns at once; the first ping goes out in the background. */
  join() {
    if (this.sub) return;
    const filter = [{ kinds: [KINDS.ROOM_MESSAGE, KINDS.P2P_PRESENCE], '#h': [this.id] }];
    this.sub = this.net.pool.subscribe(filter, { onevent: (ev) => this.receive(ev) });
    this.guests = this.relays.length && this.net.pool.subscribeAt ? this.net.pool.subscribeAt(this.relays, filter, { onevent: (ev) => this.receive(ev) }) : null;
    this.members.set(this.pk, { nick: this.nick, at: now(), me: true });
    this.hello().catch(() => {});
    this.timer = setInterval(() => this.ping().catch(() => {}), PING);
    this.sweep = setInterval(() => this.prune(), PING / 2);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onWake);
    session.set(this.id, { nick: this.nick, sk: bytesToHex(this.sk) });
    this.emit();
  }

  /** Out: tell the others, so they need not wait for our silence; this tab forgets the room. */
  leave() {
    if (!this.sub) return;
    clearInterval(this.timer);
    clearInterval(this.sweep);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onWake);
    session.set(this.id, null);
    const sub = this.sub;
    this.sub = null;
    const guests = this.guests;
    this.guests = null;
    this.publish(KINDS.P2P_PRESENCE, { nick: this.nick, bye: true })
      .catch(() => {})
      .finally(() => {
        sub.close();
        guests?.close();
      });
  }

  async setNick(nick) {
    this.nick = String(nick || '').slice(0, NICK);
    this.members.set(this.pk, { nick: this.nick, at: now(), me: true });
    this.emit();
    if (this.sub) {
      session.set(this.id, { nick: this.nick, sk: bytesToHex(this.sk) });
      await this.ping();
    }
  }

  /** Tell the room we are here (and what we are called). */
  ping() {
    return this.publish(KINDS.P2P_PRESENCE, { nick: this.nick });
  }

  /** Arriving, or back after a reload or from the background: the others answer, so the list fills now, not at their next ping. */
  hello() {
    return this.publish(KINDS.P2P_PRESENCE, { nick: this.nick, hello: true });
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
    if (this.relays.length && this.net.pool.publishAt) this.net.pool.publishAt(this.relays, event).catch(() => {});
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
    if (ev.kind === KINDS.P2P_PRESENCE && body?.bye) {
      // they left: out of the list now, not after 75 s of silence
      if (ev.pubkey !== this.pk && this.members.delete(ev.pubkey)) this.emit();
      return;
    }
    const nick = String(body?.nick || '').slice(0, NICK);
    const known = this.members.get(ev.pubkey);
    // Someone new, or someone saying hello again (a reload, a return): relays keep no presence, so tell them we are here, soon and not all at once.
    if ((!known || body?.hello) && ev.pubkey !== this.pk && this.sub) setTimeout(() => this.sub && this.ping().catch(() => {}), 200 + Math.random() * 600);
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
