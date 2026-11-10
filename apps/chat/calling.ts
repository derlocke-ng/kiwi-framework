// The call this page is in, kept while the person moves between the chat's
// screens (a bar at the top leads back to it), and what starts, answers and
// ends one: the session (shared/calls.js) and the call's steps in the
// conversation or the group (DirectMessages.call, Groups.call).
import { useSyncExternalStore } from 'react';
import { CallSession, newCall, RING_FOR } from '../../shared/calls.js';
import { t } from '../../shared/i18n.js';
import { toast } from '../../ui/toast';

export interface ActiveCall {
  session: CallSession;
  conv: string;
  group: boolean;
  title: string;
  outgoing: boolean;
  /** what every step of the call carries */
  info: { id: string; at: number; ms: number; caller: string; video: boolean; secret: string; expires: number };
}

let active: ActiveCall | null = null;
const listeners = new Set<() => void>();
const set = (a: ActiveCall | null) => {
  active = a;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The call this page is in, or null. */
export const useActiveCall = () => useSyncExternalStore(subscribe, () => active);
export const activeCall = () => active;

/** A step of the call to the others: a conversation's wraps or the group's seal. */
function step(kiwi: any, a: ActiveCall, action: string, extra: Record<string, unknown> = {}) {
  const info = { ...a.info, ...extra };
  return a.group ? kiwi.groups.call(a.conv, info, action) : kiwi.messages.call(a.conv, info, action);
}

function watch(kiwi: any, a: ActiveCall) {
  // two people: when the other hangs up, the call is over here too; a call nobody answers is called off
  let met = false;
  const offLine = kiwi.messages.onCall((line: any) => {
    // the other said no (on any of their devices): over, nothing more to tell them
    if (active === a && !a.group && a.outgoing && line.call.id === a.info.id && line.call.state === 'declined') {
      a.session.hangup();
      set(null);
      toast(t('call.declinedBy', { name: a.title }), 'info');
    }
  });
  const off = a.session.on((s: CallSession) => {
    if (s.peers.size) met = true;
    if (!a.group && met && !s.peers.size && s.state !== 'ended') endCall(kiwi).catch(() => {});
    if (s.state === 'ended') {
      off();
      offLine();
    }
  });
  if (a.outgoing)
    setTimeout(() => {
      if (active === a && !a.session.connectedAt) endCall(kiwi).catch(() => {});
    }, RING_FOR * 1000);
}

/** Ring a conversation or a group, and wait in the call's room. */
export async function startCall(kiwi: any, { conv, group = false, video = false, title }: { conv: string; group?: boolean; video?: boolean; title: string }) {
  if (active) return active;
  const { id, secret } = newCall();
  const me = kiwi.identity().pk;
  const expires = group ? kiwi.groups.expiresFor(conv) : await kiwi.messages.expiresFor(conv);
  const session = new CallSession(kiwi.net, { secret, video, name: kiwi.identity().alias || '', iceServers: kiwi.iceServers() });
  await session.start(); // the microphone and camera are asked for first: nothing rings if they are refused
  const rang = Date.now();
  const a: ActiveCall = {
    session,
    conv,
    group,
    title,
    outgoing: true,
    info: { id, at: Math.floor(rang / 1000), ms: rang % 1000, caller: me, video, secret, expires },
  };
  set(a);
  watch(kiwi, a);
  await step(kiwi, a, 'ring');
  return a;
}

/** Answer a ringing call (or join a group's) from its line in the conversation. */
export async function answerCall(kiwi: any, line: any, { video, title }: { video: boolean; title: string }) {
  if (active) return active;
  const c = line.call;
  const session = new CallSession(kiwi.net, { secret: c.secret, video, name: kiwi.identity().alias || '', iceServers: kiwi.iceServers() });
  await session.start();
  const a: ActiveCall = {
    session,
    conv: line.conv,
    group: Boolean(line.group),
    title,
    outgoing: false,
    info: { id: c.id, at: line.at, ms: line.t - line.at * 1000, caller: line.from, video: c.video, secret: c.secret, expires: line.expires || 0 },
  };
  set(a);
  watch(kiwi, a);
  await step(kiwi, a, 'answer');
  return a;
}

/** No to a ringing call: the caller is told, my other devices stop ringing. */
export function declineCall(kiwi: any, line: any) {
  const c = line.call;
  const info = { id: c.id, at: line.at, ms: line.t - line.at * 1000, caller: line.from, video: c.video, expires: line.expires || 0 };
  return line.group ? kiwi.groups.call(line.conv, info, 'decline') : kiwi.messages.call(line.conv, info, 'decline');
}

/** Hang up: how long it went is the line's; unanswered, it was called off. In a group, it ends with the last one out. */
export async function endCall(kiwi: any) {
  const a = active;
  if (!a) return;
  const { session } = a;
  const duration = session.duration;
  const alone = !session.peers.size;
  session.hangup();
  set(null);
  if (session.connectedAt) {
    if (!a.group || alone) await step(kiwi, a, 'end', { duration });
  } else if (a.outgoing) await step(kiwi, a, 'cancel');
}
