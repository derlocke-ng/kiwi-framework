// A public noticeboard on nostr (Armory's DevBoard). Notes are addressable
// events (kind 30810) with NIP-40 expiry and NIP-13 proof of work; votes are
// NIP-25 reactions; reports NIP-56. Readers check every rule themselves: a
// note without the proof of work, or that lives too long, does not exist.
// The wire ids stay DevBoard's (kind 30810, settings namespace 'devboard').

import { KINDS, now, sign, stamp, addressOf } from '../../../shared/events.js';
import { minePow, hasPow } from '../../../shared/pow.js';
import { store, randomId } from '../../../shared/util.js';
import { t } from '../../../shared/i18n.js';

export const LIMITS = { title: 80, text: 300, tags: 10, tag: 24, rate: 60, contact: 200, perKey: 3, maxDays: 31 };
export const DURATIONS = [1, 3, 7, 14, 30];
/** Leading zero bits a note needs: a moment on a phone, hours for a flood. A device may set its own (tests do). */
export const powPost = () => Number(store.get('devboard.pow')) || 16;
const powVote = () => Math.min(8, powPost());
const COLLAPSE_SCORE = -5;
const COLLAPSE_REPORTS = 3;
const VOTE_WINDOW = 30_000;
const VOTE_MAX = 10;
export const NAMESPACE = 'devboard';

