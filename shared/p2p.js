// Rooms on nostr: a shared secret (from the link's #fragment) names a room and
// encrypts everything said in it. Ephemeral events on the page's relays carry
// presence and signaling (kinds 21700 and 21701), sealed to the room's key and
// signed by a key made for the visit; data then flows over a direct WebRTC data
// channel, or, when no direct path exists (two phones on mobile networks),
// through the relays as sealed ephemeral frames (kind 21702). Relays keep none
// of it. Payload's direct transfers and pong's games run on it.
//
//   const room = new Room(kiwi.net, { secret, role: 'host', name: 'Ann' });
//   await room.join();
//   room.on('peer', (p) => …);            // someone joined (p.id, p.role, p.name)
//   room.on('channel', (ch) => …);        // they connected to us
//   const ch = await room.connect(p.id);  // or we connect to them
//   ch.on('message', (msg, bytes) => …);  ch.send({ t: 'hi' }, optionalBytes);

import { finalizeEvent, generateSecretKey, getPublicKey } from './nostr.mjs';

export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** The room's ephemeral kinds (docs/protocol.md §8). */
export const KIND = { PRESENCE: 21700, SIGNAL: 21701, DATA: 21702 };

const NS = 'wjs-p2p-1';
const BEAT = 5000; // presence this often, and at once when someone new appears
const GONE_AFTER = 16_000;
const MAIL_MAX_AGE = 90_000;
const PART = 24 * 1024; // a relayed frame's largest part: relays take events of 64 KB, sealed and in base64 a part is ~33 KB
const INFLIGHT = 24; // relayed parts on their way at once
const te = new TextEncoder();
const td = new TextDecoder();

// ---------- encoding ----------

export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomSecret = (bytes = 16) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** One frame = 4-byte header length, JSON header, optional binary payload. */
export function encodeFrame(msg, bytes) {
  const head = te.encode(JSON.stringify(msg));
  const body = bytes ? new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength) : new Uint8Array(0);
  const out = new Uint8Array(4 + head.length + body.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(body, 4 + head.length);
  return out;
}

export function decodeFrame(frame) {
  const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(0);
  if (len > u8.length - 4) throw new Error('bad frame');
  const msg = JSON.parse(td.decode(u8.subarray(4, 4 + len)));
  const bytes = u8.length > 4 + len ? u8.slice(4 + len) : null;
  return { msg, bytes };
}

/** Room id (public) and AES-GCM key (secret) for a link secret. */
export async function roomKeys(secret) {
  const id = b64url(await sha256(te.encode(`${NS}|room|${secret}`))).slice(0, 22);
  const raw = await sha256(te.encode(`${NS}|key|${secret}`));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, key };
}

export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64url(out);
}

/** @returns {Promise<Uint8Array|null>} null when it isn't ours or was tampered with */
export async function unseal(key, str) {
  try {
    const u8 = fromB64url(str);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12)));
  } catch {
    return null;
  }
}

const sealJson = (key, obj) => seal(key, te.encode(JSON.stringify(obj)));
async function unsealJson(key, str) {
  const u8 = typeof str === 'string' ? await unseal(key, str) : null;
  try {
    return u8 && JSON.parse(td.decode(u8));
  } catch {
    return null;
  }
}

function timeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out`)), ms)))]).finally(() => clearTimeout(t));
}

function iceGathered(pc, ms) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

class Emitter {
  constructor() {
    this._h = {};
  }
  on(evt, fn) {
    (this._h[evt] ||= new Set()).add(fn);
    return () => this._h[evt].delete(fn);
  }
  emit(evt, ...args) {
    for (const fn of this._h[evt] || []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

// ---------- room ----------

/**
 * Everyone in a room speaks under a key made for this visit: relays learn no identity and nothing of what is said,
 * only that some keys exchange ephemeral events tagged with the room's id (a hash of the secret).
 */
export class Room extends Emitter {
  /**
   * @param {{ pool: any }} net  the page's network (its relays carry the room's ephemeral events)
   * @param {{ secret: string, role: string, name?: string, meta?: object, forceRelay?: boolean,
   *   channel?: RTCDataChannelInit, iceServers?: RTCIceServer[], connectTimeout?: number }} opt
   */
  constructor(net, opt) {
    super();
    this.net = net;
    this.secret = opt.secret;
    this.role = opt.role;
    this.name = opt.name || '';
    this.meta = opt.meta || {};
    this.forceRelay = Boolean(opt.forceRelay);
    this.channelInit = opt.channel || { ordered: true };
    this.iceServers = opt.iceServers || ICE_SERVERS;
    this.connectTimeout = opt.connectTimeout || 12_000;
    this.sk = generateSecretKey(); // this visit's key: the peer id others know us by
    this.peerId = getPublicKey(this.sk);
    this.peers = new Map();
    this.channels = new Map(); // cid -> channel
    this.pending = new Map(); // cid -> { answer }
    this.incoming = new Map(); // cid -> RTCPeerConnection we answered
    this.seen = new Set(); // event ids handled (relays may each deliver one)
  }

  async join() {
    const { id, key } = await roomKeys(this.secret);
    this.id = id;
    this.key = key;
    const since = Math.floor(Date.now() / 1000) - 10;
    this.sub = this.net.pool.subscribe(
      [
        { kinds: [KIND.PRESENCE], '#h': [id], since },
        { kinds: [KIND.SIGNAL, KIND.DATA], '#h': [id], '#p': [this.peerId], since },
      ],
      { onevent: (ev) => this.onEvent(ev) },
    );
    await this.beat();
    this.timers = [setInterval(() => this.beat(), BEAT), setInterval(() => this.sweep(), 2000)];
    this.onHide = () => this.leave();
    addEventListener('pagehide', this.onHide);
    return this;
  }

  /** An ephemeral event of the room, signed by this visit's key, to the page's relays (no store, no outbox). */
  send(kind, content, tags = []) {
    if (this.left && kind !== KIND.PRESENCE) return Promise.resolve();
    const event = finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [['h', this.id], ...tags], content }, this.sk);
    return Promise.resolve(this.net.pool.publish(event)).catch(() => {});
  }

  /** Update what others see about us (name, meta). */
  async announce(patch) {
    Object.assign(this, patch);
    await this.beat();
  }

  async beat(extra = {}) {
    if (this.left && !extra.bye) return;
    const info = { role: this.role, name: this.name, meta: this.meta, t: Date.now(), ...extra };
    await this.send(KIND.PRESENCE, await sealJson(this.key, info));
  }

  async onEvent(ev) {
    if (ev.pubkey === this.peerId || this.seen.has(ev.id) || this.left) return;
    this.seen.add(ev.id);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    if (ev.kind === KIND.PRESENCE) return this.onPresence(ev.pubkey, await unsealJson(this.key, ev.content));
    if (ev.kind === KIND.SIGNAL) return this.onMail(ev.pubkey, await unsealJson(this.key, ev.content));
    if (ev.kind === KIND.DATA) {
      const cid = ev.tags.find((t) => t[0] === 'c')?.[1];
      const ch = cid && this.channels.get(cid);
      if (ch?.kind === 'relay' && ch.peer === ev.pubkey) ch.receive(ev.content);
    }
  }

  onPresence(peerId, info) {
    if (!info || Date.now() - info.t > GONE_AFTER) return;
    if (info.bye) return this.drop(peerId);
    const known = this.peers.get(peerId);
    const peer = { id: peerId, role: info.role, name: info.name, meta: info.meta || {}, seen: Date.now() };
    this.peers.set(peerId, peer);
    if (!known) {
      this.emit('peer', peer);
      this.beat().catch(() => {}); // someone new: they see us now, not at our next beat
    } else if (known.name !== peer.name || JSON.stringify(known.meta) !== JSON.stringify(peer.meta)) this.emit('peer-update', peer);
  }

  sweep() {
    for (const [id, p] of this.peers) if (Date.now() - p.seen > GONE_AFTER) this.drop(id);
  }

  drop(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    for (const ch of this.channels.values()) if (ch.peer === peerId) ch.close('left', false);
    this.emit('leave', peer);
  }

  async mail(to, msg) {
    await this.send(KIND.SIGNAL, await sealJson(this.key, { ...msg, to, t: Date.now() }), [['p', to]]);
  }

  onMail(from, m) {
    if (!m || m.to !== this.peerId || Math.abs(Date.now() - m.t) > MAIL_MAX_AGE) return;
    m.from = from;
    if (m.type === 'offer') this.answer(m).catch((err) => console.warn('p2p answer:', err));
    else if (m.type === 'answer') this.pending.get(m.cid)?.(m);
    else if (m.type === 'relay') this.acceptRelay(m);
    else if (m.type === 'bye') this.channels.get(m.cid)?.close('bye', false);
    else this.emit('mail', m); // another use of the room's mail (a call's offers and answers, shared/calls.js)
  }

  /** Open a channel to a peer: direct WebRTC first, the relays as fallback. */
  async connect(peerId) {
    const cid = randomSecret(9);
    if (!this.forceRelay && typeof RTCPeerConnection !== 'undefined') {
      try {
        return await this.direct(peerId, cid);
      } catch (err) {
        console.info('p2p: direct connection failed, relaying through the relays:', err.message);
      }
    }
    const ch = this.adopt(new RelayChannel(this, peerId, cid), true);
    await this.mail(peerId, { type: 'relay', cid });
    return ch;
  }

  async direct(peerId, cid) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = pc.createDataChannel('wjs', this.channelInit);
    dc.binaryType = 'arraybuffer';
    const answered = new Promise((resolve) => this.pending.set(cid, resolve));
    const opened = new Promise((resolve, reject) => {
      dc.addEventListener('open', resolve, { once: true });
      pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && reject(new Error('connection failed')));
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc, 2500);
      await this.mail(peerId, { type: 'offer', cid, sdp: pc.localDescription.sdp });
      const answer = await timeout(answered, this.connectTimeout, 'answer');
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      await timeout(opened, this.connectTimeout, 'data channel');
    } catch (err) {
      pc.close();
      throw err;
    } finally {
      this.pending.delete(cid);
    }
    return this.adopt(new DirectChannel(this, peerId, cid, pc, dc), true);
  }

  async answer(m) {
    if (this.left) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.incoming.set(m.cid, pc);
    pc.addEventListener('datachannel', (e) => {
      const dc = e.channel;
      dc.binaryType = 'arraybuffer';
      const ready = () => {
        if (!this.channels.has(m.cid)) this.adopt(new DirectChannel(this, m.from, m.cid, pc, dc), false);
      };
      if (dc.readyState === 'open') ready();
      else dc.addEventListener('open', ready, { once: true });
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await iceGathered(pc, 2500);
    await this.mail(m.from, { type: 'answer', cid: m.cid, sdp: pc.localDescription.sdp });
  }

  acceptRelay(m) {
    const existing = this.channels.get(m.cid);
    if (existing?.kind === 'relay') return;
    existing?.close('switching to relay', false);
    this.incoming.get(m.cid)?.close();
    this.incoming.delete(m.cid);
    this.adopt(new RelayChannel(this, m.from, m.cid), false);
  }

  adopt(ch, initiator) {
    this.channels.set(ch.cid, ch);
    ch.on('close', () => {
      if (this.channels.get(ch.cid) === ch) this.channels.delete(ch.cid);
    });
    if (!initiator) this.emit('channel', ch);
    return ch;
  }

  leave() {
    if (this.left) return;
    for (const ch of [...this.channels.values()]) ch.close('left');
    this.beat({ bye: true }).catch(() => {}); // the others drop us now, not when we go quiet
    this.left = true;
    (this.timers || []).forEach(clearInterval);
    removeEventListener('pagehide', this.onHide);
    for (const pc of this.incoming.values()) pc.close();
    this.sub?.close();
  }
}

// ---------- channels ----------

class Channel extends Emitter {
  constructor(room, peer, cid, kind) {
    super();
    this.room = room;
    this.peer = peer;
    this.cid = cid;
    this.kind = kind; // 'direct' | 'relay'
    this.open = true;
  }

  get peerInfo() {
    return this.room.peers.get(this.peer) || { id: this.peer };
  }

  close(reason = 'closed', notify = true) {
    if (!this.open) return;
    this.open = false;
    if (notify) this.room.mail(this.peer, { type: 'bye', cid: this.cid }).catch(() => {});
    this.shutdown();
    this.emit('close', reason);
  }
}

class DirectChannel extends Channel {
  constructor(room, peer, cid, pc, dc) {
    super(room, peer, cid, 'direct');
    this.pc = pc;
    this.dc = dc;
    dc.bufferedAmountLowThreshold = 1 << 20;
    dc.addEventListener('message', (e) => {
      try {
        const { msg, bytes } = decodeFrame(e.data);
        this.emit('message', msg, bytes);
      } catch (err) {
        console.warn('p2p: bad frame', err);
      }
    });
    dc.addEventListener('close', () => this.close('closed', false));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close('connection lost', false);
    });
  }

  send(msg, bytes) {
    if (!this.open || this.dc.readyState !== 'open') return false;
    this.dc.send(encodeFrame(msg, bytes));
    return true;
  }

  get buffered() {
    return this.dc.bufferedAmount;
  }

  /** Resolve once the send buffer is below `limit` bytes. */
  drain(limit = 4 << 20) {
    if (this.dc.bufferedAmount < limit || !this.open) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.dc.bufferedAmount < limit || !this.open) {
          this.dc.removeEventListener('bufferedamountlow', check);
          clearInterval(t);
          resolve();
        }
      };
      this.dc.addEventListener('bufferedamountlow', check);
      const t = setInterval(check, 200);
    });
  }

  shutdown() {
    try {
      this.dc.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Frames as sealed ephemeral events (kind 21702) through the page's relays, for when no direct path exists:
 * a frame larger than a relay takes is sent in parts and put together again. Best effort and unordered, as
 * relays are: the apps ask again for what does not arrive.
 */
class RelayChannel extends Channel {
  constructor(room, peer, cid) {
    super(room, peer, cid, 'relay');
    this.seq = 0;
    this.parts = new Map(); // seq -> { n, got: Map<i, bytes> }
    this.done = new Set(); // seqs put together
    this.inflight = 0;
    this.waiters = [];
  }

  send(msg, bytes) {
    if (!this.open) return false;
    const frame = encodeFrame(msg, bytes);
    const s = ++this.seq;
    const n = Math.max(1, Math.ceil(frame.length / PART));
    for (let i = 0; i < n; i++) {
      this.inflight++;
      seal(this.room.key, encodeFrame({ s, i, n }, frame.subarray(i * PART, (i + 1) * PART)))
        .then((content) => this.open && this.room.send(KIND.DATA, content, [['p', this.peer], ['c', this.cid]]))
        .catch(() => {})
        .finally(() => {
          this.inflight--;
          if (this.inflight < INFLIGHT) for (const w of this.waiters.splice(0)) w();
        });
    }
    return true;
  }

  async receive(content) {
    if (!this.open) return;
    const sealed = await unseal(this.room.key, content);
    if (!sealed || !this.open) return;
    let part;
    try {
      part = decodeFrame(sealed);
    } catch {
      return;
    }
    const { s, i, n } = part.msg || {};
    if (!Number.isInteger(s) || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 64 || i < 0 || i >= n || this.done.has(s)) return;
    let entry = this.parts.get(s);
    if (!entry) this.parts.set(s, (entry = { n, got: new Map(), at: Date.now() }));
    entry.got.set(i, part.bytes || new Uint8Array(0));
    if (entry.got.size < entry.n) return this.forget();
    this.parts.delete(s);
    this.done.add(s);
    const size = [...entry.got.values()].reduce((a, b) => a + b.length, 0);
    const frame = new Uint8Array(size);
    let at = 0;
    for (let k = 0; k < entry.n; k++) {
      frame.set(entry.got.get(k), at);
      at += entry.got.get(k).length;
    }
    let decoded;
    try {
      decoded = decodeFrame(frame);
    } catch {
      return;
    }
    this.emit('message', decoded.msg, decoded.bytes);
  }

  /** Parts of frames that never came together, after a minute: dropped (the app asks again). */
  forget() {
    const old = Date.now() - 60_000;
    for (const [s, e] of this.parts) if (e.at < old) this.parts.delete(s);
  }

  get buffered() {
    return this.inflight * PART;
  }

  /** Resolve once few enough parts are on their way (relays take a burst badly). */
  drain() {
    if (this.inflight < INFLIGHT || !this.open) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  shutdown() {
    for (const w of this.waiters.splice(0)) w();
  }
}
