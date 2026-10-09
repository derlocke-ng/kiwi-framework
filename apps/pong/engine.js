// The game behind the screens: two browsers find each other over gun (a
// link, a QR code or the open-games lobby) and play over a direct WebRTC data
// channel, or through gun when no direct path exists. The host runs the
// game; the guest sends its paddle and draws the host's snapshots,
// predicting the ball in between. React draws the screens from `view` and
// calls the methods; the field is a canvas this class draws on its own.
import { Room, createGun, randomSecret, relaysUp, DEFAULT_RELAYS } from '../../shared/p2p.js';
import { H, PH, W, PW, PX, BALL, WIN, PADDLE_SPEED, clampPaddle, newGame, step, cpuMove, snapshot, extrapolate } from './game.js';

const LOBBY = 'wjs-pong-lobby-1';
const DT = 1 / 120;
const GREEN = '#33ff33';
const KEYS = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
const SECRET = /^[\w-]{22}$/;

function setting(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(`pong.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}
const save = (key, value) => {
  try {
    localStorage.setItem(`pong.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};
export const clean = (s, fallback) => (String(s || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().toUpperCase() || fallback).slice(0, 12);
export const secretOf = (text) => {
  const v = String(text || '').trim();
  const secret = v.includes('#') ? v.slice(v.indexOf('#') + 1) : v;
  return SECRET.test(secret) ? secret : null;
};

export class Pong {
  constructor() {
    this.relayList = setting('relays') || DEFAULT_RELAYS;
    this.forceRelay = new URLSearchParams(location.search).has('relay') || setting('forceRelay') === true;
    this.gun = createGun(this.relayList);
    this.name = setting('name', '') || '';
    this.muted = setting('mute', false);
    this.listPublic = setting('listPublic', false);
    this.input = { up: false, down: false, target: null };
    this.session = null;
    this.room = null;
    this.lobbyTimer = null;
    this.lobby = new Map();
    this.audio = null;
    /**
     * What the screens show.
     * @type {{ screen: string, link: string, joinStatus: string, names: { l: string, r: string }, netInfo: string, overlay: { title: string, blink?: boolean, score?: string, line?: string, buttons: [string, string][] } | null, relaysUp: number }}
     */
    this.view = { screen: 'menu', link: '', joinStatus: '', names: { l: 'P1', r: 'P2' }, netInfo: '', overlay: null, relaysUp: 0 };
    this.listeners = new Set();
    this.timers = [];
    this.last = performance.now();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }

  myName() {
    return (this.name.trim().toUpperCase() || 'PLAYER').slice(0, 12);
  }

  setName(v) {
    this.name = v;
    save('name', v.trim().toUpperCase());
  }

  /** Start listening: keys, the lobby, the relay count. */
  start() {
    this.onKeyDown = (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (KEYS[e.key] && this.session) {
        e.preventDefault();
        this.input[KEYS[e.key]] = true;
        this.input.target = null;
      }
      if (e.key === 'm' || e.key === 'M') this.toggleMute();
    };
    this.onKeyUp = (e) => {
      if (KEYS[e.key]) this.input[KEYS[e.key]] = false;
    };
    this.onBlur = () => (this.input.up = this.input.down = false);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.timers.push(setInterval(() => this.set({ relaysUp: relaysUp(this.gun) }), 1500));
    // Open games: hosts who chose to be listed, seen in the last few seconds.
    this.gun
      .get(LOBBY)
      .map()
      .on((v, k) => {
        if (v == null) return this.lobby.delete(k);
        try {
          const g = JSON.parse(v);
          if (SECRET.test(g.secret)) this.lobby.set(k, { name: clean(g.name, 'HOST'), secret: g.secret, t: Number(g.t) || 0 });
        } catch {
          /* not a game */
        }
      });
    this.timers.push(setInterval(() => this.set({}), 1500));
  }

  stop() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    for (const t of this.timers) clearInterval(t);
    cancelAnimationFrame(this.frameId);
    this.end();
  }

  /** The games listed right now, other than our own. */
  openGames() {
    return [...this.lobby.values()].filter((g) => Date.now() - g.t < 12_000 && g.secret !== this.room?.secret);
  }

  // ---- sound ----

  beep(freq, ms = 60, vol = 0.05) {
    if (this.muted) return;
    try {
      this.audio ||= new AudioContext();
      const o = this.audio.createOscillator();
      const g = this.audio.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g).connect(this.audio.destination);
      o.start();
      o.stop(this.audio.currentTime + ms / 1000);
    } catch {
      /* no audio */
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    save('mute', this.muted);
    this.set({});
  }

  // ---- input ----

  /** The on-screen ▲/▼ buttons. */
  press(key, down) {
    this.input[key] = down;
    if (down) this.input.target = null;
  }

  /** Move the local paddle: keys at paddle speed, pointer a bit faster but not instantly. */
  steer(y, dt) {
    const { input } = this;
    if (input.up || input.down) return clampPaddle(y + ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * PADDLE_SPEED * dt);
    if (input.target == null) return y;
    const max = PADDLE_SPEED * 2.2 * dt;
    return clampPaddle(y + Math.max(-max, Math.min(max, input.target - y)));
  }

  // ---- the field ----

  /** Draw on this canvas and steer with the pointer on it; returns a detach function. */
  attach(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
    const target = (e) => {
      const r = canvas.getBoundingClientRect();
      this.input.target = clampPaddle(((e.clientY - r.top) / r.height) * H - PH / 2);
    };
    const move = (e) => (e.pointerType === 'mouse' || e.buttons) && target(e);
    const down = (e) => {
      canvas.setPointerCapture(e.pointerId);
      target(e);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', down);
    const frame = (now) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.session) this.tick(dt, now);
      this.draw(now);
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(this.frameId);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
    };
  }

  // ---- sessions ----

  /** mode: 'cpu' | 'host' | 'guest'. The local player is left for cpu/host and right for the guest. */
  begin(mode, opts = {}) {
    this.session = {
      mode,
      side: mode === 'guest' ? 'r' : 'l',
      s: newGame(),
      names: opts.names,
      ch: opts.ch || null,
      remoteY: (H - PH) / 2,
      snap: null,
      snapAt: 0,
      lastSend: 0,
      lastY: null,
      seq: 0,
      rtt: null,
      counters: { h: 0, k: 0, p: 0 },
      acc: 0,
    };
    this.input.target = null;
    if (globalThis.__pongTest) globalThis.__pongTest.session = this.session; // read-only view for the browser suite
    this.set({ screen: 'game', names: { ...this.session.names }, overlay: null });
    this.drawNet();
  }

  practice() {
    this.begin('cpu', { names: { l: this.myName(), r: 'CPU' } });
  }

  end() {
    if (this.session?.ch) {
      clearInterval(this.session.pinger);
      this.session.ch.close('left');
    }
    this.session = null;
    this.stopLobby();
    this.room?.leave();
    this.room = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.set({ screen: 'menu', overlay: null });
  }

  drawNet() {
    const S = this.session;
    if (!S) return;
    this.set({ netInfo: S.mode === 'cpu' ? 'PRACTICE' : `${S.ch?.kind === 'direct' ? 'DIRECT' : 'VIA RELAY'}${S.rtt != null ? ` · ${S.rtt} MS` : ''}` });
  }

  overlay(o) {
    this.set({ overlay: o });
  }

  /** A button on the overlay: rematch, menu, wait. */
  act(what) {
    if (what === 'rematch') this.rematch();
    if (what === 'menu') this.end();
    if (what === 'wait') this.waitAgain();
  }

  rematch() {
    const S = this.session;
    if (!S) return;
    this.overlay(null);
    if (S.mode === 'guest') S.ch?.send({ t: 'rematch' });
    else {
      S.s = newGame();
      S.counters = { h: 0, k: 0, p: 0 };
    }
  }

  // ---- networking ----

  wire(ch) {
    const S = this.session;
    S.ch = ch;
    ch.on('message', (msg) => this.onMessage(msg));
    ch.on('close', () => {
      if (!this.session || this.session.ch !== ch) return;
      clearInterval(this.session.pinger);
      this.session.ch = null;
      this.beep(110, 300);
      this.overlay({
        title: 'OPPONENT LEFT',
        buttons:
          this.session.mode === 'host'
            ? [
                ['wait', '[WAIT FOR A NEW PLAYER]'],
                ['menu', '[MENU]'],
              ]
            : [['menu', '[MENU]']],
      });
    });
    S.pinger = setInterval(() => ch.send({ t: 'ping', ts: performance.now() }), 2000);
  }

  onMessage(msg) {
    const S = this.session;
    if (!S) return;
    if (msg.t === 'ping') return S.ch?.send({ t: 'pong', ts: msg.ts });
    if (msg.t === 'pong') {
      S.rtt = Math.round(performance.now() - msg.ts);
      return this.drawNet();
    }
    if (S.mode === 'host') {
      if (msg.t === 'p') S.remoteY = clampPaddle(Number(msg.y) || 0);
      else if (msg.t === 'rematch' && S.s.ph === 'over') this.rematch();
      else if (msg.t === 'hello') S.ch?.send({ t: 'start', name: this.myName() });
    } else if (msg.t === 's' && msg.n > (S.snap?.n ?? -1)) {
      S.snap = msg;
      S.snapAt = performance.now();
    }
  }

  /** Host: open a room, show the link, wait for a guest. */
  async host() {
    this.room?.leave();
    const secret = randomSecret(16);
    const room = new Room(this.gun, { secret, role: 'host', name: this.myName(), forceRelay: this.forceRelay, channel: { ordered: true } });
    this.room = room;
    await room.join();
    room.secret = secret;
    this.set({ screen: 'wait', link: `${location.href.split('#')[0]}#${secret}` });
    this.publishLobby();
    room.on('channel', (ch) => {
      if (this.session?.ch?.open) {
        ch.send({ t: 'full' });
        setTimeout(() => ch.close('full'), 500);
        return;
      }
      const off = ch.on('message', (msg) => {
        if (msg.t !== 'hello' || (this.session?.ch?.open && this.session.ch !== ch)) return;
        off();
        this.stopLobby();
        const guest = clean(msg.name, 'PLAYER 2');
        ch.send({ t: 'start', name: this.myName() });
        if (this.session?.mode === 'host') {
          // A new player after the last one left: keep the session, reset the game.
          this.session.names.r = guest;
          this.session.s = newGame();
          this.set({ names: { ...this.session.names }, overlay: null });
        } else this.begin('host', { names: { l: this.myName(), r: guest } });
        this.wire(ch);
        this.drawNet();
        this.beep(660, 120);
      });
    });
  }

  waitAgain() {
    if (!this.room) return this.end();
    this.overlay({ title: 'WAITING FOR A NEW PLAYER', blink: true, line: 'SAME LINK AS BEFORE', buttons: [['menu', '[MENU]']] });
    if (this.listPublic) this.publishLobby();
  }

  setListPublic(on) {
    this.listPublic = on;
    save('listPublic', on);
    if (on) this.publishLobby();
    else this.stopLobby();
    this.set({});
  }

  publishLobby() {
    this.stopLobby();
    const put = () => {
      if (!this.room || !this.listPublic) return;
      this.gun.get(LOBBY).get(this.room.peerId).put(JSON.stringify({ name: this.myName(), secret: this.room.secret, t: Date.now() }));
    };
    put();
    this.lobbyTimer = setInterval(put, 4000);
  }

  stopLobby() {
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    if (this.room?.peerId) this.gun.get(LOBBY).get(this.room.peerId).put(null);
  }

  /** Guest: find the host of a link and connect. */
  async join(secret) {
    if (this.session) this.end();
    this.room?.leave();
    this.set({ screen: 'joining', joinStatus: 'LOOKING FOR THE HOST…' });
    const status = (joinStatus) => this.set({ joinStatus });
    const room = new Room(this.gun, { secret, role: 'guest', name: this.myName(), forceRelay: this.forceRelay, channel: { ordered: true } });
    this.room = room;
    await room.join();
    const slow = setTimeout(() => status('WAITING FOR THE HOST — THEIR GAME HAS TO BE OPEN.'), 8000);
    const host = await new Promise((resolve) => {
      const find = () => [...room.peers.values()].find((p) => p.role === 'host');
      if (find()) return resolve(find());
      const off = room.on('peer', () => find() && (off(), resolve(find())));
    });
    clearTimeout(slow);
    if (this.room !== room) return;
    status(`CONNECTING TO ${clean(host.name, 'HOST')}…`);
    const ch = await room.connect(host.id);
    if (this.room !== room) return ch.close();
    const hello = () => ch.send({ t: 'hello', name: this.myName() });
    hello();
    const again = setInterval(hello, 2000);
    ch.on('message', (msg) => {
      if (msg.t === 'full') {
        clearInterval(again);
        status('THIS GAME IS ALREADY FULL.');
      }
      if (msg.t !== 'start' || this.session) return;
      clearInterval(again);
      this.begin('guest', { names: { l: clean(msg.name, 'HOST'), r: this.myName() } });
      this.wire(ch);
      this.beep(660, 120);
    });
    ch.on('close', () => clearInterval(again));
  }

  /** A game link in the address: join it. */
  route() {
    const secret = secretOf(location.hash.slice(1));
    if (secret) this.join(secret);
  }

  // ---- the loop ----

  sounds(c) {
    const before = this.session.counters;
    if (c.h > before.h) this.beep(520);
    if (c.k > before.k) this.beep(300, 40);
    if (c.p > before.p) this.beep(180, 250);
    this.session.counters = c;
  }

  tick(dt, now) {
    const S = this.session;
    const s = S.s;
    if (S.mode === 'guest') {
      s.r = this.steer(s.r, dt);
      const every = S.ch?.kind === 'direct' ? 33 : 80;
      if (S.ch && now - S.lastSend > every && s.r !== S.lastY) {
        S.ch.send({ t: 'p', y: Math.round(s.r * 10) / 10 });
        S.lastSend = now;
        S.lastY = s.r;
      }
      const snap = S.snap;
      if (snap) {
        s.l += (snap.l - s.l) * Math.min(1, dt * 18);
        s.ls = snap.ls;
        s.rs = snap.rs;
        s.ph = snap.ph;
        s.w = snap.w;
        this.sounds({ h: snap.h, k: snap.k, p: snap.p });
        Object.assign(s, extrapolate(snap, now - S.snapAt));
      }
      return this.showEnd();
    }
    // cpu / host: the authoritative simulation
    S.acc += dt;
    while (S.acc >= DT) {
      s.l = this.steer(s.l, DT);
      if (S.mode === 'cpu') cpuMove(s, DT);
      else s.r += (S.remoteY - s.r) * Math.min(1, DT * 30);
      step(s, DT);
      S.acc -= DT;
    }
    this.sounds({ h: s.hits, k: s.walls, p: s.points });
    if (S.mode === 'host' && S.ch) {
      const every = S.ch.kind === 'direct' ? 33 : 80;
      if (now - S.lastSend > every) {
        S.ch.send(snapshot(s, ++S.seq));
        S.lastSend = now;
      }
    }
    this.showEnd();
  }

  showEnd() {
    const S = this.session;
    if (S.s.ph !== 'over') {
      S.shownEnd = false;
      return;
    }
    if (S.shownEnd || this.view.overlay) return;
    S.shownEnd = true;
    const mine = S.s.w === S.side;
    this.beep(mine ? 880 : 140, 400);
    const name = S.s.w === 'l' ? S.names.l : S.names.r;
    this.overlay({
      title: mine ? 'YOU WIN' : `${name} WINS`,
      score: `${S.s.ls} : ${S.s.rs}`,
      buttons: [
        ['rematch', S.mode === 'guest' ? '[ASK FOR REMATCH]' : '[REMATCH]'],
        ['menu', '[MENU]'],
      ],
    });
  }

  draw(now) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = GREEN;
    ctx.shadowColor = GREEN;
    for (let y = 8; y < H; y += 26) ctx.fillRect(W / 2 - 2, y, 4, 14);
    const S = this.session;
    const s = S?.s;
    if (!s) return;
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.ls), W / 4, 76);
    ctx.fillText(String(s.rs), (3 * W) / 4, 76);
    ctx.shadowBlur = 12;
    ctx.fillRect(PX, s.l, PW, PH);
    ctx.fillRect(W - PX - PW, s.r, PW, PH);
    if (s.ph === 'play' || Math.floor(now / 250) % 2) ctx.fillRect(s.bx, s.by, BALL, BALL);
    ctx.shadowBlur = 0;
    // Mark your own paddle.
    ctx.fillRect(S.side === 'l' ? PX - 8 : W - PX + 4, (S.side === 'l' ? s.l : s.r) + PH / 2 - 3, 4, 6);
    if (s.ph === 'serve' && s.ls + s.rs === 0) {
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillText(`FIRST TO ${WIN}`, W / 2, H - 40);
    }
  }
}
