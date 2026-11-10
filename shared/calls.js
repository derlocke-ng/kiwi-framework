// Calls (0.31): voice and video between people who can already write to each
// other, in a conversation or a group. Ringing travels like a message: a
// sealed event of kind 7833 in the conversation's gift wraps, or a member's
// event inside the group's seal (shared/chat.js, shared/groups.js), carrying
// the call's id, whether it starts with video, and a secret. That secret names
// a room the way Payload's direct transfers do (shared/p2p.js): presence and
// offers are ephemeral events sealed to its key under a key made for the
// visit, so relays learn neither who calls nor what is said, and keep none of
// it. The voices and pictures then go straight between the browsers (WebRTC,
// encrypted by DTLS-SRTP), each to each in a group (a mesh: small groups).
// When no direct path exists (two phones behind strict NATs), only a TURN
// server the hub names (`ice` in hub.json or hub.local.json) gets them through.
//
// What a call leaves in the conversation is one line, kept like a message:
// missed, declined, or how long it lasted (mergeCall in shared/chatlog.js).
//
//   const call = new CallSession(kiwi.net, { secret, video: true, name, iceServers });
//   await call.start();   call.on('change', render);   call.streams (peer -> MediaStream)
//   call.setMuted(true);  await call.setCamera(false);  await call.switchCamera();  call.hangup();

import { ICE_SERVERS, Room, randomSecret } from './p2p.js';
import { bytesToHex } from './nostr.mjs';

export const RING_FOR = 45; // seconds a call rings before it counts as missed
export const MAX_IN_CALL = 6; // a group call is a mesh: everyone sends to everyone
const GATHER = 2500; // ms to collect a connection's ways in before the offer goes (no trickle: fewer events)

/** A new call's id and the secret of its room. */
export const newCall = () => ({ id: bytesToHex(crypto.getRandomValues(new Uint8Array(16))), secret: randomSecret(16) });

