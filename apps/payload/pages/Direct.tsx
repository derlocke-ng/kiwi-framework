// A direct transfer: the sender's page serves the files to whoever opens the
// link while both pages are open; nothing is stored anywhere. Every 64 KB piece
// is checked with SHA-256, both sides show the same fingerprint, a lost
// connection is found again (sender.js, receiver.js; shared/p2p.js finds the
// other side through the hub's relays and connects the browsers).
import { useCallback, useEffect, useState } from 'react';
import { qrSvg } from '../../../shared/qr.js';
import { Icon } from '../../../ui/components';
import { useKiwi, usePeople, useT, useTick } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { sendAsMessage } from '../../../ui/share';
import { copyText, toast } from '../../../ui/toast';
import { Receiving } from '../receiver.js';
import { Sharing } from '../sender.js';
import { deviceName, forceRelay, size } from '../state';

const pct = (a: number, b: number) => (b ? Math.min(100, Math.floor((a / b) * 100)) : 100);

/** Re-render every `ms` (rates and progress move on their own). */
function useEvery(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function Bar({ value, ok = false, id }: { value: number; ok?: boolean; id?: string }) {
  return (
    <div className={`bar${ok ? ' ok' : ''}`} id={id} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function useKindLabel() {
  const t = useT();
  return (kind?: string) => (kind === 'direct' ? t('pl.direct.p2p') : t('pl.direct.viaRelays'));
}

function FileList({ files, states }: { files: { name: string; size: number }[]; states?: { state: string; save?: () => void }[] }) {
  const t = useT();
  return (
    <ul className="files">
      {files.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a transfer's file list never changes order, and two files may share a name
        <li key={i} data-file={i}>
          <span className="file-name">{f.name}</span>
          <span className="file-size">{size(f.size)}</span>
          <span className="file-state">
            {states?.[i]?.state === 'receiving' ? t('pl.direct.receivingFile') : null}
            {states?.[i]?.state === 'verified' ? (
              <>
                <span className="ok">{t('pl.verified')}</span>{' '}
                <button type="button" className="link-btn" onClick={() => states[i].save?.()}>
                  {t('pl.saveAgain')}
                </button>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The sending side: hash, then the link and who is receiving, until the person stops. */
export function DirectSend({ files, onStop }: { files: File[]; onStop: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const people = usePeople();
  const kindLabel = useKindLabel();
  // one transfer per mount of this screen, made and stopped by the effect (React may mount it twice in development)
  const [sharing, setSharing] = useState<Sharing | null>(null);
  useTick(useCallback((fn: () => void) => (sharing ? sharing.onChange(fn) : () => {}), [sharing]));
  useEvery(1000);
  const [qr, setQr] = useState(false);
  useEffect(() => {
    const s = new Sharing(kiwi.net, { name: deviceName(), forceRelay: forceRelay() });
    setSharing(s);
    s.start(files).catch((err: Error) => toast(err.message, 'error'));
    let wake: any = null;
    (navigator as any).wakeLock
      ?.request('screen')
      .then((w: any) => (wake = w))
      .catch(() => {});
    return () => {
      s.stop();
      wake?.release().catch(() => {});
    };
  }, [kiwi, files]);
  if (!sharing) return null;
  if (!sharing.link) {
    return (
      <section className="card">
        <h2>{t('pl.direct.hashing')}</h2>
        <p className="muted">{t('pl.direct.hashingText', { size: size(sharing.total) })}</p>
        <Bar value={Math.round(sharing.progress * 100)} id="prep" />
      </section>
    );
  }
  const receivers = [...sharing.receivers];
  const chat = chatMount();
  return (
    <>
      <section className="card" id="directCard">
        <h2>
          <Icon name="radio-tower" />
          {t('pl.direct.ready')}
        </h2>
        <FileList files={sharing.prepared} />
        <div className="copy-field">
          <input id="link" readOnly value={sharing.link} aria-label={t('pl.linkLabel')} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-primary" id="copy" onClick={() => void copyText(sharing.link, t('pl.theLink'))}>
            <Icon name="copy" />
            <span>{t('pl.copy')}</span>
          </button>
        </div>
        <div className="pl-actions">
          {'share' in navigator ? (
            <button type="button" className="btn" id="share" onClick={() => navigator.share({ title: 'Payload', url: sharing.link }).catch(() => {})}>
              <Icon name="share-2" />
              <span>{t('pl.shareSheet')}</span>
            </button>
          ) : null}
          {people && chat ? (
            <button
              type="button"
              className="btn"
              id="shareChat"
              onClick={() => void sendAsMessage(kiwi, people, t('pl.direct.message', { link: sharing.link })).catch(() => {})}
            >
              <Icon name="message-circle" />
              <span>{t('pl.sendIn', { app: chat.name })}</span>
            </button>
          ) : null}
          <button type="button" className="btn" id="showQr" onClick={() => setQr((q) => !q)}>
            <Icon name="qr-code" />
            <span>{t('pl.qr')}</span>
          </button>
        </div>
        <div className="qr-box" id="qrBox" hidden={!qr} dangerouslySetInnerHTML={{ __html: qr ? qrSvg(sharing.link) : '' }} />
        <p className="fp">
          {t('pl.direct.fingerprint')} <code>{sharing.fp}</code> · {t('pl.direct.fingerprintSender')}
        </p>
        <p className="note">{t('pl.direct.keepOpen')}</p>
      </section>
      <section className="card">
        <h2>{t('pl.direct.receivers')}</h2>
        <ul className="receivers" id="receivers">
          {receivers.length ? (
            receivers.map(([cid, r]: [string, any]) => {
              const state =
                r.state === 'done'
                  ? t('pl.direct.receivedVerified')
                  : r.state === 'gone'
                    ? t('pl.direct.disconnected')
                    : r.got
                      ? t('pl.direct.progress', { got: size(r.got), total: size(sharing.total), rate: size(r.meter.rate()) })
                      : t('pl.direct.connected');
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
            <li className="muted">{t('pl.direct.nobody')}</li>
          )}
        </ul>
        <button type="button" className="btn btn-danger" id="stop" onClick={onStop}>
          {t('pl.direct.stop')}
        </button>
      </section>
    </>
  );
}

/** The receiving side of a direct link: find the sender, then download, checked piece by piece. */
export function DirectReceive({ secret }: { secret: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const kindLabel = useKindLabel();
  const [receiving, setReceiving] = useState<Receiving | null>(null);
  useTick(useCallback((fn: () => void) => (receiving ? receiving.onChange(fn) : () => {}), [receiving]));
  useEvery(1000);
  useEffect(() => {
    const r = new Receiving(kiwi.net, secret, { name: deviceName(), forceRelay: forceRelay() });
    setReceiving(r);
    r.open().catch((err: Error) => r.fail(err.message));
    return () => r.stop();
  }, [kiwi, secret]);
  if (!receiving) return null;
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
    ? t('pl.direct.allDone', { n: m.files.length })
    : r.started
      ? t('pl.direct.rate', { got: size(r.got), total: size(r.total), rate: size(r.meter.rate()), how: kindLabel(r.ch?.kind) })
      : '';
  return (
    <section className="card" id="recv">
      <div id="ready">
        <p className="from">
          {t('pl.from', { name: m.name || r.sender?.name || t('pl.theSender') })}{' '}
          <span className="tag" id="peerKind" data-kind={r.ch?.kind || ''}>
            {kindLabel(r.ch?.kind)}
          </span>
        </p>
        <FileList files={m.files} states={r.files} />
        <p className="fp">
          {t('pl.direct.fingerprint')} <code>{r.fp}</code> · {t('pl.direct.fingerprintReceiver')}
        </p>
        <Bar value={pct(r.got, r.total)} ok={r.done} id="totalBar" />
        <p className="muted" id="rate">
          {rate}
        </p>
        <p className="form-error" id="error" hidden={!r.error}>
          {r.error}
        </p>
        <button type="button" className="btn btn-primary" id="go" hidden={r.started} onClick={() => void r.download()}>
          <Icon name="download" />
          <span>{t('pl.direct.download', { n: m.files.length, size: size(r.total) })}</span>
        </button>
      </div>
    </section>
  );
}
