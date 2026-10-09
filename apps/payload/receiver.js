// Receiving files: find the sender of a link, fetch the pieces with a
// window of requests, check each against its SHA-256, ask again for damaged
// or lost ones, check every file's root at the end, and save it. A lost
// connection is found again and the download carries on.
import { Room, b64url, sha256 } from '../../shared/p2p.js';
import { chunkLength, rootOf, Meter } from './transfer.js';
import { setFingerprint } from './sender.js';

export class Receiving {
  /** @param {any} gun @param {string} secret @param {{ name: string, forceRelay: boolean }} options */
  constructor(gun, secret, { name, forceRelay }) {
    this.gun = gun;
    this.secret = secret;
    this.name = name;
    this.forceRelay = forceRelay;
    this.status = 'Looking for the sender…';
    this.manifest = null;
    this.sender = null;
    this.fp = '';
    this.ch = null;
    this.parts = [];
    this.hashes = [];
    this.got = 0;
    this.total = 0;
    this.meter = new Meter();
    this.files = []; // per file: { state: '' | 'receiving' | 'verified', save?: () => void }
    this.started = false;
    this.finished = false;
    this.done = false;
    this.error = '';
    this.handler = null;
    this.resume = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  setStatus(text) {
    this.status = text;
    this.emit();
  }

  async open() {
    this.room = new Room(this.gun, { secret: this.secret, role: 'receiver', name: this.name, forceRelay: this.forceRelay });
    await this.room.join();
    await this.reconnect();
  }

  stop() {
    this.finished = true;
    this.room?.leave();
    this.listeners.clear();
  }

  /** Find the sender, connect and get the manifest; again after a lost connection. */
  async connectToSender() {
    const room = this.room;
    const waiting = setTimeout(() => this.setStatus('Waiting for the sender. Their Payload tab has to be open — files go straight from their browser to yours.'), 8000);
    const sender = await new Promise((resolve) => {
      const find = () => [...room.peers.values()].find((p) => p.role === 'sender');
      const found = find();
      if (found) return resolve(found);
      const off = room.on('peer', () => {
        const p = find();
        if (p) {
          off();
          resolve(p);
        }
      });
    });
    clearTimeout(waiting);
    this.setStatus(`Connecting to ${sender.name || 'the sender'}…`);
    const ch = await room.connect(sender.id);
    const manifest = await new Promise((resolve, reject) => {
      const off = ch.on('message', (msg) => {
        if (msg.t === 'manifest') {
          off();
          clearInterval(again);
          resolve(msg);
        }
      });
      const hello = () => ch.send({ t: 'hello', name: room.name });
      hello();
      const again = setInterval(hello, 3000); // relay channels are best effort
      ch.on('close', () => {
        clearInterval(again);
        reject(new Error('The connection closed'));
      });
    });
    ch.on('message', (msg, bytes) => {
      if (msg.t === 'chunk') this.handler?.(msg, bytes);
      if (msg.t === 'error') console.warn('sender:', msg.message);
    });
    ch.on('close', () => {
      if (this.finished) return;
      this.ch = null;
      if (this.started) this.setStatus('Connection lost — reconnecting…');
      this.reconnect();
    });
    this.ch = ch;
    this.sender = sender;
    return manifest;
  }

  async reconnect() {
    for (;;) {
      if (this.finished) return;
      try {
        const manifest = await this.connectToSender();
        if (this.manifest && manifest.files.map((f) => f.root).join() !== this.manifest.files.map((f) => f.root).join()) {
          return this.fail('The sender is sharing different files now. Ask for a new link.');
        }
        if (!this.manifest) {
          this.manifest = manifest;
          this.total = manifest.files.reduce((s, f) => s + f.size, 0);
          this.files = manifest.files.map(() => ({ state: '' }));
          this.fp = await setFingerprint(manifest.files.map((f) => f.root));
        }
        this.emit();
        this.resume?.();
        return;
      } catch (err) {
        console.info('payload: reconnecting', err.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  fail(message) {
    this.finished = true;
    this.error = message;
    this.emit();
  }

  /** Download every file in turn; each is saved as soon as it is verified. */
  async download() {
    if (this.started) return;
    this.started = true;
    this.emit();
    const m = this.manifest;
    const tick = setInterval(() => {
      this.ch?.send({ t: 'progress', got: this.got });
      this.emit();
    }, 500);
    try {
      for (let fi = 0; fi < m.files.length; fi++) {
        this.files[fi] = { state: 'receiving' };
        this.emit();
        const blob = await this.fetchFile(fi, m.files[fi]);
        const url = URL.createObjectURL(blob);
        const save = () => {
          const a = Object.assign(document.createElement('a'), { href: url, download: m.files[fi].name });
          document.body.append(a);
          a.click();
          a.remove();
        };
        this.files[fi] = { state: 'verified', save };
        this.emit();
        save();
      }
      this.finished = true;
      this.done = true;
      this.ch?.send({ t: 'progress', got: this.total });
      this.ch?.send({ t: 'done' });
    } catch (err) {
      this.fail(err.message);
    } finally {
      clearInterval(tick);
      this.emit();
    }
    setTimeout(() => this.room?.leave(), 3000);
  }

  /** Pull one file in pieces, checking each against its hash, then the root. */
  fetchFile(fi, meta) {
    const n = meta.chunks;
    const parts = (this.parts[fi] ||= new Array(n));
    const hashes = (this.hashes[fi] ||= new Array(n));
    const inflight = new Map(); // i -> { at, tries }
    let have = parts.filter(Boolean).length;
    let next = 0;
    let bad = 0;
    return new Promise((resolve, reject) => {
      const windowSize = () => (this.ch?.kind === 'direct' ? 32 : 8);
      const wait = () => (this.ch?.kind === 'direct' ? 10_000 : 25_000);
      const request = (i) => {
        const tries = (inflight.get(i)?.tries || 0) + 1;
        if (tries > 12) return finish(new Error(`Piece ${i + 1} of “${meta.name}” never arrived intact.`));
        inflight.set(i, { at: Date.now(), tries });
        this.ch?.send({ t: 'get', f: fi, i });
      };
      const pump = () => {
        while (inflight.size < windowSize() && next < n) {
          if (!parts[next]) request(next);
          next++;
        }
        if (have === n) finish();
      };
      this.handler = async (msg, bytes) => {
        if (msg.f !== fi || parts[msg.i] || !inflight.has(msg.i)) return;
        const data = bytes || new Uint8Array(0);
        const digest = await sha256(data);
        if (data.length !== chunkLength(meta.size, msg.i) || b64url(digest) !== msg.h) {
          bad++;
          console.warn(`payload: piece ${msg.i} failed its hash check, asking again`);
          return request(msg.i);
        }
        if (parts[msg.i]) return;
        parts[msg.i] = data;
        hashes[msg.i] = digest;
        inflight.delete(msg.i);
        have++;
        this.got += data.length;
        this.meter.add(data.length);
        pump();
      };
      this.resume = () => {
        for (const v of inflight.values()) v.at = 0;
      };
      const timer = setInterval(() => {
        if (!this.ch) return;
        for (const [i, v] of inflight) if (Date.now() - v.at > wait()) request(i);
      }, 1000);
      let ended = false;
      const finish = async (err) => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        this.handler = null;
        if (err) return reject(err);
        const root = await rootOf(hashes);
        if (root !== meta.root) return reject(new Error(`“${meta.name}” failed verification. Nothing was saved.`));
        if (bad) console.info(`payload: ${bad} damaged piece(s) were fetched again`);
        resolve(new Blob(parts, { type: meta.type || 'application/octet-stream' }));
      };
      pump();
    });
  }
}
