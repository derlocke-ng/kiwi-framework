// Friends, circles and sharing for every app. Friends are mutual: a request
// and an accept, both delivered as NIP-59 gift wraps, so relays see neither
// who asked nor who answered, only that some key received a wrapped note.
// Friends, circles, pending requests and received shares are one encrypted
// settings event under the user's key (kind 30791, d = 'people'), so every
// device signed in as you agrees. Nothing here is ever public.
//
//   const people = await new People(identity, net, { isBlocked }).start();
//   people.request(pk) · accept(pk) · ignore(pk) · cancel(pk) · remove(pk)
//   people.friends() · isFriend(pk) · nameOf(pk) · circles() · circleCreate(name) · membersOf(id)
//   people.share('loadout', { type: 'board', url, … }, pks)   // to friends (a circle's members via membersOf)
//   people.onShare('loadout', (share) => { …; people.consume(share.id); })
import { KINDS, now, fingerprint, isHex64 } from './events.js';
import { nip59, hexToBytes } from './nostr.mjs';
import { AccountSettings } from './settings.js';
import { randomId, fail } from './util.js';

const INBOX_DAYS = 30; // gift wraps carry a date randomised up to two days back; this is how far an inbox looks
const MAX_SEEN = 500;
const MAX_SHARES = 100;
const NAME = 40;

