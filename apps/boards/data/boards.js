// A board is its own nostr key pair. Everyone with the edit link holds the
// board's secret key and signs items as the board; relays accept nothing
// else for that address. Every value is encrypted with a read key derived
// from the secret key, so view links carry the read key and edit links the
// secret key.

//
// Wire ids stay Loadout's (kinds 30700-30703, 'wjs/loadout/…' derivations):
// boards made before the app moved into the framework open unchanged.

import { KINDS, makeAddressable, seal, open, deriveKey, dTag, hex, bytes } from '../../../shared/events.js';
import { generateSecretKey, getPublicKey } from '../../../shared/nostr.mjs';
import { fail, randomId } from '../../../shared/util.js';

/** @typedef {{ pool: any, db: any, sync: any }} Net */

const BOARD_KINDS = [KINDS.LOADOUT_INFO, KINDS.LOADOUT_ITEM, KINDS.LOADOUT_DOC];
const MISSING_AFTER = 9000;
const LOCKED = Symbol('locked');

export const readKeyFor = (w) => hex(deriveKey(w, 'wjs/loadout/read'));

/**
 * Create a board and write its info. Returns the wallet entry.
 * @param {{ type: string, title: string, mode?: string }} info
 * @param {Net} net
 */
export async function createBoard({ type, title, mode = 'check' }, net) {
  const sk = generateSecretKey();
  const w = hex(sk);
  const entry = { pub: getPublicKey(sk), w, k: readKeyFor(w), type, title, mode };
  const board = new Board(entry, net);
  await board.setInfo({ v: 1, type, title, mode, created: Date.now() });
  return entry;
}

export class Board {
  /**
   * @param {{pub: string, w?: string|null, k?: string|null}} keys
   * @param {Net} net
   */
  constructor({ pub, w = null, k = null }, net) {
    this.net = net;
    this.pub = pub;
    this.w = w;
    this.k = k || (w ? readKeyFor(w) : null);
    this.key = this.k ? bytes(this.k) : null;
    this.info = null;
    this.items = new Map();
    this.doc = null; // { md, u }
    this.state = 'loading'; // loading | ready | locked | missing | deleted
    this.listeners = new Set();
    this.seq = new Map();
  }

  get canEdit() {
    return Boolean(this.w);
  }

  async open() {
    const { db, pool, sync } = this.net;
    const filter = { authors: [this.pub], kinds: BOARD_KINDS };
    for (const ev of (await db.query([filter])).reverse()) await this.receive(ev);
    this.offStore = db.subscribe((ev) => {
      if (ev.pubkey === this.pub && BOARD_KINDS.includes(ev.kind)) this.receive(ev);
    });
    this.sub = pool.subscribe([filter], {
      onevent: (ev) => db.put(ev),
      oneose: () => setTimeout(() => this.state === 'loading' && !this.info && this.set({ state: 'missing' }), 1500),
    });
    sync.watch([this.pub]);
    this.missingTimer = setTimeout(() => this.state === 'loading' && this.set({ state: 'missing' }), MISSING_AFTER);
    return this;
  }

  close() {
    this.closed = true;
    clearTimeout(this.missingTimer);
    this.sub?.close();
    this.offStore?.();
    this.listeners.clear();
  }

  /** Decode values in arrival order even though decryption is async. */
  async receive(ev) {
    if (this.closed) return;
    const slot = `${ev.kind}:${dTag(ev)}`;
    const n = (this.seq.get(slot) || 0) + 1;
    this.seq.set(slot, n);
    let value;
    if (!this.key) value = LOCKED;
    else {
      try {
        value = await open(this.key, ev.content);
      } catch {
        value = LOCKED; // wrong key for this board
      }
    }
    if (this.closed || this.seq.get(slot) !== n) return;
    if (value === LOCKED) {
      if (this.state !== 'ready') this.set({ state: 'locked' });
      return;
    }
    if (ev.kind === KINDS.LOADOUT_INFO) this.onInfo(value);
    else if (ev.kind === KINDS.LOADOUT_ITEM) this.onItem(dTag(ev), value);
    else if (ev.kind === KINDS.LOADOUT_DOC) this.onDoc(value);
  }

  onInfo(value) {
    if (value?.del) return this.set({ state: 'deleted' });
    if (!value || typeof value !== 'object') return;
    this.info = value;
    if (this.state !== 'deleted') this.set({ state: 'ready' });
  }

  onItem(id, value) {
    if (value && !value.del && typeof value.t === 'string') this.items.set(id, { ...value, id });
    else this.items.delete(id);
    this.emit('items');
  }

  onDoc(value) {
    this.doc = value && !value.del && typeof value.md === 'string' ? value : null;
    this.emit('doc');
  }

  set(patch) {
    Object.assign(this, patch);
    this.emit();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what = 'all') {
    for (const fn of this.listeners) fn(what);
  }

  // ---- writes: signed by the board key, stored locally first, relayed by the outbox ----

  async put(kind, d, value) {
    if (!this.w) throw fail('board.error.viewOnly', 'You can only view this board.');
    await this.net.sync.publish(makeAddressable(kind, d, await seal(this.key, value), this.w));
  }

  setInfo(info) {
    this.info = { ...this.info, ...info, u: Date.now() };
    return this.put(KINDS.LOADOUT_INFO, 'info', this.info);
  }

  addItem(fields) {
    const now = Date.now();
    const id = randomId();
    return this.put(KINDS.LOADOUT_ITEM, id, { t: fields.t, d: fields.d ? 1 : 0, q: fields.q ?? null, o: fields.o ?? 0, c: fields.c ?? now, u: now }).then(() => id);
  }

  updateItem(id, patch) {
    const cur = this.items.get(id);
    if (!cur) return Promise.resolve();
    const { id: _, ...rest } = { ...cur, ...patch, u: Date.now() };
    return this.put(KINDS.LOADOUT_ITEM, id, rest);
  }

  removeItem(id) {
    return this.put(KINDS.LOADOUT_ITEM, id, { del: 1, u: Date.now() });
  }

  setDoc(md) {
    this.doc = { md, u: Date.now() };
    return this.put(KINDS.LOADOUT_DOC, 'body', this.doc);
  }

  /** Wipe the content for everyone and mark the board deleted. */
  async destroy() {
    await Promise.all([...this.items.keys()].map((id) => this.removeItem(id)));
    if (this.doc) await this.put(KINDS.LOADOUT_DOC, 'body', { del: 1, u: Date.now() });
    await this.put(KINDS.LOADOUT_INFO, 'info', { del: 1, u: Date.now() });
  }

  snapshot() {
    return { info: this.info, items: [...this.items.values()], doc: this.doc };
  }
}

/** Wait until a board has loaded (or given up). */
export function settled(board, ms = 6000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      off();
      resolve(board);
    };
    const t = setTimeout(done, ms);
    const off = board.on(() => {
      if (board.state !== 'loading') setTimeout(done, 600); // let items trickle in
    });
    if (board.state !== 'loading') setTimeout(done, 600);
  });
}

/**
 * A new board with the same content; returns its wallet entry (the caller adds it to the wallet).
 * @param {Board} src
 * @param {{ title: string }} options
 * @param {Net} net
 */
export async function copyBoard(src, { title }, net) {
  const entry = await createBoard({ type: src.info.type, mode: src.info.mode, title }, net);
  const copy = new Board(entry, net);
  if (src.info.type === 'note') {
    if (src.doc?.md) await copy.setDoc(src.doc.md);
  } else {
    await Promise.all([...src.items.values()].map((i) => copy.addItem(i)));
  }
  return entry;
}