/** A note's event, checked against every rule; null when it breaks one. */
export function parsePost(ev) {
  if (ev.kind !== KINDS.DEVBOARD_POST) return null;
  const address = addressOf(ev);
  if (!address) return null;
  const exp = Number(ev.tags.find((x) => x[0] === 'expiration')?.[1]);
  if (!hasPow(ev, powPost())) return null; // no proof of work, no board
  if (!(exp > ev.created_at && exp - ev.created_at <= LIMITS.maxDays * 86_400)) return null;
  let data;
  try {
    data = JSON.parse(ev.content);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (data.del) return { address, event: ev, pubkey: ev.pubkey, id: ev.id, created_at: ev.created_at, expires: exp, deleted: true };
  if (!['hiring', 'available'].includes(data.type) || typeof data.title !== 'string' || !data.title.trim()) return null;
  const clean = {
    type: data.type,
    title: String(data.title).slice(0, LIMITS.title),
    text: String(data.text || '').slice(0, LIMITS.text),
    tags: (Array.isArray(data.tags) ? data.tags : [])
      .map((x) => String(x).trim().slice(0, LIMITS.tag))
      .filter(Boolean)
      .slice(0, LIMITS.tags),
    rate: String(data.rate || '').slice(0, LIMITS.rate),
    contact: String(data.contact || '').slice(0, LIMITS.contact),
  };
  return { address, event: ev, pubkey: ev.pubkey, id: ev.id, data: clean, created_at: ev.created_at, expires: exp };
}

export class Notices {
  /**
   * @param {{ pool: any, db: any, sync: any }} net
   * @param {{ sk: string, pk: string }} identity
   */
  constructor(net, identity) {
    this.net = net;
    this.identity = identity;
    /** address -> { address, event, pubkey, id, data, created_at, expires, deleted? } */
    this.posts = new Map();
    /** address -> Map(voter -> { v, at }) */
    this.votes = new Map();
    /** address -> Map(reporter -> at) */
    this.reports = new Map();
    this.voteTimes = [];
    this.listeners = new Set();
    this.timer = null;
    this.version = 0;
  }

  async start() {
    const since = now() - LIMITS.maxDays * 86_400;
    const filters = [{ kinds: [KINDS.DEVBOARD_POST], since }, { kinds: [KINDS.REACTION, KINDS.REPORT], '#k': [String(KINDS.DEVBOARD_POST)], since }];
    for (const ev of await this.net.db.query(filters)) this.receive(ev);
    this.offStore = this.net.db.subscribe((ev) => this.receive(ev));
    this.sub = this.net.pool.subscribe(filters, { onevent: (ev) => this.net.db.put(ev) });
    this.net.sync.watch([this.identity.pk]);
    return this;
  }

  stop() {
    this.offStore?.();
    this.sub?.close();
    clearTimeout(this.timer);
    this.listeners.clear();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.version++;
      for (const fn of this.listeners) fn();
    }, 60);
  }

  receive(ev) {
    if (ev.kind === KINDS.DEVBOARD_POST) {
      const post = parsePost(ev);
      if (!post) return;
      const cur = this.posts.get(post.address);
      if (cur && (cur.created_at > post.created_at || (cur.created_at === post.created_at && cur.id < post.id))) return;
      this.posts.set(post.address, post); // a deletion stays as a tombstone so an older copy cannot bring the note back
      this.changed();
    } else if (ev.kind === KINDS.REACTION) {
      const a = ev.tags.find((x) => x[0] === 'a')?.[1];
      const v = ev.content === '+' ? 1 : ev.content === '-' ? -1 : 0;
      if (!a || !hasPow(ev, powVote())) return;
      if (!this.votes.has(a)) this.votes.set(a, new Map());
      const cur = this.votes.get(a).get(ev.pubkey);
      if (cur && cur.at >= ev.created_at) return;
      if (v) this.votes.get(a).set(ev.pubkey, { v, at: ev.created_at });
      else this.votes.get(a).delete(ev.pubkey); // a reaction with no content takes the vote back
      this.changed();
    } else if (ev.kind === KINDS.REPORT) {
      const a = ev.tags.find((x) => x[0] === 'a')?.[1];
      if (!a || !hasPow(ev, powVote())) return;
      if (!this.reports.has(a)) this.reports.set(a, new Map());
      this.reports.get(a).set(ev.pubkey, ev.created_at);
      this.changed();
    }
  }

  score(address, isBlocked) {
    let s = 0;
    for (const [voter, { v }] of this.votes.get(address) || []) if (!isBlocked(voter)) s += v;
    return s;
  }

  reportCount(address, isBlocked) {
    const all = this.reports.get(address) || new Map();
    let n = 0;
    for (const reporter of all.keys()) if (!isBlocked(reporter) && reporter !== this.identity.pk) n++;
    return n + (all.has(this.identity.pk) ? 1 : 0);
  }

  myVote(address) {
    return this.votes.get(address)?.get(this.identity.pk)?.v || 0;
  }

  /**
   * Live notes of people not blocked, with their score and why they are collapsed (if they are).
   * @param {(pk: string) => boolean} isBlocked
   */
  visible(isBlocked) {
    const live = [...this.posts.values()].filter((p) => !p.deleted && p.expires > now() && !isBlocked(p.pubkey));
    // Three live notes per person: the newest ones count.
    const byKey = new Map();
    for (const p of [...live].sort((a, b) => b.created_at - a.created_at)) {
      const list = byKey.get(p.pubkey) || [];
      list.push(p);
      byKey.set(p.pubkey, list);
    }
    return live.map((p) => {
      const rank = byKey.get(p.pubkey).indexOf(p);
      const s = this.score(p.address, isBlocked);
      const r = this.reportCount(p.address, isBlocked);
      const collapsed = rank >= LIMITS.perKey ? 'cap' : r >= COLLAPSE_REPORTS ? 'reports' : s <= COLLAPSE_SCORE ? 'score' : null;
      return { ...p, score: s, reports: r, collapsed: p.pubkey === this.identity.pk ? null : collapsed };
    });
  }

  /**
   * Mine in the shared workers; onProgress gets seconds elapsed, signal cancels.
   * @param {object} template
   * @param {number} bits
   * @param {((seconds: number) => void) | null} [onProgress]
   * @param {AbortSignal | null} [signal]
   */
  mine(template, bits, onProgress = null, signal = null) {
    return minePow(template, bits, { signal, onProgress: ({ ms }) => onProgress?.(Math.round(ms / 1000)) });
  }

  /**
   * @param {{ type: string, title: string, text: string, tags: string[], rate: string, contact: string }} data
   * @param {{ d?: string, days?: number, onProgress?: ((seconds: number) => void) | null, signal?: AbortSignal | null }} [options]
   */
  async publishPost(data, { d = randomId(), days = 7, onProgress = null, signal = null } = {}) {
    if (!this.net.pool.online) throw new Error(t('db.compose.needRelay'));
    const { pk, sk } = this.identity;
    const created = stamp(`${KINDS.DEVBOARD_POST}:${pk}:${d}`); // strictly increasing per note: an edit in the same second still wins
    const template = { kind: KINDS.DEVBOARD_POST, pubkey: pk, created_at: created, tags: [['d', d], ['expiration', String(created + days * 86_400)], ...data.tags.map((x) => ['t', x.toLowerCase()])], content: JSON.stringify(data) };
    const event = sign(await this.mine(template, powPost(), onProgress, signal), sk);
    await this.net.sync.publish(event, { wait: 'one' });
    return event;
  }

  async deletePost(p) {
    const { pk, sk } = this.identity;
    const created = stamp(p.address);
    const template = { kind: KINDS.DEVBOARD_POST, pubkey: pk, created_at: created, tags: [['d', p.address.split(':')[2]], ['expiration', String(created + 86_400)]], content: JSON.stringify({ del: 1 }) };
    await this.net.sync.publish(sign(await this.mine(template, powPost()), sk));
  }

  /** Vote up (1) or down (-1); the same vote again takes it back. Ten votes in thirty seconds at most. */
  async vote(p, v) {
    const { pk, sk } = this.identity;
    if (p.pubkey === pk) throw Object.assign(new Error(t('db.ownVote')), { code: 'db.ownVote' });
    const t0 = Date.now();
    while (this.voteTimes.length && t0 - this.voteTimes[0] > VOTE_WINDOW) this.voteTimes.shift();
    if (this.voteTimes.length >= VOTE_MAX) throw Object.assign(new Error(t('db.voteLimit')), { code: 'db.voteLimit' });
    this.voteTimes.push(t0);
    const content = this.myVote(p.address) === v ? '' : v > 0 ? '+' : '-';
    // Votes on one note get strictly increasing timestamps on this device, so changing a vote within a second replaces it everywhere.
    const template = { kind: KINDS.REACTION, pubkey: pk, created_at: stamp(`vote:${p.address}`), tags: [['e', p.id], ['p', p.pubkey], ['a', p.address], ['k', String(KINDS.DEVBOARD_POST)]], content };
    const event = sign(await this.mine(template, powVote()), sk);
    this.receive(event);
    await this.net.sync.publish(event);
  }

  async report(p, type, text) {
    const { pk, sk } = this.identity;
    const template = { kind: KINDS.REPORT, pubkey: pk, created_at: now(), tags: [['p', p.pubkey, type], ['e', p.id, type], ['a', p.address], ['k', String(KINDS.DEVBOARD_POST)]], content: text.slice(0, 500) };
    const event = sign(await this.mine(template, powVote()), sk);
    this.receive(event);
    await this.net.sync.publish(event, { wait: 'one' });
  }
}