export class People {
  /**
   * @param {{ sk: string, pk: string, alias?: string|null }} identity
   * @param {{ pool: import('./relays.js').RelayPool, db: import('./store.js').LocalStore, sync: import('./sync.js').Sync }} net
   * @param {{ isBlocked?: (pk: string) => boolean }} [options]
   */
  constructor(identity, net, { isBlocked = () => false } = {}) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.alias = String(identity.alias || '').slice(0, NAME);
    this.net = net;
    this.isBlocked = isBlocked;
    this.settings = new AccountSettings(identity, net, 'people');
    this.listeners = new Set();
    this.shareListeners = new Map(); // app -> Set(fn)
    this.queue = Promise.resolve();
  }

  get filter() {
    return { kinds: [KINDS.GIFT_WRAP], '#p': [this.pk], since: now() - INBOX_DAYS * 86_400 };
  }

  async start() {
    await this.settings.start();
    this.settings.onChange(() => this.emit());
    const { db, pool } = this.net;
    const forMe = (ev) => ev.kind === KINDS.GIFT_WRAP && ev.tags.some((x) => x[0] === 'p' && x[1] === this.pk);
    for (const ev of (await db.query([{ kinds: [KINDS.GIFT_WRAP], '#p': [this.pk] }])).reverse()) this.receive(ev);
    this.offStore = db.subscribe((ev) => forMe(ev) && this.receive(ev));
    this.sub = pool.subscribe([this.filter], { onevent: (ev) => db.put(ev) });
    await this.queue;
    return this;
  }

  stop() {
    this.sub?.close();
    this.offStore?.();
    this.settings.stop();
  }

  // ---- what we hold ----

  friends() {
    return [...this.settings.get('friends', [])];
  }

  isFriend(pk) {
    return this.friends().some((f) => f.pk === pk);
  }

  /** A friend's name (what they called themselves), else the key's fingerprint. */
  nameOf(pk) {
    return this.friends().find((f) => f.pk === pk)?.name || fingerprint(pk);
  }

  incoming() {
    return [...this.settings.get('incoming', [])];
  }

  outgoing() {
    return [...this.settings.get('outgoing', [])];
  }

  circles() {
    return [...this.settings.get('circles', [])];
  }

  membersOf(id) {
    return [...(this.circles().find((c) => c.id === id)?.members || [])];
  }

  /** Shares received and not yet taken by their app. */
  shares(app = null) {
    return this.settings.get('shares', []).filter((s) => !app || s.app === app);
  }

  // ---- friends ----

  /** Ask someone to be friends; accepts them instead when they asked first. */
  async request(pk) {
    if (!isHex64(pk) || pk === this.pk) throw fail('people.error.key', 'That is not someone else’s public key.');
    if (this.isFriend(pk)) return 'friends';
    if (this.incoming().some((r) => r.pk === pk)) return this.accept(pk);
    // Marked as asked before the wrap goes out, so a request crossing ours is recognised as mutual.
    await this.settings.set({ outgoing: [...this.outgoing().filter((r) => r.pk !== pk), { pk, at: now() }] });
    await this.send(pk, KINDS.FRIEND_REQUEST, { name: this.alias });
    if (this.incoming().some((r) => r.pk === pk)) return this.accept(pk); // they asked while we were sending
    return this.isFriend(pk) ? 'friends' : 'requested';
  }

  async accept(pk) {
    const req = this.incoming().find((r) => r.pk === pk);
    await this.send(pk, KINDS.FRIEND_ACCEPT, { name: this.alias });
    await this.settings.set({
      friends: this.withFriend(pk, req?.name),
      incoming: this.incoming().filter((r) => r.pk !== pk),
      outgoing: this.outgoing().filter((r) => r.pk !== pk),
    });
    return 'friends';
  }

  ignore(pk) {
    return this.settings.set({ incoming: this.incoming().filter((r) => r.pk !== pk) });
  }

  cancel(pk) {
    return this.settings.set({ outgoing: this.outgoing().filter((r) => r.pk !== pk) });
  }

  /** Friends are mutual: both sides drop each other. */
  async remove(pk) {
    await this.settings.set({ friends: this.friends().filter((f) => f.pk !== pk), circles: this.without(pk) });
    this.send(pk, KINDS.FRIEND_REMOVE, {}, { wait: false }).catch(() => {});
  }

  withFriend(pk, name) {
    const known = this.friends().find((f) => f.pk === pk);
    return [...this.friends().filter((f) => f.pk !== pk), { pk, name: String(name || known?.name || '').slice(0, NAME), since: known?.since || now() }];
  }

  without(pk) {
    return this.circles().map((c) => ({ ...c, members: c.members.filter((m) => m !== pk) }));
  }

  // ---- circles ----

  async circleCreate(name) {
    const id = randomId(6);
    await this.settings.set({ circles: [...this.circles(), { id, name: String(name).trim().slice(0, NAME), members: [] }] });
    return id;
  }

  circleRemove(id) {
    return this.settings.set({ circles: this.circles().filter((c) => c.id !== id) });
  }

  circleSet(id, members) {
    const keep = [...new Set(members)].filter((m) => this.isFriend(m));
    return this.settings.set({ circles: this.circles().map((c) => (c.id === id ? { ...c, members: keep } : c)) });
  }

  // ---- sharing ----

  /** Send a payload to friends; `payload.url` is what a notice opens. Returns how many it went to. */
  async share(app, payload, pks) {
    const to = [...new Set(pks)].filter((pk) => this.isFriend(pk));
    await Promise.all(to.map((pk) => this.send(pk, KINDS.SHARE, { app, payload })));
    return to.length;
  }

  /** Called with every share for `app`: those already waiting, then new ones as they arrive. */
  onShare(app, fn) {
    if (!this.shareListeners.has(app)) this.shareListeners.set(app, new Set());
    this.shareListeners.get(app).add(fn);
    for (const s of this.shares(app)) fn(s);
    return () => this.shareListeners.get(app).delete(fn);
  }

  handles(app) {
    return (this.shareListeners.get(app)?.size || 0) > 0;
  }

  /** The app took this share: it stops waiting. */
  consume(id) {
    if (!this.shares().some((s) => s.id === id)) return Promise.resolve();
    return this.settings.set({ shares: this.shares().filter((s) => s.id !== id) });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  // ---- the wire ----

  async send(toPk, kind, content, { wait = true } = {}) {
    const rumor = { kind, created_at: now(), tags: [['p', toPk]], content: JSON.stringify(content) };
    const wrap = nip59.wrapEvent(rumor, hexToBytes(this.sk), toPk);
    await this.net.sync.publish(wrap, wait ? { wait: 'one' } : {});
  }

  receive(ev) {
    this.queue = this.queue.then(() => this.handle(ev)).catch(() => {});
    return this.queue;
  }

  async handle(ev) {
    const seen = this.settings.get('seen', []);
    if (seen.includes(ev.id)) return;
    let rumor;
    try {
      rumor = nip59.unwrapEvent(ev, hexToBytes(this.sk)); // verifies the seal's signature and that the rumor is the sealer's
    } catch {
      return this.markSeen(ev.id);
    }
    const from = rumor.pubkey;
    if (!isHex64(from) || from === this.pk || this.isBlocked(from)) return this.markSeen(ev.id);
    let body = {};
    try {
      body = JSON.parse(rumor.content || '{}') || {};
    } catch {
      body = {};
    }
    const name = String(body.name || '').slice(0, NAME);
    const patch = {};
    if (rumor.kind === KINDS.FRIEND_REQUEST) {
      if (this.isFriend(from)) {
        this.send(from, KINDS.FRIEND_ACCEPT, { name: this.alias }).catch(() => {}); // they asked again; we still are
      } else if (this.outgoing().some((r) => r.pk === from)) {
        patch.friends = this.withFriend(from, name); // both asked: friends
        patch.outgoing = this.outgoing().filter((r) => r.pk !== from);
        this.send(from, KINDS.FRIEND_ACCEPT, { name: this.alias }).catch(() => {});
      } else {
        patch.incoming = [...this.incoming().filter((r) => r.pk !== from), { pk: from, name, at: rumor.created_at }];
      }
    } else if (rumor.kind === KINDS.FRIEND_ACCEPT) {
      if (this.outgoing().some((r) => r.pk === from) || this.isFriend(from)) {
        patch.friends = this.withFriend(from, name);
        patch.outgoing = this.outgoing().filter((r) => r.pk !== from);
      } else {
        patch.incoming = [...this.incoming().filter((r) => r.pk !== from), { pk: from, name, at: rumor.created_at }]; // an accept we never asked for is a request
      }
    } else if (rumor.kind === KINDS.FRIEND_REMOVE) {
      patch.friends = this.friends().filter((f) => f.pk !== from);
      patch.incoming = this.incoming().filter((r) => r.pk !== from);
      patch.outgoing = this.outgoing().filter((r) => r.pk !== from);
      patch.circles = this.without(from);
    } else if (rumor.kind === KINDS.SHARE) {
      if (this.isFriend(from) && typeof body.app === 'string' && body.payload && typeof body.payload === 'object') {
        const share = { id: ev.id, app: body.app.slice(0, 32), from, name: this.nameOf(from), payload: body.payload, at: rumor.created_at };
        patch.shares = [...this.shares().filter((s) => s.id !== ev.id), share].slice(-MAX_SHARES);
        for (const fn of this.shareListeners.get(share.app) || []) fn(share);
      }
    }
    await this.settings.set({ ...patch, seen: [...seen, ev.id].slice(-MAX_SEEN) });
  }

  markSeen(id) {
    return this.settings.set({ seen: [...this.settings.get('seen', []), id].slice(-MAX_SEEN) });
  }
}
