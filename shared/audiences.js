// Who can read what someone posts: an audience. A person's audiences are
// 'me' (only their own devices), 'friends', and each of their circles
// ('c:<circle id>'). A post for an audience is sealed with that audience's key
// in its current epoch, and the event names the key by its id (`key` tag), so
// a reader knows which of the keys they hold opens it.
//
// The keys are derived, never stored: k = HKDF(sk, "wjs/audience/v1/<audience>/<epoch>"),
// so every device of the person has every key they ever used, and two devices
// that start a new epoch at the same moment start the same one. The epoch of
// each audience and whom its key went to are in the person's account settings
// (kind 30791, d = 'audiences'). The key of the current epoch goes to each
// member once, as a gift-wrapped rumor (kind 7805, { kid, k }); someone added
// later gets it then, and reads what was posted under it before. Someone who
// leaves (unfriended, blocked, taken out of the circle) starts a new epoch: its
// key goes to those still in, so they read what comes next and the one who
// left does not. Nothing is re-encrypted: what someone could read stays
// readable to them.
//
// A reader keeps the keys they were given, per author (the last few), in their
// own account settings under `got:<author>`, so every device of theirs reads
// what one of them was given.
//
// The space key is not anyone's: shared/spaces.js derives it from the space's
// address, so everyone using a hub that serves the space reads what is posted
// to "the space", and relays and crawlers see ciphertext.
//
//   const audiences = await new Audiences(identity, hubNet, { inbox, people, isBlocked }).start();
//   const { k, kid } = await audiences.current('friends');   // seal(k, …), tag ['key', kid]
//   audiences.key(author, kid)                                // the key to open it with, or null
import { deriveKey, isHex64, KINDS, keyId } from './events.js';
import { bytesToHex, hexToBytes } from './nostr.mjs';
import { AccountSettings } from './settings.js';

export const AUDIENCE = /^(me|friends|c:[A-Za-z0-9_-]{1,32})$/;
const LABEL = 'wjs/audience/v1';
const KEEP = 12; // keys kept per author: enough for a long time of rotations
const AUTHORS = 300; // authors whose keys are kept; strangers go first when there are more
const SEND_AT_ONCE = 8;

/** The key of one of my audiences in one epoch. */
export const audienceKey = (skHex, audience, epoch) => deriveKey(skHex, `${LABEL}/${audience}/${epoch}`);

export class Audiences {
  /**
   * @param {{ sk: string, pk: string }} identity
   * @param {{ db: any, pool: any, sync: any }} net  the hub's own network (where the account's settings live)
   * @param {{ inbox?: any, people?: any, isBlocked?: (pk: string) => boolean }} [options]
   *   inbox: the DirectMessages that unwraps gift wraps (keys arrive through it, and go out through it);
   *   people: friends and circles, the members of the audiences
   */
  constructor(identity, net, { inbox = null, people = null, isBlocked = () => false } = {}) {
    this.sk = identity.sk;
    this.pk = identity.pk;
    this.net = net;
    this.inbox = inbox;
    this.people = people;
    this.isBlocked = isBlocked;
    this.settings = new AccountSettings(identity, net, 'audiences');
    this.listeners = new Set();
    this.mine = new Map(); // kid -> { k, audience, epoch }: my own keys, derived on demand
    this.pending = [];
    this.ready = false;
    this.queue = Promise.resolve();
    this.timer = null;
    // keys come as rumors through the inbox; it replays what the device holds when it starts, which may be before we do
    this.offRumor = inbox?.onRumor(KINDS.AUDIENCE_KEY, (rumor) => (this.ready ? this.receive(rumor) : this.pending.push(rumor)));
  }

  async start() {
    await this.settings.start();
    this.offSettings = this.settings.onChange(() => {
      this.mine.clear();
      this.emit();
    });
    this.ready = true;
    for (const r of this.pending.splice(0)) this.receive(r);
    // friends and circles change on any page: the audiences follow (after the people settings have synced)
    this.offPeople = this.people?.onChange(() => this.soon());
    this.soon(4000);
    return this;
  }

  stop() {
    this.offRumor?.();
    this.offPeople?.();
    this.offSettings?.();
    clearTimeout(this.timer);
    this.settings.stop();
    this.listeners.clear();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  // ---- my audiences ----

  /** The audiences I have posted to (each has an epoch). */
  used() {
    return Object.keys(this.settings.data || {})
      .filter((k) => k.startsWith('ep:') && this.settings.get(k))
      .map((k) => k.slice(3));
  }

  epoch(audience) {
    return Number(this.settings.get(`ep:${audience}`)) || 0;
  }

  /** Who is in one of my audiences now: friends, a circle's members, nobody for 'me'; never someone blocked. */
  members(audience) {
    if (audience === 'me' || !this.people) return [];
    const list = audience === 'friends' ? this.people.friends().map((f) => f.pk) : this.people.membersOf(audience.slice(2));
    return [...new Set(list)].filter((pk) => isHex64(pk) && pk !== this.pk && !this.isBlocked(pk));
  }

  /**
   * The key my posts to `audience` are sealed with now. On first use the audience starts at epoch 1; when
   * someone left since its key went out, a new epoch starts; the key goes to members who lack it.
   * @returns {Promise<{ audience: string, epoch: number, k: Uint8Array, kid: string }>}
   */
  async current(audience) {
    if (!AUDIENCE.test(audience)) throw new Error(`no such audience: ${audience}`);
    await this.settings.synced; // the newest epoch and list of whom it went to, not this device's old copy
    await this.reconcile(audience, { create: true });
    const epoch = this.epoch(audience);
    const k = audienceKey(this.sk, audience, epoch);
    return { audience, epoch, k, kid: keyId(k) };
  }

  /** Every audience I use, brought in line with its members. */
  async reconcileAll() {
    await this.settings.synced;
    for (const audience of this.used()) await this.reconcile(audience);
  }

  soon(ms = 1500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reconcileAll().catch(() => {}), ms);
  }

