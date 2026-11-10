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
// Replies, reactions, edits, pins and deletions (0.30) are rumors of their
// own in the same wraps, and a conversation's timer makes its messages
// disappear; shared/chatlog.js has the rules, the store keeps the changes
// beside the messages, and messages() hands them out folded. This page also
// reads a group's messages through here (shared/groups.js stores them).
//
//   const dm = await new DirectMessages(identity, net, { isBlocked }).start();
//   await dm.send(pk, 'hello', { reply });   dm.onChange(fn);   await dm.messages(pk)
//   await dm.react(pk, message, '👍');  dm.edit(pk, message, text);  dm.remove(pk, message);  dm.pin(pk, message, true)
//   await dm.setTimer(pk, 86_400);  await dm.search('words')

import { CHANGE_KINDS, changeOf, cleanTimer, fold, matches, myReactions, pinsOf, replyOf, searchable } from './chatlog.js';
import { expiryOf, isHex64, KINDS, now } from './events.js';
import { cleanFile, fileFromRumor, fileTags } from './files.js';
import { baseStore, whole } from './peers.js';
import { myRelays, relaysTag } from './relaylists.js';
import { finalizeEvent, generateSecretKey, hexToBytes, nip44, nip59 } from './nostr.mjs';
import { store } from './util.js';

const INBOX_DAYS = 30; // gift wraps carry a date randomised up to two days back; this is how far an inbox looks
export const TEXT = 4000;
const SEEN_MAX = 4000;
const NAME = 40; // a writer's name inside a message, as long as an alias
const PEOPLE_KINDS = [KINDS.FRIEND_REQUEST, KINDS.FRIEND_ACCEPT, KINDS.FRIEND_REMOVE, KINDS.SHARE]; // People unwraps these itself
const PURGE_EVERY = 30_000; // how often what has run out is forgotten (the screens hide it at once)
const TWO_DAYS = 2 * 86_400;

/**
 * A gift wrap (NIP-59) of a rumor for one reader; with `expires`, the wrap carries NIP-40's `expiration` too,
 * so a relay drops it when the message goes (nostr-tools' createWrap takes no tags).
 */
function wrapFor(rumor, sk, to, expires = 0) {
  const sealed = nip59.createSeal(rumor, sk, to);
  if (!expires) return nip59.createWrap(sealed, to);
  const key = generateSecretKey();
  const content = nip44.encrypt(JSON.stringify(sealed), nip44.getConversationKey(key, to));
  const created_at = Math.round(now() - Math.random() * TWO_DAYS); // NIP-59: a time up to two days back, as createWrap does
  return finalizeEvent({ kind: KINDS.GIFT_WRAP, content, created_at, tags: [['p', to], ['expiration', String(expires)]] }, key);
}

