// Groups: a chat that stays until its host closes it, with members by their
// keys. A group is a key pair: its pubkey is where its events live and its
// secret (w) signs them, so relays see one anonymous author; the content is
// sealed with a read key (k). Inside each event is one signed by the member,
// so members see who wrote. Neither key is in the invite link. The link
// names the group, its host and an invite token: opening it knocks (a sealed
// note to the host, NIP-59), the host admits (or lets anyone with the link
// in), and only then do the keys travel to that person, sealed to their own
// key. The host can reset the link. When someone leaves or is removed, the
// host hands the others a fresh read key: what came before stays readable to
// them, what comes after does not. Members keep every read key they were
// given, newest first. Messages go into the store's `chat` table like
// private messages, under the group's pubkey, so unread counts, notices and
// read marks are the same code. The groups a person is in, and the knocks
// they are waiting on, live in the account's settings (kind 30791, d = chat),
// with the conversations pinned to the top of the chat's lists.
//
// Reactions, edits, pins and deletions (0.30, shared/chatlog.js) are events
// like a message to the relays (kind 7820, sealed); inside is the member's
// event of that kind. The host's info can make messages disappear (`expire`,
// seconds): each message then carries NIP-40's `expiration`, inside and out.
//
//   const groups = new Groups(identity, net, { isBlocked, inbox });  await groups.start();
//   const pub = await groups.create('Crew');  groups.inviteLink(pageUrl, pub)
//   await groups.knock({ pub, host, invite, name, myName });   // from a link
//   await groups.say(pub, 'hi');  groups.admit(pub, pk);  groups.kick(pub, pk)

import { CHANGE_KINDS, changeOf, cleanTimer, myReactions, replyOf } from './chatlog.js';
import { expiryOf, isHex64, KINDS, makeAddressable, now, open, seal, sign } from './events.js';
import { cleanFile, fileFromRumor, fileTags } from './files.js';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, verifyEvent } from './nostr.mjs';
import { baseStore, whole } from './peers.js';
import { hintQuery, hintsAllowed, readHints } from './relaylists.js';
import { AccountSettings } from './settings.js';
import { randomId, store } from './util.js';

export const GROUP_KINDS = [KINDS.GROUP_INFO, KINDS.GROUP_MESSAGE, KINDS.GROUP_JOIN, KINDS.GROUP_LEAVE, KINDS.GROUP_KICK];
const ROOM_INVITE_DAYS = 1; // a room invitation older than this is forgotten: the room is long empty
const MAX_INVITES = 50;
export const NAME = 60;
export const TEXT = 4000;
const INFO_D = 'info';
const SEEN_MAX = 4000;
const MAX_REQUESTS = 50;
const MAX_PINNED = 50;

/** The invite link: where the group lives, who hosts it, the token that opens the door, its name to show, and where its events are (hints). */
export const groupLink = (pageUrl, { pub, host, invite, name, relays = [] }) => {
  const q = hintQuery(relays);
  return `${pageUrl}#/group/${pub}/${host}/${invite}/${encodeURIComponent(name || '')}${q ? `?${q}` : ''}`;
};