  /** One audience: a new epoch when someone left, the key to whoever lacks it. One at a time. */
  reconcile(audience, { create = false } = {}) {
    const run = this.queue.then(() => this.align(audience, create));
    this.queue = run.catch(() => {});
    return run;
  }

  async align(audience, create) {
    let epoch = this.epoch(audience);
    if (!epoch && !create) return;
    const members = this.members(audience);
    const sent = this.settings.get(`to:${audience}`) || { e: 0, pks: [] };
    const patch = {};
    let to;
    let kept = [];
    if (!epoch) {
      epoch = 1;
      patch[`ep:${audience}`] = epoch;
      to = members;
    } else if (sent.e !== epoch) {
      to = members; // this epoch's key has gone to nobody yet (another device started it and went away)
    } else if (sent.pks.some((pk) => !members.includes(pk))) {
      epoch += 1; // someone who had the key is out: what comes next is sealed with a key they never get
      patch[`ep:${audience}`] = epoch;
      to = members;
    } else {
      kept = sent.pks;
      to = members.filter((pk) => !sent.pks.includes(pk));
    }
    if (!to.length && !Object.keys(patch).length) return;
    const k = audienceKey(this.sk, audience, epoch);
    const body = { kid: keyId(k), k: bytesToHex(k) };
    const delivered = [];
    // stored and owed to the relays in one step each (the outbox delivers them later when offline)
    for (let i = 0; i < to.length; i += SEND_AT_ONCE) {
      await Promise.all(
        to.slice(i, i + SEND_AT_ONCE).map((pk) =>
          this.inbox
            ?.sendRumor(pk, KINDS.AUDIENCE_KEY, body, { self: false, wait: false })
            .then(() => delivered.push(pk))
            .catch(() => {}),
        ),
      );
    }
    patch[`to:${audience}`] = { e: epoch, pks: [...new Set([...kept, ...delivered])] };
    await this.settings.set(patch);
  }

  /** A key of mine by its id, derived: every audience I use, every epoch it had. */
  own(kid) {
    if (!this.mine.size) {
      for (const audience of new Set(['me', ...this.used()])) {
        for (let e = 1; e <= Math.max(1, this.epoch(audience)); e++) {
          const k = audienceKey(this.sk, audience, e);
          this.mine.set(keyId(k), { k, audience, epoch: e });
        }
      }
    }
    return this.mine.get(kid) || null;
  }

  /** Which of my audiences a key of mine belongs to ('friends', 'c:…', 'me'), or null. */
  audienceOf(kid) {
    return this.own(kid)?.audience || null;
  }

  // ---- keys others gave me ----

  /** The key an event by `author` names, when this device can have it: mine (derived), or given to me. */
  key(author, kid) {
    if (!kid) return null;
    if (author === this.pk) return this.own(kid)?.k || null;
    const hex = this.settings.get(`got:${author}`)?.[kid];
    return hex ? hexToBytes(hex) : null;
  }

  /** Has `author` given me any key (am I in one of their audiences)? */
  hasKeysFrom(author) {
    return Object.keys(this.settings.get(`got:${author}`) || {}).length > 0;
  }

  receive(rumor) {
    this.queue = this.queue.then(() => this.take(rumor)).catch(() => {});
    return this.queue;
  }

  async take(rumor) {
    const from = rumor?.pubkey;
    if (!isHex64(from) || from === this.pk || this.isBlocked(from)) return; // my own copy, or someone I blocked
    let body;
    try {
      body = JSON.parse(rumor.content || '{}');
    } catch {
      return;
    }
    if (!isHex64(String(body?.k || ''))) return;
    const kid = keyId(hexToBytes(body.k));
    if (body.kid && body.kid !== kid) return; // a key that is not what it says
    const slot = `got:${from}`;
    const have = this.settings.get(slot) || {};
    if (have[kid]) return;
    const patch = { [slot]: Object.fromEntries([...Object.entries(have), [kid, body.k]].slice(-KEEP)) };
    // too many authors: forget strangers' keys first, then the oldest
    const authors = Object.keys(this.settings.data || {}).filter((k) => k.startsWith('got:') && this.settings.get(k));
    if (!have || !Object.keys(have).length) authors.push(slot);
    if (authors.length > AUTHORS) {
      const friend = (k) => Boolean(this.people?.isFriend(k.slice(4)));
      const victims = [...authors.filter((k) => !friend(k) && k !== slot), ...authors.filter((k) => friend(k) && k !== slot)].slice(0, authors.length - AUTHORS);
      for (const v of victims) patch[v] = undefined;
    }
    await this.settings.set(patch);
  }
}