export class DirectMessages {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {{ pool: any, db: any, sync: any }} net
   * @param {{ isBlocked?: (pk: string) => boolean, peers?: import('./peers.js').PeerNetworks | null, reach?: any }} [options]
   *   peers: which network each person is reached on (a hub with a public area); none: the hub's
   *   reach: their inbox relays (shared/relaylists.js), where a sealed note goes besides the network's own
   */
  constructor(identity, net, { isBlocked = () => false, peers = null, reach = null } = {}) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.alias = identity.alias || ''; // travels inside each message, so the reader can name me before we are friends
    this.net = net;
    this.peers = peers;
    this.reach = reach;
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
    // wraps for me arrive on every network the hub has; each is stored as its network's, and tells where its writer is reached
    const db = baseStore(this.net.db);
    const pool = whole(this.net.pool);
    const forMe = (ev) => ev.kind === KINDS.GIFT_WRAP && ev.tags.some((x) => x[0] === 'p' && x[1] === this.pk);
    // listen first, then read: a wrap stored between the two would be lost to this page otherwise (`seen` keeps it to one handling)
    this.offStore = db.subscribe((ev, network) => forMe(ev) && this.receive(ev, network));
    for (const ev of await db.query([{ kinds: [KINDS.GIFT_WRAP], '#p': [this.pk] }])) this.receive(ev);
    this.offChat = db.subscribeChat(() => this.emit());
    this.sub = pool.subscribe([{ kinds: [KINDS.GIFT_WRAP], '#p': [this.pk], since: now() - INBOX_DAYS * 86_400 }], { onevent: (ev, url) => db.put(ev, pool.networkOf?.(url) || 'hub') });
    await this.queue;
    this.ready = true;
    // disappearing messages: what has run out goes from this device too (the relays drop their copies themselves)
    this.purge().catch(() => {});
    this.purger = setInterval(() => this.purge().catch(() => {}), PURGE_EVERY);
    this.purger.unref?.(); // in node (the tests), it does not keep the process alive
    return this;
  }

  /** Forget messages, changes and wraps whose time is up. */
  purge() {
    return baseStore(this.net.db).purgeExpired();
  }

  /** The network someone is reached on: where their notes came from, else this page's. */
  networkOf(pk) {
    return this.peers?.of(pk) || 'hub';
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
    this.offChat?.();
    if (this.purger) clearInterval(this.purger);
  }

  /** A wrap for this key: unwrapped once, in order. `network`: where it arrived, when known. */
  receive(ev, network = null) {
    if (this.seen.has(ev.id)) return this.queue;
    this.queue = this.queue.then(() => this.handle(ev, network)).catch(() => {});
    return this.queue;
  }

  async handle(ev, network = null) {
    if (this.seen.has(ev.id)) return;
    let rumor;
    try {
      rumor = nip59.unwrapEvent(ev, hexToBytes(this.sk)); // verifies the seal and that the rumor is the sealer's
    } catch {
      return this.markSeen(ev.id);
    }
    if (network && isHex64(rumor.pubkey) && rumor.pubkey !== this.pk) this.peers?.learn(rumor.pubkey, network);
    // where the writer reads, as they told us inside the seal: the way back to them
    const told = relaysTag(rumor);
    if (told.length && isHex64(rumor.pubkey) && rumor.pubkey !== this.pk) this.peers?.learnRelays?.(rumor.pubkey, network, told);
    if (CHANGE_KINDS.includes(rumor.kind) || rumor.kind === KINDS.CHAT_TIMER) return this.handleChange(rumor, ev);
    if (rumor.kind !== KINDS.CHAT_MESSAGE && rumor.kind !== KINDS.CHAT_FILE) {
      // another module's rumor: the groups' knocks and keys, the audiences' keys come through here; People's are its own
      const handlers = this.rumorHandlers.get(rumor.kind);
      for (const fn of handlers || []) fn(rumor, ev, network);
      // a kind nothing on this page handles stays unmarked: a later version that knows it still gets it on its next start
      if (!handlers?.size && !PEOPLE_KINDS.includes(rumor.kind)) return;
      return this.markSeen(ev.id);
    }
    const from = rumor.pubkey;
    const to = rumor.tags.find((x) => x[0] === 'p')?.[1];
    const other = from === this.pk ? to : from;
    if (!isHex64(from) || !isHex64(other) || this.isBlocked(other)) return this.markSeen(ev.id);
    // `at` is the writer's second, `t` its millisecond (an `ms` tag of ours; other clients ignore it), `seq` when this
    // device took it: two messages in one second keep the writers' order on every device, not the relay's.
    const ms = Math.min(999, Math.max(0, Number(rumor.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
    const name = String(rumor.tags.find((x) => x[0] === 'name')?.[1] || '').slice(0, NAME); // what the writer calls themselves, sealed with the text
    // a file message (NIP-17 kind 15) carries the file instead of text; one we cannot read is dropped
    const file = rumor.kind === KINDS.CHAT_FILE ? fileFromRumor(rumor) : null;
    if (rumor.kind === KINDS.CHAT_FILE && !file) return this.markSeen(ev.id);
    const text = file ? '' : String(rumor.content || '').slice(0, TEXT);
    // a reply names the message it answers; a message of a conversation with a timer says when it goes
    const reply = replyOf(rumor);
    const expires = expiryOf(rumor);
    if (expires && expires <= now()) return this.markSeen(ev.id);
    const message = {
      id: rumor.id,
      conv: other,
      from,
      name,
      at: rumor.created_at,
      t: rumor.created_at * 1000 + ms,
      seq: Date.now(),
      text,
      ...(file ? { file } : {}),
      ...(reply ? { reply } : {}),
      ...(expires ? { expires } : {}),
      wrap: ev.id,
    };
    if (!(await this.net.db.hasMessage(message.id))) {
      await this.net.db.putMessage(message);
      if (this.ready && from !== this.pk) for (const fn of this.messageListeners) fn(message);
    }
    this.markSeen(ev.id);
  }

  /** A reaction, an edit, a pin, a deletion or a timer in a conversation (shared/chatlog.js). */
  async handleChange(rumor, ev) {
    const from = rumor.pubkey;
    const to = rumor.tags.find((x) => x[0] === 'p')?.[1];
    const other = from === this.pk ? to : from;
    if (!isHex64(from) || !isHex64(other) || this.isBlocked(other)) return this.markSeen(ev.id);
    const ms = Math.min(999, Math.max(0, Number(rumor.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
    const t = rumor.created_at * 1000 + ms;
    if (rumor.kind === KINDS.CHAT_TIMER) {
      // the conversation's timer: the newest setting wins, on both sides; a line in the conversation says who set it
      let seconds = 0;
      try {
        seconds = cleanTimer(JSON.parse(rumor.content || '{}').seconds);
      } catch {}
      const key = `timer:${other}`;
      const cur = await this.net.db.getMeta(key);
      if (!cur || cur.t < t || (cur.t === t && cur.id < rumor.id)) await this.net.db.setMeta(key, { seconds, t, id: rumor.id });
      if (!(await this.net.db.hasMessage(rumor.id)))
        await this.net.db.putMessage({ id: rumor.id, conv: other, from, name: '', at: rumor.created_at, t, seq: Date.now(), text: '', system: 'timer', timer: seconds, wrap: ev.id });
      else this.emit();
      return this.markSeen(ev.id);
    }
    const change = changeOf(rumor, { conv: other, from, t });
    if (change && !(change.expires && change.expires <= now())) await baseStore(this.net.db).putChange(change);
    this.markSeen(ev.id);
  }

  markSeen(id) {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen = new Set([...this.seen].slice(-SEEN_MAX / 2));
    store.set(this.seenKey, [...this.seen]);
  }

  /**
   * Send text to one person; resolves once a relay has the reader's copy. The writer's copy follows through the outbox.
   * `reply`: the id of the message it answers. With the conversation's timer on, it carries when it goes.
   */
  async send(toPk, text, { reply = '' } = {}) {
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!content) return null;
    return this.deliver(toPk, KINDS.CHAT_MESSAGE, content, isHex64(reply) ? [['e', reply]] : [], { expires: await this.expiresFor(toPk) });
  }

  /** Send a file uploaded with shared/files.js (uploadFile) to one person, as a NIP-17 file message. */
  async sendFile(toPk, file, { reply = '' } = {}) {
    const f = cleanFile(file);
    if (!f) throw new Error('not a file');
    return this.deliver(toPk, KINDS.CHAT_FILE, f.url, [...(isHex64(reply) ? [['e', reply]] : []), ...fileTags(f)], { expires: await this.expiresFor(toPk) });
  }

  /** When a message sent now goes, by the conversation's timer: 0 when it stays. */
  async expiresFor(pk) {
    const seconds = await this.timerOf(pk);
    return seconds ? now() + seconds : 0;
  }

  /** The conversation's timer in seconds (0: messages stay), as the newest setting by either side says. */
  async timerOf(pk) {
    return cleanTimer((await this.net.db.getMeta(`timer:${pk}`))?.seconds);
  }

  /** Make the messages of a conversation disappear after `seconds` (0: they stay), for both sides; a line says who set it. */
  setTimer(pk, seconds) {
    return this.deliver(pk, KINDS.CHAT_TIMER, JSON.stringify({ seconds: cleanTimer(seconds) }), [], { name: false });
  }

  // ---- changes to a message (shared/chatlog.js); each goes when the message does ----

  /** React with an emoji; one reaction a person, so a new one takes the place of the last. */
  react(pk, message, emoji) {
    return this.change(pk, message, KINDS.REACTION, emoji, [['k', String(message.file ? KINDS.CHAT_FILE : KINDS.CHAT_MESSAGE)]]);
  }

  /** Take my reaction back: a deletion (NIP-09) of each I gave it. */
  async unreact(pk, message) {
    const mine = myReactions(await this.net.db.changes(pk), message.id, this.pk);
    if (!mine.length) return null;
    return this.deliver(pk, KINDS.DELETION, '', [...mine.map((id) => ['e', id]), ['k', String(KINDS.REACTION)]], { expires: message.expires || 0, name: false });
  }

  /** New text for a message of mine; both sides show it as edited. */
  edit(pk, message, text) {
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!content || message.from !== this.pk || message.file) return null;
    return this.change(pk, message, KINDS.CHAT_EDIT, content);
  }

  /** Delete a message of mine for both sides (a client that does not know NIP-09 for messages still shows it). */
  remove(pk, message) {
    if (message.from !== this.pk) return null;
    return this.change(pk, message, KINDS.DELETION, '', [['k', String(message.file ? KINDS.CHAT_FILE : KINDS.CHAT_MESSAGE)]]);
  }

  /** Pin a message to the top of the conversation, or take it down; either side may. */
  pin(pk, message, on = true) {
    return this.change(pk, message, KINDS.CHAT_PIN, on ? 'pin' : 'unpin');
  }

  change(pk, message, kind, content, extra = []) {
    return this.deliver(pk, kind, content, [['e', message.id], ...extra], { expires: message.expires || 0, name: false });
  }

  /**
   * A rumor of the conversation, wrapped for the reader and for my other devices. Resolves with the rumor (its id
   * is what replies and changes name). `expires`: when it goes (NIP-40, on the rumor and both wraps); `name`: false
   * leaves my name out (a change needs none).
   */
  async deliver(toPk, kind, content, extra = [], { expires = 0, name = true } = {}) {
    const ms = Date.now();
    const network = this.networkOf(toPk);
    const tags = [
      ['p', toPk],
      ['ms', String(ms % 1000)],
      ...(name && this.alias ? [['name', this.alias.slice(0, NAME)]] : []),
      ...extra,
      ...(expires ? [['expiration', String(expires)]] : []),
      ...this.relaysFor(network),
    ];
    const sk = hexToBytes(this.sk);
    const rumor = nip59.createRumor({ kind, created_at: Math.floor(ms / 1000), tags, content }, sk);
    const theirs = wrapFor(rumor, sk, toPk, expires);
    const mine = wrapFor(rumor, sk, this.pk, expires);
    const { sync } = this.net;
    await whole(sync).publish(theirs, { wait: 'one', network }); // to the reader, on their network
    this.reach?.deliver(toPk, network, theirs).catch(() => {}); // and where they read, when that is elsewhere
    await sync.publish(mine); // to my other devices, on the hub's; the store takes it and the message shows up through handle()
    return rumor;
  }

  /**
   * The newest `limit` messages of a conversation (a person, or a group) before `before`, oldest first, as they are
   * now: edits, reactions, pins and deletions applied, what ran out left out, and each reply with the message it
   * answers (`replyTo`, null when this device does not have it).
   */
  async messages(conv, options) {
    const [list, changes] = await Promise.all([this.net.db.messages(conv, options), this.net.db.changes(conv)]);
    const shown = fold(list, changes, this.pk);
    const byId = new Map(shown.map((m) => [m.id, m]));
    for (const id of new Set(shown.map((m) => m.reply).filter((id) => id && !byId.has(id)))) {
      const m = await this.net.db.getMessage(id);
      const f = m && m.conv === conv ? fold([m], changes, this.pk)[0] : null;
      if (f) byId.set(id, f);
    }
    return shown.map((m) => (m.reply ? { ...m, replyTo: byId.get(m.reply) || null } : m));
  }

  /** The pinned messages of a conversation, newest pin first, each with `pinnedBy`. */
  async pinned(conv) {
    const changes = await this.net.db.changes(conv);
    const out = [];
    for (const p of pinsOf(changes)) {
      const m = await this.net.db.getMessage(p.id);
      const f = m && m.conv === conv ? fold([m], changes, this.pk)[0] : null;
      if (f && !f.deleted) out.push({ ...f, pinnedBy: p.by });
    }
    return out;
  }

  /** Every conversation with its newest message (as it is now), newest first. */
  async conversations() {
    const list = await this.net.db.conversations();
    return Promise.all(list.map(async (c) => fold([c], await this.net.db.changes(c.conv), this.pk)[0] || c));
  }

  /**
   * Messages on this device that hold every word of `query` (their text, or a file's name), in conversations and
   * groups, newest first. Nothing leaves the device.
   */
  async search(query, { limit = 100 } = {}) {
    const words = searchable(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const all = await this.net.db.chatAll();
    const byConv = new Map();
    for (const r of all) {
      if (!r.conv) continue;
      if (!byConv.has(r.conv)) byConv.set(r.conv, { messages: [], changes: [] });
      if (r.at != null) byConv.get(r.conv).messages.push(r);
      else if (r.type) byConv.get(r.conv).changes.push(r);
    }
    const found = [];
    for (const { messages, changes } of byConv.values()) for (const m of fold(messages, changes, this.pk)) if (matches(m, words)) found.push(m);
    return found.sort((a, b) => DirectMessages.timeOf(b) - DirectMessages.timeOf(a)).slice(0, limit);
  }

  /** Every message with a file, in conversations and in groups (`group: true`), newest first. */
  files(options) {
    return this.net.db.files(options);
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

  /**
   * A rumor of another kind to one person, wrapped for them (on their network) and, unless `self` is false,
   * for my other devices. `wait` (default): resolves once a relay has the reader's copy; false: once it is
   * stored and owed to the relays (the outbox delivers it when they are reachable).
   */
  async sendRumor(toPk, kind, body, { self = true, wait = true } = {}) {
    const network = this.networkOf(toPk);
    const rumor = { kind, created_at: now(), tags: [['p', toPk], ...this.relaysFor(network)], content: JSON.stringify(body) };
    const { sync } = this.net;
    const theirs = nip59.wrapEvent(rumor, hexToBytes(this.sk), toPk);
    await whole(sync).publish(theirs, { ...(wait ? { wait: 'one' } : {}), network });
    this.reach?.deliver(toPk, network, theirs).catch(() => {});
    if (self) await sync.publish(nip59.wrapEvent(rumor, hexToBytes(this.sk), this.pk));
  }

  /** The `relays` tag for a sealed note on `network`: where I read on it, so the reader can answer. */
  relaysFor(network) {
    const mine = myRelays(whole(this.net.pool), network);
    return mine.length ? [['relays', ...mine]] : [];
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
