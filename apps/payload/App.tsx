// Payload: files straight from one browser to another. The link's fragment
// is a room secret; the sender's page serves the files while it is open.
// Texts are English for now, as Payload's always were.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createGun, DEFAULT_RELAYS, relaysUp } from '../../shared/p2p.js';
import { pickPeople } from '../../shared/people-ui.js';
import { qrSvg } from '../../shared/qr.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useKiwi, usePeople, useTick } from '../../ui/hooks';
import { toast } from '../../ui/toast';
import { Receiving } from './receiver.js';
import { Sharing } from './sender.js';
import { formatBytes } from './transfer.js';

function setting(key: string): any {
  try {
    return JSON.parse(localStorage.getItem(`payload.${key}`) || 'null');
  } catch {
    return null;
  }
}
const relayList: string[] = setting('relays') || DEFAULT_RELAYS;
const forceRelay = new URLSearchParams(location.search).has('relay') || setting('forceRelay') === true;
const SECRET = /^[\w-]{22}$/;

function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
const pct = (a: number, b: number) => (b ? Math.min(100, Math.floor((a / b) * 100)) : 100);
const kindLabel = (kind?: string) => (kind === 'direct' ? 'Direct P2P' : 'Via gun relays');

/** Re-render every `ms` (rates and progress move on their own). */
function useEvery(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function RelaysPill({ gun }: { gun: any }) {
  useEvery(1500);
  const up = relaysUp(gun);
  return (
    <span
      className="relays"
      id="relays"
      data-state={up ? 'on' : 'off'}
      title={up ? `Connected to ${up} of ${relayList.length} relays` : 'No relay reachable — you can’t find each other right now'}
    >
      <span className="dot" />
      <span id="relayText">{`${up}/${relayList.length}`}</span>
    </span>
  );
}

function FileList({ files, states }: { files: { name: string; size: number }[]; states?: { state: string; save?: () => void }[] }) {
  return (
    <ul className="files">
      {files.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a transfer's file list never changes order, and two files may share a name
        <li key={i} data-file={i}>
          <span className="file-name">{f.name}</span>
          <span className="file-size">{formatBytes(f.size)}</span>
          <span className="file-state">
            {states?.[i]?.state === 'receiving' ? 'receiving…' : null}
            {states?.[i]?.state === 'verified' ? (
              <>
                <span className="ok">✓ verified</span>{' '}
                <button type="button" className="link-btn" onClick={() => states[i].save?.()}>
                  save again
                </button>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Bar({ value, ok = false, id }: { value: number; ok?: boolean; id?: string }) {
  return (
    <div className={`bar${ok ? ' ok' : ''}`} id={id}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function Sending({ sharing, onStop }: { sharing: Sharing; onStop: () => void }) {
  const people = usePeople();
  const kiwi = useKiwi();
  useTick(useCallback((fn: () => void) => sharing.onChange(fn), [sharing]));
  useEvery(1000);
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!sharing.link) {
    const files = sharing.prepared;
    return (
      <section className="card">
        <h2>Fingerprinting…</h2>
        <p className="muted">
          Hashing {files.length === 1 ? files[0]?.name : 'the files'} ({formatBytes(sharing.total)}) so the other side can check every piece.
        </p>
        <Bar value={Math.round(sharing.progress * 100)} id="prep" />
      </section>
    );
  }
  const copy = async () => {
    await navigator.clipboard.writeText(sharing.link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const toFriends = async () => {
    const pks: string[] = await pickPeople(people, { base: kiwi.base });
    if (!pks.length) return;
    try {
      const n = await people.share('payload', { type: 'link', url: sharing.link }, pks);
      toast(`Sent to ${n} ${n === 1 ? 'person' : 'people'}.`, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const receivers = [...sharing.receivers];
  return (
    <>
      <section className="card">
        <h2>Ready to send</h2>
        <FileList files={sharing.prepared} />
        <div className="copy-field">
          <input id="link" readOnly value={sharing.link} aria-label="Link for the receiver" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-primary" id="copy" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="row">
          {'share' in navigator ? (
            <button type="button" className="btn" id="share" onClick={() => navigator.share({ title: 'Payload', url: sharing.link }).catch(() => {})}>
              Share…
            </button>
          ) : null}
          <button type="button" className="btn" id="showQr" onClick={() => setQr((q) => !q)}>
            QR code
          </button>
          {people ? (
            <button type="button" className="btn" id="toFriends" onClick={() => void toFriends()}>
              Send to friends…
            </button>
          ) : null}
        </div>
        <div className="qr-box" id="qrBox" hidden={!qr} dangerouslySetInnerHTML={{ __html: qr ? qrSvg(sharing.link) : '' }} />
        <p className="fp">
          Fingerprint <code>{sharing.fp}</code> — the receiver sees the same code.
        </p>
        <p className="note">
          Keep this tab open until they’re done: files go straight from here to them. Anyone with the link can download the files while you share.
        </p>
      </section>
      <section className="card">
        <h2>Receivers</h2>
        <ul className="receivers" id="receivers">
          {receivers.length ? (
            receivers.map(([cid, r]: [string, any]) => {
              const state =
                r.state === 'done'
                  ? '✓ Received and verified'
                  : r.state === 'gone'
                    ? 'Disconnected'
                    : r.got
                      ? `${formatBytes(r.got)} of ${formatBytes(sharing.total)} · ${formatBytes(r.meter.rate())}/s`
                      : 'Connected';
              return (
                <li key={cid}>
                  <div className="rcv-line">
                    <b>{r.name}</b>
                    <span className="tag">{kindLabel(r.kind)}</span>
                    <span className="rcv-state">{state}</span>
                  </div>
                  <Bar value={pct(r.got, sharing.total)} ok={r.state === 'done'} />
                </li>
              );
            })
          ) : (
            <li className="muted">Nobody yet — send them the link.</li>
          )}
        </ul>
        <button type="button" className="btn btn-danger" id="stop" onClick={onStop}>
          Stop sharing
        </button>
      </section>
    </>
  );
}

function SendView({ gun }: { gun: any }) {
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!sharing) return;
    let wake: any = null;
    (navigator as any).wakeLock
      ?.request('screen')
      .then((w: any) => (wake = w))
      .catch(() => {});
    return () => {
      sharing.stop();
      wake?.release().catch(() => {});
    };
  }, [sharing]);
  const send = (files: FileList | null) => {
    if (!files?.length) return;
    const s = new Sharing(gun, { name: deviceName(), forceRelay });
    setSharing(s);
    s.start(files).catch((err: Error) => toast(err.message, 'error'));
  };
  if (sharing) return <Sending sharing={sharing} onStop={() => setSharing(null)} />;
  return (
    <>
      <section className="intro">
        <h1>Send files straight to another browser.</h1>
        <p>
          Both of you keep this page open. Files go directly between the two browsers when the network allows — otherwise encrypted through gun relays — and
          every 64 KB piece is checked with SHA-256 on arrival.
        </p>
      </section>
      <label
        className={`drop${over ? ' over' : ''}`}
        id="drop"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files);
        }}
      >
        <input type="file" id="files" multiple hidden onChange={(e) => send(e.target.files)} />
        <svg className="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V3m-5 5 5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
        <strong>Drop files here</strong>
        <span>or click to choose · nothing is uploaded until someone opens your link</span>
      </label>
      <form
        className="open-link"
        id="openLink"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get('link') || '').trim();
          const secret = v.includes('#') ? v.slice(v.indexOf('#') + 1) : v;
          if (SECRET.test(secret)) location.hash = secret;
        }}
      >
        <input name="link" placeholder="Got a link? Paste it here" autoComplete="off" spellCheck={false} aria-label="Payload link" />
        <button type="submit" className="btn">
          Receive
        </button>
      </form>
    </>
  );
}

function ReceiveView({ gun, secret }: { gun: any; secret: string }) {
  const receiving = useMemo(() => new Receiving(gun, secret, { name: deviceName(), forceRelay }), [gun, secret]);
  useTick(useCallback((fn: () => void) => receiving.onChange(fn), [receiving]));
  useEffect(() => {
    receiving.open().catch((err: Error) => receiving.fail(err.message));
    return () => receiving.stop();
  }, [receiving]);
  const r = receiving;
  const m = r.manifest;
  if (!m) {
    return (
      <section className="card" id="recv">
        <div className="state">
          <span className="spinner" />
          <p id="status">{r.error || r.status}</p>
        </div>
      </section>
    );
  }
  const rate = r.done
    ? `All ${m.files.length === 1 ? 'done' : `${m.files.length} files done`} — every piece matched its SHA-256 hash.`
    : r.started
      ? `${formatBytes(r.got)} of ${formatBytes(r.total)} · ${formatBytes(r.meter.rate())}/s · ${kindLabel(r.ch?.kind)}`
      : '';
  return (
    <section className="card" id="recv">
      <div id="ready">
        <p className="from">
          From <b>{m.name || r.sender?.name || 'the sender'}</b>{' '}
          <span className="tag" id="peerKind">
            {kindLabel(r.ch?.kind)}
          </span>
        </p>
        <FileList files={m.files} states={r.files} />
        <p className="fp">
          Fingerprint <code>{r.fp}</code> — ask the sender if theirs matches.
        </p>
        <Bar value={pct(r.got, r.total)} ok={r.done} id="totalBar" />
        <p className="muted" id="rate">
          {rate}
        </p>
        <p className="error" id="error" hidden={!r.error}>
          {r.error}
        </p>
        <button type="button" className="btn btn-primary" id="go" hidden={r.started} onClick={() => void r.download()}>
          Download {m.files.length === 1 ? '' : `${m.files.length} files `}({formatBytes(r.total)})
        </button>
      </div>
    </section>
  );
}

export function PayloadApp() {
  const mount = useMount();
  const people = usePeople();
  const gun = useMemo(() => createGun(relayList), []);
  const secret = location.hash.slice(1);
  const receiving = SECRET.test(secret);
  useEffect(() => {
    const reload = () => location.reload();
    addEventListener('hashchange', reload);
    return () => removeEventListener('hashchange', reload);
  }, []);
  useEffect(() => {
    document.title = receiving ? `Receiving · ${mount.name}` : mount.name;
  }, [receiving, mount.name]);
  // A link a friend sent from their Payload: one tap opens it here.
  useEffect(() => {
    if (!people) return;
    return people.onShare('payload', (share: any) => {
      if (typeof share.payload?.url !== 'string') return;
      toast(`${share.name} sent you files.`, 'info', 15000, { label: 'Open', href: share.payload.url, onClick: () => people.consume(share.id) });
    });
  }, [people]);
  return (
    <AppShell
      right={<RelaysPill gun={gun} />}
      settings={null}
      footer={'direct over WebRTC, found each other over <a href="https://gun.eco" rel="noopener">gun</a>'}
    >
      {receiving ? <ReceiveView gun={gun} secret={secret} /> : <SendView gun={gun} />}
    </AppShell>
  );
}
