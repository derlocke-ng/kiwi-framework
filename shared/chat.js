// Private messages between two people (the chat app, Uplink in Armory),
// started by the runtime for every page like People, so the hub shows unread
// counts and any app can send a link into a conversation. NIP-17: a kind 14 rumor (the text,
// a `p` tag for the reader) sealed and gift-wrapped (NIP-59, kind 1059) once
// for the reader and once for the writer's own key, so every device of both
// sees the conversation and relays see only that some key received a wrapped
// note. The wraps live in the event store like everything else (synced,
// healed, backed up); once unwrapped, a message goes into the store's `chat`
// table, which the screens read by conversation. A conversation is the other
// person's public key.
//
//   const dm = await new DirectMessages(identity, net, { isBlocked }).start();
//   await dm.send(pk, 'hello');   dm.onChange(fn);   await net.db.messages(pk)

import { KINDS, isHex64, now } from './events.js';
import { hexToBytes, nip59 } from './nostr.mjs';
import { store } from './util.js';

const INBOX_DAYS = 30; // gift wraps carry a date randomised up to two days back; this is how far an inbox looks
export const TEXT = 4000;
const SEEN_MAX = 4000;

export class DirectMessages {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {{ pool: any, db: any, sync: any }} net
   * @param {{ isBlocked?: (pk: string) => boolean }} [options]
   */
  constructor(identity, net, { isBlocked = () => false } = {}) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.net = net;
    this.isBlocked = isBlocked;
    this.seenKey = `chat.seen.${this.pk.slice(0, 16)}`;
    this.readKey = `chat.read.${this.pk.slice(0, 16)}`;
    this.seen = new Set(store.get(this.seenKey, []));
    this.listeners = new Set();
    this.messageListeners = new Set();
    this.rumorHandlers = new Map(); // kind -> Set(fn): other modules' rumors (groups' knocks and keys)
    this.queue = Promise.resolve();
    this.ready = false; // true once what the device already held is unwrapped: later messages are news
    this.active = null; // the conversation open on this page, which is not announced
  }

  async start() {
    const { db, pool } = this.net;
    const forMe = (ev) => ev.kind === KINDS.GIFT_WRAP && ev.tags.some((x) => x[0] === 'p' && x[1] === this.pk);
    for (const ev of await db.query([{ kinds: [KINDS.GIFT_WRAP], '#p': [this.pk] }])) this.receive(ev);
    this.offStore = db.subscribe((ev) => forMe(ev) && this.receive(ev));
    this.offChat = db.subscribeChat(() => this.emit());
    this.sub = pool.subscribe([{ kinds: [KINDS.GIFT_WRAP], '#p': [this.pk], since: now() - INBOX_DAYS * 86_400 }], { onevent: (ev) => db.put(ev) });
    await this.queue;
    this.ready = true;
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
    this.offChat?.();
  }

  /** A wrap for this key: unwrapped once, in order. */
  receive(ev) {
    if (this.seen.has(ev.id)) return this.queue;
    this.queue = this.queue.then(() => this.handle(ev)).catch(() => {});
    return this.queue;
  }

  async handle(ev) {
    if (this.seen.has(ev.id)) return;
    let rumor;
    try {
      rumor = nip59.unwrapEvent(ev, hexToBytes(this.sk)); // verifies the seal and that the rumor is the sealer's
    } catch {
      return this.markSeen(ev.id);
    }
    if (rumor.kind !== KINDS.CHAT_MESSAGE) {
      // another module's rumor: the groups' knocks and keys come through here; People's are its own
      for (const fn of this.rumorHandlers.get(rumor.kind) || []) fn(rumor, ev);
      return this.markSeen(ev.id);
    }
    const from = rumor.pubkey;
    const to = rumor.tags.find((x) => x[0] === 'p')?.[1];
    const other = from === this.pk ? to : from;
    if (!isHex64(from) || !isHex64(other) || this.isBlocked(other)) return this.markSeen(ev.id);
    // `at` is the writer's second, `t` its millisecond (an `ms` tag of ours; other clients ignore it), `seq` when this
    // device took it: two messages in one second keep the writers' order on every device, not the relay's.
    const ms = Math.min(999, Math.max(0, Number(rumor.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
    const message = { id: rumor.id, conv: other, from, at: rumor.created_at, t: rumor.created_at * 1000 + ms, seq: Date.now(), text: String(rumor.content || '').slice(0, TEXT), wrap: ev.id };
    if (!(await this.net.db.hasMessage(message.id))) {
      await this.net.db.putMessage(message);
      if (this.ready && from !== this.pk) for (const fn of this.messageListeners) fn(message);
    }
    this.markSeen(ev.id);
  }

  markSeen(id) {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen = new Set([...this.seen].slice(-SEEN_MAX / 2));
    store.set(this.seenKey, [...this.seen]);
  }

  /** Send text to one person; resolves once a relay has the reader's copy. The writer's copy follows through the outbox. */
  async send(toPk, text) {
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!content) return null;
    const ms = Date.now();
    const rumor = { kind: KINDS.CHAT_MESSAGE, created_at: Math.floor(ms / 1000), tags: [['p', toPk], ['ms', String(ms % 1000)]], content };
    const theirs = nip59.wrapEvent(rumor, hexToBytes(this.sk), toPk);
    const mine = nip59.wrapEvent(rumor, hexToBytes(this.sk), this.pk);
    const { sync } = this.net;
    await sync.publish(theirs, { wait: 'one' });
    await sync.publish(mine); // the store takes it and the message shows up through handle()
    return rumor;
  }

  /** The newest `limit` messages with one person before `before`, oldest first. */
  messages(pk, options) {
    return this.net.db.messages(pk, options);
  }

  /** Every conversation with its newest message, newest first. */
  conversations() {
    return this.net.db.conversations();
  }

  /** Forget a conversation on this device; the wraps stay where they are and are not unwrapped again here. */
  async forget(pk) {
    await this.net.db.removeConversation(pk);
    this.emit();
  }

  /** Blocked people's conversations go, on every device that applies the block list. */
  async purgeBlocked() {
    let gone = 0;
    for (const c of await this.conversations()) {
      if (this.isBlocked(c.conv)) {
        await this.net.db.removeConversation(c.conv);
        gone++;
      }
    }
    if (gone) this.emit();
  }

  // ---- read state: this device's, in milliseconds (two messages in one second are told apart) ----

  lastRead(pk) {
    return store.get(this.readKey, {})[pk] || 0;
  }

  /** The time of a message: its millisecond when the writer stamped one, else its second. */
  static timeOf(m) {
    return m.t || m.at * 1000;
  }

  markRead(pk, at = Date.now()) {
    const all = store.get(this.readKey, {});
    if ((all[pk] || 0) >= at) return;
    store.set(this.readKey, { ...all, [pk]: at });
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Another module's rumor kind, delivered as it is unwrapped (including the replay at start). */
  onRumor(kind, fn) {
    if (!this.rumorHandlers.has(kind)) this.rumorHandlers.set(kind, new Set());
    this.rumorHandlers.get(kind).add(fn);
    return () => this.rumorHandlers.get(kind)?.delete(fn);
  }

  /** A rumor of another kind to one person, wrapped for them and for my other devices. */
  async sendRumor(toPk, kind, body) {
    const rumor = { kind, created_at: now(), tags: [['p', toPk]], content: JSON.stringify(body) };
    const { sync } = this.net;
    await sync.publish(nip59.wrapEvent(rumor, hexToBytes(this.sk), toPk), { wait: 'one' });
    await sync.publish(nip59.wrapEvent(rumor, hexToBytes(this.sk), this.pk));
  }

  /** Called with every message from someone else that arrives while the page is open (not with what was already here). */
  onMessage(fn) {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  /** The chat tells the runtime which conversation is on screen, so its messages are not announced. */
  setActive(pk) {
    this.active = pk;
  }

  emit() {
    for (const fn of this.listeners) fn();
  }
}
