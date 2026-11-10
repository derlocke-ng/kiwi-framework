// Calls on screen (0.31): the call itself (the others' pictures, or their
// names while their camera is off; mine small in a corner; microphone,
// camera, the other camera, hang up), the sheet that rings when someone
// calls, and the bar that leads back to a call from the chat's other
// screens. The call and its steps are ../calling.ts; the media and the room
// are shared/calls.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RING_FOR } from '../../../shared/calls.js';
import { fingerprint, now } from '../../../shared/events.js';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { toastError } from '../../../ui/toast';
import { answerCall, declineCall, endCall, useActiveCall } from '../calling';
import { useDm } from '../state';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Where a call's conversation or group is in the chat. */
export function threadHash(groups: any, line: { conv: string; group?: boolean }): string {
  if (!line.group) return `#/dm/${line.conv}`;
  const g = groups?.entry(line.conv);
  return g ? `#/group/${line.conv}/${g.host}/${g.invite || '-'}/${encodeURIComponent(groups.info(line.conv)?.name || g.name || '')}` : '#/groups';
}

/** A conversation's or a group's name, for a call's title. */
export function useCallTitle() {
  const t = useT();
  const people = usePeople();
  const groups = useGroups();
  return useCallback(
    (line: { conv: string; group?: boolean; from?: string }) =>
      line.group
        ? groups?.info(line.conv)?.name || groups?.entry(line.conv)?.name || t('chat.group.title')
        : people?.friends?.().find((f: any) => f.pk === line.conv)?.name || people?.nameOf?.(line.conv) || fingerprint(line.conv),
    [people, groups, t],
  );
}

function Video({ stream, muted = false, mirror = false, id }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; id?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} id={id} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} />;
}

/** The call this page is in; when it ends (here or by the other), back to its conversation. */
export function CallScreen() {
  const t = useT();
  const kiwi = useKiwi();
  const groups = useGroups();
  const active = useActiveCall();
  const [, setTick] = useState(0);
  const back = useRef('#/');
  if (active) back.current = threadHash(groups, active);
  useEffect(() => active?.session.on(() => setTick((n) => n + 1)), [active]);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!active) location.replace(`${location.pathname}${location.search}${back.current}`);
  }, [active]);
  if (!active) return null;
  const s = active.session;
  const peers = [...s.peers.entries()];
  const failed = peers.find(([, p]) => p.state === 'failed');
  const status =
    s.state === 'connected'
      ? clock(s.duration)
      : peers.length
        ? t('call.connecting')
        : active.outgoing && !active.group
          ? t('call.waiting')
          : t('call.connecting');
  return (
    <section className="call" id="call" data-state={s.state === 'connected' && !failed ? 'connected' : s.state}>
      <div className="call-head">
        <b>{active.title}</b>
        <span id="callStatus">{status}</span>
      </div>
      {failed ? (
        <p className="call-failed" id="callFailed">
          <Icon name="triangle-alert" /> {t('call.failed', { name: failed[1].name || active.title })}
        </p>
      ) : null}
      <div className={`call-grid n${Math.max(1, peers.length)}`}>
        {peers.length ? (
          peers.map(([id, p]) => (
            <div key={id} className={`call-tile${s.showing(id) ? '' : ' voice'}`} data-peer={id.slice(0, 8)} data-state={p.state}>
              <Video stream={p.stream} />
              {s.showing(id) ? null : <span className="call-avatar">{(p.name || active.title || '?')[0].toUpperCase()}</span>}
              <span className="call-name">{p.name || (active.group ? t('call.someone') : active.title)}</span>
            </div>
          ))
        ) : (
          <div className="call-tile waiting">
            <span className="call-avatar">{(active.title || '?')[0].toUpperCase()}</span>
          </div>
        )}
      </div>
      {s.cameraOn ? <Video id="selfView" stream={s.local} muted mirror={s.facing === 'user'} /> : null}
      <div className="call-controls">
        <button
          type="button"
          className={`call-btn${s.muted ? ' off' : ''}`}
          data-act="mute"
          aria-pressed={s.muted}
          aria-label={t('call.mic')}
          title={t('call.mic')}
          onClick={() => s.setMuted(!s.muted)}
        >
          <Icon name={s.muted ? 'mic-off' : 'mic'} />
        </button>
        <button
          type="button"
          className={`call-btn${s.cameraOn ? '' : ' off'}`}
          data-act="camera"
          aria-pressed={!s.cameraOn}
          aria-label={t('call.camera')}
          title={t('call.camera')}
          onClick={() => s.setCamera(!s.cameraOn).catch(toastError)}
        >
          <Icon name={s.cameraOn ? 'video' : 'video-off'} />
        </button>
        {s.cameraOn ? (
          <button
            type="button"
            className="call-btn"
            data-act="flip"
            aria-label={t('call.flip')}
            title={t('call.flip')}
            onClick={() => s.switchCamera().catch(toastError)}
          >
            <Icon name="switch-camera" />
          </button>
        ) : null}
        <button
          type="button"
          className="call-btn hangup"
          data-act="hangup"
          aria-label={t('call.hangup')}
          title={t('call.hangup')}
          onClick={() => endCall(kiwi).catch(toastError)}
        >
          <Icon name="phone-off" />
        </button>
      </div>
    </section>
  );
}