function gathered(pc, ms) {
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

export class CallSession {
  /**
   * @param {{ pool: any }} net  the page's network: its relays carry the room's ephemeral events
   * @param {{ secret: string, video?: boolean, name?: string, iceServers?: RTCIceServer[], media?: (c: MediaStreamConstraints) => Promise<MediaStream> }} opt
   */
  constructor(net, opt) {
    this.net = net;
    this.secret = opt.secret;
    this.video = Boolean(opt.video);
    this.name = opt.name || '';
    this.iceServers = opt.iceServers?.length ? opt.iceServers : ICE_SERVERS;
    this.getMedia = opt.media || ((c) => navigator.mediaDevices.getUserMedia(c));
    this.peers = new Map(); // peer id -> { pc, name, state, stream }
    this.listeners = new Set();
    this.muted = false;
    this.local = null; // my microphone and camera
    this.facing = 'user';
    this.state = 'idle'; // idle | waiting (nobody else yet) | connected | ended
    this.connectedAt = 0;
  }

  /** Called with the session whenever something changes (someone comes or goes, connects, mutes). */
  on(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  /** Microphone (and camera) on, into the room. */
  async start() {
    this.local = await this.getMedia({ audio: true, video: this.video ? { facingMode: this.facing } : false });
    this.room = new Room(this.net, { secret: this.secret, role: 'call', name: this.name });
    this.room.on('peer', (p) => this.meet(p));
    this.room.on('peer-update', (p) => {
      const known = this.peers.get(p.id);
      if (known) known.name = p.name;
      this.emit();
    });
    this.room.on('leave', (p) => this.drop(p.id));
    this.room.on('mail', (m) => this.signal(m).catch((err) => console.warn('call:', err)));
    await this.room.join();
    this.state = 'waiting';
    this.emit();
    return this;
  }

  /** Someone came into the room: of each two, the one with the lower id offers, so both never do. */
  meet(p) {
    if (this.peers.size >= MAX_IN_CALL - 1 || this.peers.has(p.id)) return;
    this.peers.set(p.id, { name: p.name, state: 'connecting', stream: null, pc: null });
    this.emit();
    if (this.room.peerId < p.id) this.offer(p.id).catch((err) => this.fail(p.id, err));
  }

  connection(id) {
    const peer = this.peers.get(id);
    if (peer.pc) return peer.pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    peer.pc = pc;
    peer.stream = new MediaStream();
    pc.addEventListener('track', (e) => {
      peer.stream.addTrack(e.track);
      // a camera turned off sends nothing: the track goes quiet ("muted"), and the screen shows a name instead
      e.track.addEventListener('mute', () => this.emit());
      e.track.addEventListener('unmute', () => this.emit());
      this.emit();
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        peer.state = 'connected';
        if (!this.connectedAt) this.connectedAt = Date.now();
        this.state = 'connected';
      } else if (pc.connectionState === 'failed') peer.state = 'failed';
      this.emit();
    });
    return pc;
  }

  /** My microphone and camera on a connection's senders (the camera's may be empty until it is turned on). */
  async attach(pc) {
    const [audio, video] = pc.getTransceivers();
    const mic = this.local?.getAudioTracks()[0] || null;
    const cam = this.local?.getVideoTracks()[0] || null;
    if (audio) {
      audio.direction = 'sendrecv';
      await audio.sender.replaceTrack(mic);
    }
    if (video) {
      video.direction = 'sendrecv';
      await video.sender.replaceTrack(cam);
    }
  }

  async offer(id) {
    const pc = this.connection(id);
    // always a voice and a picture both ways: the camera can come on later without a new offer
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'sendrecv' });
    await this.attach(pc);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, GATHER);
    await this.room.mail(id, { type: 'call-offer', sdp: pc.localDescription.sdp });
  }

  async signal(m) {
    if (!this.peers.has(m.from)) this.meet({ id: m.from, name: this.room.peers.get(m.from)?.name || '' });
    const peer = this.peers.get(m.from);
    if (!peer) return;
    if (m.type === 'call-offer') {
      const pc = this.connection(m.from);
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      await this.attach(pc);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc, GATHER);
      await this.room.mail(m.from, { type: 'call-answer', sdp: pc.localDescription.sdp });
    } else if (m.type === 'call-answer' && peer.pc && peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    }
  }

  fail(id, err) {
    console.warn('call:', err);
    const peer = this.peers.get(id);
    if (peer) peer.state = 'failed';
    this.emit();
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc?.close();
    this.peers.delete(id);
    this.emit();
  }

  /** Whether someone's camera is sending a picture now. */
  showing(id) {
    return Boolean(this.peers.get(id)?.stream?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
  }

  /** Microphone off or on; the others hear silence, not a gap. */
  setMuted(muted) {
    this.muted = Boolean(muted);
    for (const t of this.local?.getAudioTracks() || []) t.enabled = !this.muted;
    this.emit();
  }

  get cameraOn() {
    return Boolean(this.local?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled));
  }

  /** The camera on or off; on for the first time, it is asked for then. */
  async setCamera(on) {
    if (!on) {
      for (const t of this.local?.getVideoTracks() || []) {
        t.stop();
        this.local.removeTrack(t);
      }
    } else if (!this.cameraOn) {
      const cam = (await this.getMedia({ video: { facingMode: this.facing } })).getVideoTracks()[0];
      this.local.addTrack(cam);
    }
    for (const p of this.peers.values()) if (p.pc) await this.attach(p.pc);
    this.emit();
  }

  /** The other camera of a phone (front and back). */
  async switchCamera() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    if (this.cameraOn) {
      await this.setCamera(false);
      await this.setCamera(true);
    }
  }

  /** How long the call has been connected, in seconds. */
  get duration() {
    return this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0;
  }

  hangup() {
    if (this.state === 'ended') return;
    for (const p of this.peers.values()) p.pc?.close();
    this.peers.clear();
    for (const t of this.local?.getTracks() || []) t.stop();
    this.room?.leave();
    this.state = 'ended';
    this.emit();
  }
}