/** The parts of a pasted link or fragment, or null; a member's own link has no token ('-'). */
export function parseGroupLink(text) {
  const m = String(text || '').match(/#\/group\/([0-9a-f]{64})\/([0-9a-f]{64})(?:\/([A-Za-z0-9_-]{8,}|-))?(?:\/([^/?\s#]*))?/i);
  if (!m) return null;
  let name = '';
  try {
    name = decodeURIComponent(m[4] || '');
  } catch {}
  const query = String(text || '').match(/\?([^#\s]*)/)?.[1] || '';
  return { pub: m[1].toLowerCase(), host: m[2].toLowerCase(), invite: m[3] && m[3] !== '-' ? m[3] : '', name: name.slice(0, NAME), relays: readHints(new URLSearchParams(query)) };
}

const newKey = () => bytesToHex(generateSecretKey());

export class Groups {
  /**
   * @param {{ sk: string, pk: string, alias?: string|null }} identity
   * @param {{ pool: any, db: any, sync: any }} net
   * @param {{ isBlocked?: (pk: string) => boolean, inbox: any, network?: string }} options
   *   inbox: the DirectMessages that unwraps gift wraps (knocks and keys arrive through it);
   *   network: this page's ('hub' or 'public'): a group made or knocked at here lives on it
   */
  constructor(identity, net, { isBlocked = () => false, inbox, network = 'hub' }) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.alias = String(identity.alias || '');
    this.net = net;
    this.network = network;
    this.isBlocked = isBlocked;
    this.inbox = inbox;
    this.settings = new AccountSettings(identity, net, 'chat');
    this.state = new Map(); // pub -> { name, host, closed, open, infoAt, members: Map(pk -> { name, since, left }), requests: [{ pk, name, at }] }
    this.seenKey = `groups.seen.${this.pk.slice(0, 16)}`;
    this.seen = new Set(store.get(this.seenKey, []));
    this.listeners = new Set();
    this.messageListeners = new Set();
    this.goneListeners = new Set();
    this.queue = Promise.resolve();
    this.pendingRumors = [];
    this.watching = '';
    this.ready = false;
    // knocks and keys come as rumors in gift wraps, through the inbox; before start() they wait
    this.inviteListeners = new Set();
    this.offRumors = [
      inbox.onRumor(KINDS.GROUP_KNOCK, (rumor, _ev, network) => this.rumor(rumor, network)),
      inbox.onRumor(KINDS.GROUP_KEYS, (rumor, _ev, network) => this.rumor(rumor, network)),
      inbox.onRumor(KINDS.ROOM_INVITE, (rumor, _ev, network) => this.rumor(rumor, network)),
    ];
  }

  async start() {
    await this.settings.start();
    this.settings.onChange(() => {
      this.resubscribe().catch(() => {});
      this.emit();
    });
    this.offStore = baseStore(this.net.db).subscribe((ev) => this.mine(ev) && this.receive(ev)); // groups live on either network
    await this.resubscribe();
    await this.queue;
    this.ready = true;
    const waiting = this.pendingRumors;
    this.pendingRumors = [];
    for (const [r, network] of waiting) await this.handleRumor(r, network).catch(() => {});
    return this;
  }

  stop() {
    for (const sub of this.subs || []) sub.close();
    this.offStore?.();
    for (const off of this.offRumors) off();
    this.settings.stop();
  }

  // ---- what the person has ----

  /** The groups this person is in: { pub, w, k, keys, host, name, invite?, open?, joined }. */
  list() {
    return this.settings.get('groups', []) || [];
  }

  /** Links opened whose host has not answered yet: { pub, host, invite, name, myName, at }. */
  knocks() {
    return this.settings.get('knocks', []) || [];
  }

  /**
   * Invitations waiting for a yes or no: a group a friend put me in ({ id, type: 'group', pub, w, k, host, name, from, at })
   * or a live room a friend wants me in ({ id, type: 'room', secret, name, from, at }); room ones a day at most.
   */
  invites() {
    const cut = now() - ROOM_INVITE_DAYS * 86_400;
    return (this.settings.get('invites', []) || []).filter((i) => i.type !== 'room' || i.at > cut);
  }

  entry(pub) {
    return this.list().find((g) => g.pub === pub) || null;
  }

  /** The conversations (people's keys and groups') pinned to the top of the chat's lists, the last pinned first. */
  pinned() {
    return this.settings.get('pinned', []) || [];
  }

  async setPinned(conv, on) {
    const rest = this.pinned().filter((c) => c !== conv);
    await this.settings.set({ pinned: on ? [conv, ...rest].slice(0, MAX_PINNED) : rest });
    this.emit();
  }

  /** The group's timer in seconds (0: messages stay), as its host set it. */
  timerOf(pub) {
    return this.state.get(pub)?.expire || 0;
  }

  info(pub) {
    return this.state.get(pub) || null;
  }

  isHost(pub) {
    return this.entry(pub)?.host === this.pk;
  }

  /** Who is in the group now, me first. */
  members(pub) {
    const st = this.state.get(pub);
    if (!st) return [];
    return [...st.members.entries()]
      .filter(([, m]) => !m.left)
      .map(([pk, m]) => ({ pk, name: m.name, since: m.since, me: pk === this.pk }))
      .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  }

  /** People who knocked and wait for the host (the host's devices only). */
  requests(pub) {
    return this.state.get(pub)?.requests || [];
  }

  inviteLink(pageUrl, pub) {
    const g = this.entry(pub);
    return g?.invite ? groupLink(pageUrl, { pub, host: g.host, invite: g.invite, name: this.state.get(pub)?.name || g.name, relays: this.relaysOf(g) }) : null;
  }

  // ---- the relay side: events under the group's key ----

  mine(ev) {
    return GROUP_KINDS.includes(ev.kind) && Boolean(this.entry(ev.pubkey));
  }

  /** The network a group lives on: where it was made, or where its keys reached me. */
  networkOf(pub) {
    return this.entry(pub)?.network || 'hub';
  }

  /** Where a group's events are, as hints for a link or for keys: its network's relays and those it was found on (none on a locked hub). */
  relaysOf(g) {
    const network = g.network || 'hub';
    if (!hintsAllowed(network)) return [];
    return [...new Set([...whole(this.net.pool).urlsOf(network), ...(g.relays || [])])].slice(0, 3);
  }

  /** The relays a group was found on that are not this hub's: read and written as guests. */
  guestRelays(g) {
    return hintsAllowed(g.network || 'hub') ? whole(this.net.pool).guestUrls(g.relays || [], 3) : [];
  }

  async resubscribe() {
    const db = baseStore(this.net.db);
    const pool = whole(this.net.pool);
    const sync = whole(this.net.sync);
    const groups = this.list();
    for (const g of groups) {
      if (this.state.has(g.pub)) continue;
      this.state.set(g.pub, { name: g.name || '', host: g.host, closed: false, open: false, members: new Map(), gone: new Map(), requests: [] });
      // what the store holds, in order, seen before or not: the members and the rest are this page's to rebuild
      for (const ev of (await db.query([{ kinds: GROUP_KINDS, authors: [g.pub] }], g.network || 'hub')).sort((a, b) => a.created_at - b.created_at))
        await this.handle(ev, { replay: true });
    }
    // one subscription per network: a group's events are asked for, and healed, on its own network alone
    const byNetwork = new Map();
    for (const g of groups) {
      const n = g.network || 'hub';
      if (!byNetwork.has(n)) byNetwork.set(n, []);
      byNetwork.get(n).push(g.pub);
    }
    const key = [...byNetwork].map(([n, pubs]) => `${n}:${[...pubs].sort().join(',')}`).join('|') + groups.map((g) => (g.relays || []).join(',')).join('|');
    if (key === this.watching) return;
    this.watching = key;
    for (const sub of this.subs || []) sub.close();
    this.subs = [...byNetwork].map(([network, pubs]) => pool.subscribe([{ kinds: GROUP_KINDS, authors: pubs }], { network, onevent: (ev) => db.put(ev, network) }));
    // a group from another hub is also read where it lives
    for (const g of groups) {
      const guests = this.guestRelays(g);
      if (guests.length) this.subs.push(pool.subscribeAt(guests, [{ kinds: GROUP_KINDS, authors: [g.pub] }], { onevent: (ev) => db.put(ev, g.network || 'hub') }));
    }
    for (const [network, pubs] of byNetwork) sync.watch(pubs, network);
  }

  receive(ev) {
    if (this.seen.has(ev.id)) return this.queue;
    this.queue = this.queue.then(() => this.handle(ev)).catch(() => {});
    return this.queue;
  }

  /** Open with the newest read key first, then the older ones. */
  async unseal(g, content) {
    for (const k of [g.k, ...(g.keys || [])]) {
      try {
        return await open(hexToBytes(k), content);
      } catch {}
    }
    return null;
  }

  /**
   * One of a group's events. `replay`: from the store at start, to rebuild what the page keeps in memory (members,
   * name, requests); it is handled even when seen before (the seen list outlives the page, the state does not), and
   * does nothing a second time (no re-keying for an old leave, no notice for an old message).
   */
  async handle(ev, { replay = false } = {}) {
    if (!replay && this.seen.has(ev.id)) return;
    const g = this.entry(ev.pubkey);
    const st = this.state.get(ev.pubkey);
    if (!g || !st) return;
    const exp = expiryOf(ev); // a disappearing message: gone when it says, whatever the relay still holds
    if (exp && exp <= now()) return this.markSeen(ev.id);
    const inner = await this.unseal(g, ev.content);
    // inside a message's seal, the member's event: a message, or a change to one (a reaction, an edit, a pin, a deletion)
    const kindOk = inner && (inner.kind === ev.kind || (ev.kind === KINDS.GROUP_MESSAGE && CHANGE_KINDS.includes(inner.kind)));
    if (!kindOk || !isHex64(inner.pubkey) || !verifyEvent(inner)) return this.markSeen(ev.id);
    const body = parse(inner.content);
    if (ev.kind === KINDS.GROUP_INFO) {
      if (inner.pubkey !== g.host || (st.infoAt || 0) > inner.created_at) return this.markSeen(ev.id);
      st.infoAt = inner.created_at;
      st.name = String(body.name || '').slice(0, NAME);
      st.closed = Boolean(body.closed);
      st.open = Boolean(body.open);
      // the timer: a line in the group says when the host changed it
      const expire = cleanTimer(body.expire);
      if (expire !== (st.expire || 0) && !(await this.net.db.hasMessage(inner.id)))
        await this.net.db.putMessage({ id: inner.id, conv: ev.pubkey, group: true, from: inner.pubkey, name: st.members.get(inner.pubkey)?.name || '', at: inner.created_at, t: inner.created_at * 1000, seq: Date.now(), text: '', system: 'timer', timer: expire, wrap: ev.id });
      st.expire = expire;
      if (st.name && st.name !== g.name) this.update(ev.pubkey, { name: st.name }).catch(() => {});
      if (st.closed) await this.gone(ev.pubkey, 'closed');
    } else if (ev.kind === KINDS.GROUP_JOIN) {
      // a join from the second someone left or was removed, or before, does not bring them back: events come in
      // any order (the store replays by the second), and a removal in the second of the join must still hold
      const known = st.members.get(inner.pubkey);
      const gone = st.gone.get(inner.pubkey) ?? -1;
      if (inner.created_at > gone && (!known || known.since <= inner.created_at))
        st.members.set(inner.pubkey, { name: String(body.name || '').slice(0, NAME), since: inner.created_at, left: false });
    } else if (ev.kind === KINDS.GROUP_LEAVE) {
      st.gone.set(inner.pubkey, Math.max(st.gone.get(inner.pubkey) ?? -1, inner.created_at));
      const known = st.members.get(inner.pubkey);
      if (known && known.since <= inner.created_at) known.left = true;
      if (this.isHost(ev.pubkey) && inner.pubkey !== this.pk && this.ready && !replay) this.rekey(ev.pubkey).catch(() => {});
    } else if (ev.kind === KINDS.GROUP_KICK) {
      if (inner.pubkey !== g.host || !isHex64(body.pk)) return this.markSeen(ev.id);
      st.gone.set(body.pk, Math.max(st.gone.get(body.pk) ?? -1, inner.created_at));
      const known = st.members.get(body.pk);
      if (known && known.since <= inner.created_at) known.left = true;
      if (body.pk === this.pk) await this.gone(ev.pubkey, 'removed');
    } else if (ev.kind === KINDS.GROUP_MESSAGE && inner.kind !== KINDS.GROUP_MESSAGE) {
      if (this.isBlocked(inner.pubkey)) return this.markSeen(ev.id);
      const ms = Math.min(999, Math.max(0, Number(inner.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
      const change = changeOf(inner, { conv: ev.pubkey, from: inner.pubkey, t: inner.created_at * 1000 + ms });
      if (change) await this.net.db.putChange(exp ? { ...change, expires: exp } : change);
    } else if (ev.kind === KINDS.GROUP_MESSAGE) {
      if (this.isBlocked(inner.pubkey)) return this.markSeen(ev.id);
      const ms = Math.min(999, Math.max(0, Number(inner.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
      const reply = replyOf(inner);
      // a file: NIP-17's file tags on the inner event, its URL as the content (shared/files.js)
      const file = inner.tags.some((x) => x[0] === 'decryption-key') ? fileFromRumor(inner) : null;
      const message = {
        id: inner.id,
        conv: ev.pubkey,
        group: true,
        ...(file ? { file } : {}),
        from: inner.pubkey,
        name: st.members.get(inner.pubkey)?.name || '',
        at: inner.created_at,
        t: inner.created_at * 1000 + ms,
        seq: Date.now(),
        text: file ? '' : String(inner.content || '').slice(0, TEXT),
        ...(reply ? { reply } : {}),
        ...(exp ? { expires: exp } : {}),
        wrap: ev.id,
      };
      if (!(await this.net.db.hasMessage(message.id))) {
        await this.net.db.putMessage(message);
        if (this.ready && inner.pubkey !== this.pk) for (const fn of this.messageListeners) fn({ ...message, groupName: st.name });
      }
    }
    this.markSeen(ev.id);
    this.emit();
  }

  markSeen(id) {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen = new Set([...this.seen].slice(-SEEN_MAX / 2));
    store.set(this.seenKey, [...this.seen]);
  }

  /**
   * An event signed by me, sealed with the group's current read key, signed by the group. `inner`: the kind of my
   * event inside when it is not the outer one (a change inside a message); `expires`: when it goes (NIP-40, inside and out).
   */
  async publish(g, kind, content, { tags = [], addressable = false, inner: innerKind = kind, expires = 0 } = {}) {
    const exp = expires ? [['expiration', String(expires)]] : [];
    const inner = sign({ kind: innerKind, content, tags: [...tags, ...exp] }, this.sk);
    const sealed = await seal(hexToBytes(g.k), inner);
    const event = addressable ? makeAddressable(kind, INFO_D, sealed, g.w) : sign({ kind, content: sealed, tags: exp }, g.w);
    await whole(this.net.sync).publish(event, { network: g.network || 'hub' }); // stored here first and shown; the outbox carries it to the group's relays, now or when they are back
    const guests = this.guestRelays(g);
    if (guests.length) whole(this.net.pool).publishAt(guests, event).catch(() => {}); // and where it lives, when that is another hub's
    return inner;
  }

  /** The group's info: name, door, timer (kept as it is unless given), closed. */
  publishInfo(g, { name, closed = false, open = false, expire = this.state.get(g.pub)?.expire || 0 }) {
    return this.publish(
      g,
      KINDS.GROUP_INFO,
      JSON.stringify({ name: String(name || '').slice(0, NAME), host: g.host, closed, open, ...(expire ? { expire: cleanTimer(expire) } : {}) }),
      { addressable: true },
    );
  }

  // ---- the person side: knocks and keys, as rumors to one person ----

  /** A knock, keys or a room invitation from the inbox; `network`: where the wrap arrived, when known. */
  rumor(rumor, network = null) {
    if (!this.ready) {
      this.pendingRumors.push([rumor, network]);
      return;
    }
    this.queue = this.queue.then(() => this.handleRumor(rumor, network)).catch(() => {});
  }

  async handleRumor(rumor, network = null) {
    const body = parse(rumor.content);
    if (!isHex64(rumor.pubkey) || this.isBlocked(rumor.pubkey)) return;
    if (rumor.kind !== KINDS.ROOM_INVITE && !isHex64(body.pub)) return; // knocks and keys name a group; a room invitation names a secret
    if (rumor.kind === KINDS.GROUP_KNOCK) {
      // someone at the door of a group I host
      const g = this.entry(body.pub);
      const st = this.state.get(body.pub);
      if (!g || !st || g.host !== this.pk || st.closed) return;
      const member = st.members.get(rumor.pubkey);
      if (member && !member.left) return; // in already
      const name = String(body.name || '').slice(0, NAME);
      if (st.open && body.invite === g.invite) return this.admit(body.pub, rumor.pubkey);
      if (!st.requests.some((r) => r.pk === rumor.pubkey)) {
        st.requests = [...st.requests, { pk: rumor.pubkey, name, at: rumor.created_at }].slice(-MAX_REQUESTS);
        this.emit();
      }
    } else if (rumor.kind === KINDS.GROUP_KEYS) {
      // the host, or a friend who invited me, hands me a group; the host's keys arriving again are a re-key
      if (!isHex64(body.w) || !isHex64(body.k) || !isHex64(body.host)) return;
      if (getPublicKey(hexToBytes(body.w)) !== body.pub) return; // the keys must be the group's
      const have = this.entry(body.pub);
      if (have) {
        if (rumor.pubkey !== have.host || body.k === have.k) return;
        await this.update(body.pub, { k: body.k, keys: [have.k, ...(have.keys || [])].slice(0, 20), ...(body.invite ? { invite: String(body.invite) } : {}) });
        return this.emit();
      }
      const knock = this.knocks().find((x) => x.pub === body.pub);
      // the group lives where its keys reached me: the network I knocked on, or the one the invitation came over
      const relays = readHints(new URLSearchParams((Array.isArray(body.relays) ? body.relays : []).map((r) => `r=${encodeURIComponent(r)}`).join('&')));
      const entry = { pub: body.pub, w: body.w, k: body.k, keys: [], host: body.host, name: String(body.name || knock?.name || '').slice(0, NAME), invite: String(body.invite || ''), network: knock?.network || network || this.network, relays: relays.length ? relays : knock?.relays || [] };
      if (knock && rumor.pubkey === body.host) {
        // the host answered my knock: I asked, so I am in
        await this.settings.set({ groups: [...this.list(), { ...entry, joined: now() }], knocks: this.knocks().filter((x) => x.pub !== body.pub) });
        await this.resubscribe();
        await this.join(body.pub, knock.myName || this.alias);
        return this.emit();
      }
      // someone put me in without my asking: the host, or a friend who is in it; it waits for my yes
      if (rumor.pubkey !== body.host && !(await this.invitedBy(rumor.pubkey))) return;
      if (this.invites().some((i) => i.type === 'group' && i.pub === body.pub)) return;
      await this.addInvite({ id: randomId(), type: 'group', ...entry, from: rumor.pubkey, at: rumor.created_at });
    } else if (rumor.kind === KINDS.ROOM_INVITE) {
      // a friend wants me in a live room: the secret travels sealed to me, never as a link anyone could pass on
      if (!(await this.invitedBy(rumor.pubkey)) || !/^[A-Za-z0-9_-]{8,}$/.test(String(body.secret || ''))) return;
      if (rumor.created_at < now() - ROOM_INVITE_DAYS * 86_400) return;
      if (this.invites().some((i) => i.type === 'room' && i.secret === body.secret)) return;
      const relays = readHints(new URLSearchParams((Array.isArray(body.relays) ? body.relays : []).map((r) => `r=${encodeURIComponent(r)}`).join('&')));
      await this.addInvite({ id: randomId(), type: 'room', secret: String(body.secret), name: String(body.name || '').slice(0, NAME), relays, from: rumor.pubkey, at: rumor.created_at });
    }
  }

  async addInvite(invite) {
    await this.settings.set({ invites: [...this.invites(), invite].slice(-MAX_INVITES) });
    if (this.ready) for (const fn of this.inviteListeners) fn(invite);
    this.emit();
  }

  /** Yes to an invitation: a group is joined (keys kept, me announced); a room's secret is handed back to open it. */
  async acceptInvite(id) {
    const invite = this.invites().find((i) => i.id === id);
    if (!invite) return null;
    await this.settings.set({ invites: this.invites().filter((i) => i.id !== id) });
    if (invite.type === 'group') {
      if (!this.entry(invite.pub)) {
        const { id: _id, type: _type, from: _from, at: _at, ...entry } = invite;
        await this.settings.set({ groups: [...this.list(), { ...entry, joined: now() }] });
        await this.resubscribe();
        await this.join(invite.pub, this.alias);
      }
      this.emit();
      return { type: 'group', pub: invite.pub };
    }
    this.emit();
    return { type: 'room', secret: invite.secret, relays: invite.relays || [] };
  }

  async declineInvite(id) {
    await this.settings.set({ invites: this.invites().filter((i) => i.id !== id) });
    this.emit();
  }

  /** Friends get a sealed invitation to a live room; they open it from the chat, no link changes hands. */
  async inviteRoom(pks, { secret, name = '', relays = [] }) {
    for (const pk of pks) await this.inbox.sendRumor(pk, KINDS.ROOM_INVITE, { secret, name: String(name || '').slice(0, NAME), relays: relays.slice(0, 3) });
  }

  /** Keys from someone who is not the host count when they are a member of that group as we see it later; for now, a friend. */
  async invitedBy(pk) {
    return Boolean(this.friendCheck?.(pk));
  }

  /** The group's keys to one person, with the invite token so they can pass the link on. */
  sendKeys(toPk, g) {
    const st = this.state.get(g.pub);
    return this.inbox.sendRumor(toPk, KINDS.GROUP_KEYS, { pub: g.pub, w: g.w, k: g.k, host: g.host, name: st?.name || g.name || '', invite: g.invite || '', relays: this.relaysOf(g) });
  }

  // ---- actions ----

  /** Make a group: its keys, its info, me as the first member. Resolves with its pubkey. */
  async create(name, { myName, open = false } = {}) {
    const w = newKey();
    const g = { pub: getPublicKey(hexToBytes(w)), w, k: newKey(), keys: [], host: this.pk, name: String(name).trim().slice(0, NAME), invite: randomId(), open, joined: now(), network: this.network };
    await this.settings.set({ groups: [...this.list(), g] });
    this.state.set(g.pub, { name: g.name, host: g.host, closed: false, open, members: new Map(), gone: new Map(), requests: [] });
    await this.publishInfo(g, { name: g.name, open });
    await this.resubscribe();
    await this.join(g.pub, myName);
    return g.pub;
  }

  /** From a link: ask the host to let me in; remembered until they answer. */
  async knock({ pub, host, invite, name, myName, relays = [] }) {
    if (this.entry(pub)) return;
    const me = String(myName || this.alias || '').slice(0, NAME);
    // the link's hints are where the group lives, and where its host reads: the knock goes there too
    if (relays.length && hintsAllowed(this.network)) this.inbox.peers?.learnRelays?.(host, this.network, relays);
    await this.settings.set({ knocks: [...this.knocks().filter((x) => x.pub !== pub), { pub, host, invite, name: String(name || '').slice(0, NAME), myName: me, at: now(), network: this.network, relays }] });
    await this.inbox.sendRumor(host, KINDS.GROUP_KNOCK, { pub, invite, name: me });
    this.emit();
  }

  async forgetKnock(pub) {
    await this.settings.set({ knocks: this.knocks().filter((x) => x.pub !== pub) });
    this.emit();
  }

  /** The host lets someone in: they get the keys; they announce themselves when the keys arrive. */
  async admit(pub, pk) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host admits');
    await this.sendKeys(pk, g);
    const st = this.state.get(pub);
    if (st) st.requests = st.requests.filter((r) => r.pk !== pk);
    this.emit();
  }

  decline(pub, pk) {
    const st = this.state.get(pub);
    if (st) st.requests = st.requests.filter((r) => r.pk !== pk);
    this.emit();
  }

  /** A member brings friends in directly: they get the keys from me and need not knock. */
  async invite(pub, pks) {
    const g = this.entry(pub);
    if (!g) throw new Error('not in this group');
    for (const pk of pks) await this.sendKeys(pk, g);
  }

  async join(pub, myName) {
    const g = this.entry(pub);
    if (!g) throw new Error('not in this group');
    await this.publish(g, KINDS.GROUP_JOIN, JSON.stringify({ name: String(myName || this.alias || '').slice(0, NAME) }));
  }

  /** Say something in the group; `reply`: the id of the message it answers. With the group's timer on, it goes then. */
  async say(pub, text, { reply = '' } = {}) {
    const g = this.entry(pub);
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!g || !content) return null;
    if (this.state.get(pub)?.closed) throw new Error('closed');
    const ms = Date.now();
    return this.publish(g, KINDS.GROUP_MESSAGE, content, { tags: [['ms', String(ms % 1000)], ...(isHex64(reply) ? [['e', reply]] : [])], expires: this.expiresFor(pub) });
  }

  /** Send a file uploaded with shared/files.js (uploadFile) to the group. */
  async sayFile(pub, file, { reply = '' } = {}) {
    const g = this.entry(pub);
    const f = cleanFile(file);
    if (!g || !f) return null;
    if (this.state.get(pub)?.closed) throw new Error('closed');
    const ms = Date.now();
    return this.publish(g, KINDS.GROUP_MESSAGE, f.url, {
      tags: [['ms', String(ms % 1000)], ...(isHex64(reply) ? [['e', reply]] : []), ...fileTags(f)],
      expires: this.expiresFor(pub),
    });
  }

  expiresFor(pub) {
    const seconds = this.timerOf(pub);
    return seconds ? now() + seconds : 0;
  }

  /** The host makes the group's messages disappear after `seconds` (0: they stay). */
  async setTimer(pub, seconds) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host');
    const st = this.state.get(pub);
    await this.publishInfo(g, { name: st?.name || g.name, open: Boolean(st?.open), expire: cleanTimer(seconds) });
  }

  // ---- changes to a message (shared/chatlog.js), inside a message to the relays; each goes when the message does ----

  react(pub, message, emoji) {
    return this.change(pub, message, KINDS.REACTION, emoji, [['k', String(KINDS.GROUP_MESSAGE)]]);
  }

  async unreact(pub, message) {
    const mine = myReactions(await this.net.db.changes(pub), message.id, this.pk);
    if (!mine.length) return null;
    return this.change(pub, message, KINDS.DELETION, '', [['k', String(KINDS.REACTION)]], mine);
  }

  edit(pub, message, text) {
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!content || message.from !== this.pk || message.file) return null;
    return this.change(pub, message, KINDS.CHAT_EDIT, content);
  }

  remove(pub, message) {
    if (message.from !== this.pk) return null;
    return this.change(pub, message, KINDS.DELETION, '', [['k', String(KINDS.GROUP_MESSAGE)]]);
  }

  pin(pub, message, on = true) {
    return this.change(pub, message, KINDS.CHAT_PIN, on ? 'pin' : 'unpin');
  }

  /** `targets`: what the change names (the message, or for taking a reaction back, my reactions). */
  change(pub, message, kind, content, extra = [], targets = [message.id]) {
    const g = this.entry(pub);
    if (!g) throw new Error('not in this group');
    if (this.state.get(pub)?.closed) throw new Error('closed');
    const ms = Date.now();
    return this.publish(g, KINDS.GROUP_MESSAGE, content, {
      inner: kind,
      tags: [...targets.map((id) => ['e', id]), ['ms', String(ms % 1000)], ...extra],
      expires: message.expires || 0,
    });
  }

  /** Leave: tell the group, forget it here and on my other devices. The host re-keys. */
  async leave(pub) {
    const g = this.entry(pub);
    if (!g) return;
    await this.publish(g, KINDS.GROUP_LEAVE, '{}').catch(() => {});
    await this.gone(pub, 'left');
  }

  /** The host puts someone out: everyone marks them gone, their device drops the group, and the rest get a new read key. */
  async kick(pub, pk) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host removes');
    await this.publish(g, KINDS.GROUP_KICK, JSON.stringify({ pk }));
    const known = this.state.get(pub)?.members.get(pk);
    if (known) known.left = true;
    await this.rekey(pub);
  }

  /** A fresh read key for everyone still in: sealed to each, then the info under the new key so a stale reader notices. */
  async rekey(pub) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) return;
    const next = { ...g, k: newKey(), keys: [g.k, ...(g.keys || [])].slice(0, 20) };
    await this.update(pub, { k: next.k, keys: next.keys });
    for (const m of this.members(pub)) if (!m.me) await this.sendKeys(m.pk, next).catch(() => {});
    const st = this.state.get(pub);
    await this.publishInfo(next, { name: st?.name || g.name, open: Boolean(st?.open) });
  }

  /** The host's door policy: anyone with the link walks in, or every knock waits for the host. */
  async setOpen(pub, open) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host');
    const st = this.state.get(pub);
    if (st) st.open = Boolean(open);
    await this.publishInfo(g, { name: st?.name || g.name, open: Boolean(open) });
    this.emit();
  }

  /** A new invite token: links given out before stop opening the door. Members get the new one with the next keys. */
  async resetInvite(pub) {
    if (!this.isHost(pub)) throw new Error('only the host');
    await this.update(pub, { invite: randomId() });
    this.emit();
  }

  /** The host closes the group: every member's device drops it. */
  async close(pub) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host closes a group');
    const st = this.state.get(pub);
    await this.publishInfo(g, { name: st?.name || g.name, closed: true });
    await this.gone(pub, 'closed');
  }

  async rename(pub, name) {
    const g = this.entry(pub);
    if (!g || g.host !== this.pk) throw new Error('only the host renames a group');
    const st = this.state.get(pub);
    await this.publishInfo(g, { name, open: Boolean(st?.open) });
  }

  async gone(pub, why) {
    const name = this.state.get(pub)?.name || this.entry(pub)?.name || '';
    this.state.delete(pub);
    await this.settings.set({ groups: this.list().filter((g) => g.pub !== pub) });
    await this.net.db.removeConversation(pub);
    await this.net.db.removeByAuthor(pub).catch(() => {});
    whole(this.net.sync).unwatch?.(pub);
    for (const fn of this.goneListeners) fn({ pub, name, why });
    this.emit();
  }

  update(pub, patch) {
    return this.settings.set({ groups: this.list().map((g) => (g.pub === pub ? { ...g, ...patch } : g)) });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Every message from someone else that arrives while the page is open, with `groupName`. */
  onMessage(fn) {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  /** An invitation that just arrived (a group or a room), while the page is open. */
  onInvite(fn) {
    this.inviteListeners.add(fn);
    return () => this.inviteListeners.delete(fn);
  }

  /** A group left, closed by its host, or that put me out: { pub, name, why: 'left' | 'closed' | 'removed' }. */
  onGone(fn) {
    this.goneListeners.add(fn);
    return () => this.goneListeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }
}

function parse(json) {
  try {
    return JSON.parse(json || '{}') || {};
  } catch {
    return {};
  }
}