/** Back to the call from the chat's other screens. */
export function CallBar() {
  const t = useT();
  const active = useActiveCall();
  if (!active) return null;
  return (
    <a href="#/call" className="call-bar" id="callBar">
      <Icon name={active.info.video ? 'video' : 'phone'} />
      <span>{t('call.bar', { name: active.title })}</span>
    </a>
  );
}

/** A soft ring while the sheet is up, where the browser lets a page make a sound; a buzz on a phone. */
function useRingtone(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {}
    const ring = () => {
      navigator.vibrate?.([300, 200, 300]);
      if (ctx?.state !== 'running') return void ctx?.resume().catch(() => {});
      for (const [at, f] of [
        [0, 660],
        [0.25, 880],
      ]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + at);
        o.stop(ctx.currentTime + at + 0.25);
      }
    };
    ring();
    const id = setInterval(ring, 2000);
    return () => {
      clearInterval(id);
      ctx?.close().catch(() => {});
    };
  }, [on]);
}

/**
 * The sheet that rings: a call from a friend, or in one of my groups, while it is fresh and no one of my devices
 * answered it. `want`: a call's id from the address (a toast on another page led here).
 */
export function IncomingCall({ want = '' }: { want?: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const dm = useDm();
  const people = usePeople();
  const groups = useGroups();
  const identity = useIdentity();
  const active = useActiveCall();
  const title = useCallTitle();
  const [lines, setLines] = useState<Map<string, any>>(new Map());
  const [busy, setBusy] = useState(false);
  const rings = useCallback(
    (line: any) =>
      line?.system === 'call' &&
      line.call.state === 'ringing' &&
      line.from !== identity.pk &&
      now() - line.at < RING_FOR &&
      Boolean(line.call.secret) &&
      (line.group ? Boolean(groups?.entry(line.conv)) : Boolean(people?.isFriend(line.from))), // a stranger's call is only a line
    [identity.pk, groups, people],
  );
  useEffect(
    () =>
      dm.onCall((line: any) =>
        setLines((cur) => {
          const next = new Map(cur);
          if (rings(line)) next.set(line.call.id, line);
          else next.delete(line.call.id);
          return next;
        }),
      ),
    [dm, rings],
  );
  useEffect(() => {
    if (!want) return;
    dm.callById(want).then((line: any) => rings(line) && setLines((cur) => new Map(cur).set(want, line)));
  }, [dm, want, rings]);
  // a ring that nobody called off still stops when its time is up
  useEffect(() => {
    if (!lines.size) return;
    const id = setInterval(() => setLines((cur) => new Map([...cur].filter(([, l]) => now() - l.at < RING_FOR))), 1000);
    return () => clearInterval(id);
  }, [lines.size]);
  const line = active ? null : [...lines.values()].sort((a, b) => b.at - a.at)[0] || null;
  useRingtone(Boolean(line));
  if (!line) return null;
  const name = line.group ? people?.nameOf?.(line.from) || fingerprint(line.from) : title(line);
  const heading = line.group
    ? t('call.incomingGroup', { name, group: title(line) })
    : t(line.call.video ? 'call.incomingVideo' : 'call.incomingVoice', { name });
  const answer = async (video: boolean) => {
    setBusy(true);
    try {
      await answerCall(kiwi, line, { video, title: title(line) });
      location.hash = '#/call';
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
      setLines(new Map());
    }
  };
  const decline = () => {
    setLines((cur) => {
      const next = new Map(cur);
      next.delete(line.call.id);
      return next;
    });
    if (!line.group) declineCall(kiwi, line).catch(toastError);
  };
  return (
    <div className="incoming" id="incomingCall" role="alertdialog" aria-label={heading} data-call={line.call.id}>
      <span className="call-avatar">{(name || '?')[0].toUpperCase()}</span>
      <div className="incoming-main">
        <b>{heading}</b>
        <span className="muted">
          <Icon name={line.call.video ? 'video' : 'phone'} /> {t(line.call.video ? 'call.video' : 'call.voice')}
        </span>
      </div>
      <div className="incoming-actions">
        <button
          type="button"
          className="call-btn hangup"
          data-act="decline"
          aria-label={t('call.decline')}
          title={t('call.decline')}
          disabled={busy}
          onClick={decline}
        >
          <Icon name="phone-off" />
        </button>
        <button
          type="button"
          className="call-btn answer"
          data-act="answer"
          aria-label={t('call.answer')}
          title={t('call.answer')}
          disabled={busy}
          onClick={() => answer(false)}
        >
          <Icon name="phone" />
        </button>
        {line.call.video ? (
          <button
            type="button"
            className="call-btn answer"
            data-act="answer-video"
            aria-label={t('call.answerVideo')}
            title={t('call.answerVideo')}
            disabled={busy}
            onClick={() => answer(true)}
          >
            <Icon name="video" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
