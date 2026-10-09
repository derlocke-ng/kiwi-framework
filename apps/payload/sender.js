// Sharing files: hash every 64 KiB piece, open a room named by a fresh
// secret, and serve the pieces to whoever opens the link, one channel each.
// The page stays open while it shares: files go straight from this browser.
import { Room, randomSecret, b64url, sha256 } from '../../shared/p2p.js';
import { CHUNK, chunkLength, hashBlob, fingerprint, Meter } from './transfer.js';

/** One fingerprint for a set of files, so both sides can compare a single code. */
export async function setFingerprint(roots) {
  return fingerprint(b64url(await sha256(new TextEncoder().encode(roots.join('.')))));
}

export class Sharing {
  /** @param {any} gun @param {{ name: string, forceRelay: boolean }} options */
  constructor(gun, { name, forceRelay }) {
    this.gun = gun;
    this.name = name;
    this.forceRelay = forceRelay;
    this.prepared = [];
    this.total = 0;
    this.progress = 0; // hashing, 0…1
    this.link = '';
    this.fp = '';
    this.receivers = new Map(); // channel id -> { name, kind, got, state, meter }
    this.listeners = new Set();
    this.room = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  /** Hash the files, then open the room; resolves when the link is ready. */
  async start(fileList) {
    const files = [...fileList];
    this.total = files.reduce((s, f) => s + f.size, 0);
    let done = 0;
    for (const file of files) {
      const { hashes, root } = await hashBlob(file, (p) => {
        this.progress = this.total ? (done + p * file.size) / this.total : 1;
        this.emit();
      });
      done += file.size;
      this.prepared.push({ file, name: file.name, size: file.size, type: file.type || 'application/octet-stream', chunks: hashes.length, hashes, root });
    }
    const secret = randomSecret(16);
    this.room = new Room(this.gun, { secret, role: 'sender', name: this.name, forceRelay: this.forceRelay });
    await this.room.join();
    this.link = `${location.href.split('#')[0]}#${secret}`;
    this.fp = await setFingerprint(this.prepared.map((f) => f.root));
    const manifest = { t: 'manifest', name: this.room.name, chunk: CHUNK, files: this.prepared.map(({ name, size, type, chunks, root }) => ({ name, size, type, chunks, root })) };
    this.room.on('channel', (ch) => this.serve(ch, manifest));
    this.emit();
  }

  serve(ch, manifest) {
    const r = { name: ch.peerInfo.name || 'Receiver', kind: ch.kind, got: 0, state: 'connected', meter: new Meter() };
    this.receivers.set(ch.cid, r);
    this.emit();
    let corrupted = false;
    ch.on('message', async (msg) => {
      if (msg.t === 'hello') {
        r.name = String(msg.name || r.name).slice(0, 60);
        ch.send(manifest);
        this.emit();
      } else if (msg.t === 'get') {
        const f = this.prepared[msg.f];
        const len = f ? chunkLength(f.size, msg.i) : -1;
        if (len < 0) return ch.send({ t: 'error', message: 'No such piece' });
        let bytes = new Uint8Array(await f.file.slice(msg.i * CHUNK, msg.i * CHUNK + len).arrayBuffer());
        // Test hook: corrupt the first piece once to prove receivers catch it.
        if (globalThis.__payloadTest?.corruptFirstChunk && !corrupted && msg.i === 0 && bytes.length) {
          corrupted = true;
          bytes = bytes.slice();
          bytes[0] ^= 0xff;
        }
        await ch.drain();
        ch.send({ t: 'chunk', f: msg.f, i: msg.i, h: b64url(f.hashes[msg.i]) }, bytes);
      } else if (msg.t === 'progress') {
        const got = Math.max(0, Math.min(this.total, Number(msg.got) || 0));
        r.meter.add(Math.max(0, got - r.got));
        r.got = got;
        r.state = 'receiving';
      } else if (msg.t === 'done') {
        r.got = this.total;
        r.state = 'done';
        this.emit();
      }
    });
    ch.on('close', () => {
      if (r.state !== 'done') r.state = 'gone';
      this.emit();
    });
  }

  stop() {
    this.room?.leave();
    this.listeners.clear();
  }
}
