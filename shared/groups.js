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
// they are waiting on, live in the account's settings (kind 30791, d = chat).
//
//   const groups = new Groups(identity, net, { isBlocked, inbox });  await groups.start();
//   const pub = await groups.create('Crew');  groups.inviteLink(pageUrl, pub)
//   await groups.knock({ pub, host, invite, name, myName });   // from a link
//   await groups.say(pub, 'hi');  groups.admit(pub, pk);  groups.kick(pub, pk)

import { isHex64, KINDS, makeAddressable, now, open, seal, sign } from './events.js';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, verifyEvent } from './nostr.mjs';
import { baseStore, whole } from './peers.js';
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

/** The invite link: where the group lives, who hosts it, the token that opens the door, and its name to show. */
export const groupLink = (pageUrl, { pub, host, invite, name }) => `${pageUrl}#/group/${pub}/${host}/${invite}/${encodeURIComponent(name || '')}`;

/** The parts of a pasted link or fragment, or null; a member's own link has no token ('-'). */
export function parseGroupLink(text) {
  const m = String(text || '').match(/#\/group\/([0-9a-f]{64})\/([0-9a-f]{64})(?:\/([A-Za-z0-9_-]{8,}|-))?(?:\/([^/?\s#]*))?/i);
  if (!m) return null;
  let name = '';
  try {
    name = decodeURIComponent(m[4] || '');
  } catch {}
  return { pub: m[1].toLowerCase(), host: m[2].toLowerCase(), invite: m[3] && m[3] !== '-' ? m[3] : '', name: name.slice(0, NAME) };
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
    return g?.invite ? groupLink(pageUrl, { pub, host: g.host, invite: g.invite, name: this.state.get(pub)?.name || g.name }) : null;
  }

  // ---- the relay side: events under the group's key ----

  mine(ev) {
    return GROUP_KINDS.includes(ev.kind) && Boolean(this.entry(ev.pubkey));
  }

  /** The network a group lives on: where it was made, or where its keys reached me. */
  networkOf(pub) {
    return this.entry(pub)?.network || 'hub';
  }

  async resubscribe() {
    const db = baseStore(this.net.db);
    const pool = whole(this.net.pool);
    const sync = whole(this.net.sync);
    const groups = this.list();
    for (const g of groups) {
      if (this.state.has(g.pub)) continue;
      this.state.set(g.pub, { name: g.name || '', host: g.host, closed: false, open: false, members: new Map(), requests: [] });
      for (const ev of (await db.query([{ kinds: GROUP_KINDS, authors: [g.pub] }], g.network || 'hub')).sort((a, b) => a.created_at - b.created_at)) await this.handle(ev);
    }
    // one subscription per network: a group's events are asked for, and healed, on its own network alone
    const byNetwork = new Map();
    for (const g of groups) {
      const n = g.network || 'hub';
      if (!byNetwork.has(n)) byNetwork.set(n, []);
      byNetwork.get(n).push(g.pub);
    }
    const key = [...byNetwork].map(([n, pubs]) => `${n}:${[...pubs].sort().join(',')}`).join('|');
    if (key === this.watching) return;
    this.watching = key;
    for (const sub of this.subs || []) sub.close();
    this.subs = [...byNetwork].map(([network, pubs]) => pool.subscribe([{ kinds: GROUP_KINDS, authors: pubs }], { network, onevent: (ev) => db.put(ev, network) }));
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

  async handle(ev) {
    if (this.seen.has(ev.id)) return;
    const g = this.entry(ev.pubkey);
    const st = this.state.get(ev.pubkey);
    if (!g || !st) return;
    const inner = await this.unseal(g, ev.content);
    if (!inner || inner.kind !== ev.kind || !isHex64(inner.pubkey) || !verifyEvent(inner)) return this.markSeen(ev.id);
    const body = parse(inner.content);
    if (ev.kind === KINDS.GROUP_INFO) {
      if (inner.pubkey !== g.host || (st.infoAt || 0) > inner.created_at) return this.markSeen(ev.id);
      st.infoAt = inner.created_at;
      st.name = String(body.name || '').slice(0, NAME);
      st.closed = Boolean(body.closed);
      st.open = Boolean(body.open);
      if (st.name && st.name !== g.name) this.update(ev.pubkey, { name: st.name }).catch(() => {});
      if (st.closed) await this.gone(ev.pubkey, 'closed');
    } else if (ev.kind === KINDS.GROUP_JOIN) {
      const known = st.members.get(inner.pubkey);
      if (!known || known.since <= inner.created_at) st.members.set(inner.pubkey, { name: String(body.name || '').slice(0, NAME), since: inner.created_at, left: false });
    } else if (ev.kind === KINDS.GROUP_LEAVE) {
      const known = st.members.get(inner.pubkey);
      if (known && known.since <= inner.created_at) known.left = true;
      if (this.isHost(ev.pubkey) && inner.pubkey !== this.pk && this.ready) this.rekey(ev.pubkey).catch(() => {});
    } else if (ev.kind === KINDS.GROUP_KICK) {
      if (inner.pubkey !== g.host || !isHex64(body.pk)) return this.markSeen(ev.id);
      const known = st.members.get(body.pk);
      if (known) known.left = true;
      if (body.pk === this.pk) await this.gone(ev.pubkey, 'removed');
    } else if (ev.kind === KINDS.GROUP_MESSAGE) {
      if (this.isBlocked(inner.pubkey)) return this.markSeen(ev.id);
      const ms = Math.min(999, Math.max(0, Number(inner.tags.find((x) => x[0] === 'ms')?.[1]) || 0));
      const message = {
        id: inner.id,
        conv: ev.pubkey,
        group: true,
        from: inner.pubkey,
        name: st.members.get(inner.pubkey)?.name || '',
        at: inner.created_at,
        t: inner.created_at * 1000 + ms,
        seq: Date.now(),
        text: String(inner.content || '').slice(0, TEXT),
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

  /** An event signed by me, sealed with the group's current read key, signed by the group. */
  async publish(g, kind, content, { tags = [], addressable = false } = {}) {
    const inner = sign({ kind, content, tags }, this.sk);
    const sealed = await seal(hexToBytes(g.k), inner);
    const event = addressable ? makeAddressable(kind, INFO_D, sealed, g.w) : sign({ kind, content: sealed, tags: [] }, g.w);
    await whole(this.net.sync).publish(event, { network: g.network || 'hub' }); // stored here first and shown; the outbox carries it to the group's relays, now or when they are back
    return inner;
  }

  publishInfo(g, { name, closed = false, open = false }) {
    return this.publish(g, KINDS.GROUP_INFO, JSON.stringify({ name: String(name || '').slice(0, NAME), host: g.host, closed, open }), { addressable: true });
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
      const entry = { pub: body.pub, w: body.w, k: body.k, keys: [], host: body.host, name: String(body.name || knock?.name || '').slice(0, NAME), invite: String(body.invite || ''), network: knock?.network || network || this.network };
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
      await this.addInvite({ id: randomId(), type: 'room', secret: String(body.secret), name: String(body.name || '').slice(0, NAME), from: rumor.pubkey, at: rumor.created_at });
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
    return { type: 'room', secret: invite.secret };
  }

  async declineInvite(id) {
    await this.settings.set({ invites: this.invites().filter((i) => i.id !== id) });
    this.emit();
  }

  /** Friends get a sealed invitation to a live room; they open it from the chat, no link changes hands. */
  async inviteRoom(pks, { secret, name = '' }) {
    for (const pk of pks) await this.inbox.sendRumor(pk, KINDS.ROOM_INVITE, { secret, name: String(name || '').slice(0, NAME) });
  }

  /** Keys from someone who is not the host count when they are a member of that group as we see it later; for now, a friend. */
  async invitedBy(pk) {
    return Boolean(this.friendCheck?.(pk));
  }

  /** The group's keys to one person, with the invite token so they can pass the link on. */
  sendKeys(toPk, g) {
    const st = this.state.get(g.pub);
    return this.inbox.sendRumor(toPk, KINDS.GROUP_KEYS, { pub: g.pub, w: g.w, k: g.k, host: g.host, name: st?.name || g.name || '', invite: g.invite || '' });
  }

  // ---- actions ----

  /** Make a group: its keys, its info, me as the first member. Resolves with its pubkey. */
  async create(name, { myName, open = false } = {}) {
    const w = newKey();
    const g = { pub: getPublicKey(hexToBytes(w)), w, k: newKey(), keys: [], host: this.pk, name: String(name).trim().slice(0, NAME), invite: randomId(), open, joined: now(), network: this.network };
    await this.settings.set({ groups: [...this.list(), g] });
    this.state.set(g.pub, { name: g.name, host: g.host, closed: false, open, members: new Map(), requests: [] });
    await this.publishInfo(g, { name: g.name, open });
    await this.resubscribe();
    await this.join(g.pub, myName);
    return g.pub;
  }

  /** From a link: ask the host to let me in; remembered until they answer. */
  async knock({ pub, host, invite, name, myName }) {
    if (this.entry(pub)) return;
    const me = String(myName || this.alias || '').slice(0, NAME);
    await this.settings.set({ knocks: [...this.knocks().filter((x) => x.pub !== pub), { pub, host, invite, name: String(name || '').slice(0, NAME), myName: me, at: now(), network: this.network }] });
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

  async say(pub, text) {
    const g = this.entry(pub);
    const content = String(text || '')
      .trim()
      .slice(0, TEXT);
    if (!g || !content) return null;
    if (this.state.get(pub)?.closed) throw new Error('closed');
    const ms = Date.now();
    return this.publish(g, KINDS.GROUP_MESSAGE, content, { tags: [['ms', String(ms % 1000)]] });
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

