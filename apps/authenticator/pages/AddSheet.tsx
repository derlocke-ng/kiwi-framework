// Adding accounts: a service's QR code through the camera or from a picture
// (a screenshot of it), or its link or secret pasted or typed. What was read
// is shown before it is added: the name, the account and the code it gives
// now, which the service asks for to finish setting up. A Google Authenticator
// export brings all its accounts at once.
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ALGORITHMS, spaced, totp } from '../../../shared/totp.js';
import { fromAuthenticator } from '../../../shared/vaultstore.js';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { useVault } from '../../../ui/vault/VaultProvider';
import { Modal } from '../../../ui/widgets/Modal';
import { entriesFrom, readQr, readQrFile } from '../data/scan.js';
import { useEntries } from '../state';

export function AddSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const vault = useVault();
  const entries = useEntries();
  const [found, setFound] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<string>('');

  // what was read: shown with the code it gives now, so the service's setup can be finished right away
  useEffect(() => {
    if (found.length !== 1) return setPreview('');
    let live = true;
    totp(found[0]).then((c) => live && setPreview(spaced(c.code)));
    return () => {
      live = false;
    };
  }, [found]);

  const take = (text: string | null) => {
    const entries = text ? entriesFrom(text) : [];
    if (!entries.length) return setError(text ? t('au.notAnAccount') : t('au.noQr'));
    setError('');
    setFound(entries);
  };
  const add = async () => {
    const known = new Set(entries.map((e) => e.secret));
    const fresh = found.filter((e) => !known.has(e.secret));
    await vault.store.putAll(fresh.map(fromAuthenticator));
    toast(fresh.length ? t('au.added', { n: fresh.length }) : t('au.alreadyThere'), fresh.length ? 'success' : 'info');
    onClose();
  };
  const manual = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = String(f.get('text') || '').trim();
    if (text.includes('://')) return take(text);
    const entries = entriesFrom(text);
    if (!entries.length) return setError(t('au.notAnAccount'));
    const [one] = entries;
    take(null);
    setError('');
    setFound([
      {
        ...one,
        issuer: String(f.get('issuer') || '').trim(),
        account: String(f.get('account') || '').trim(),
        algorithm: String(f.get('algorithm') || 'SHA1'),
        digits: Number(f.get('digits') || 6),
        period: Number(f.get('period') || 30),
      },
    ]);
  };

  return (
    <Modal open wide id="addSheet" title={t('au.addTitle')} onClose={onClose}>
      <canvas ref={canvas} hidden />
      {found.length ? (
        <div id="found">
          <ul className="au-found">
            {found.map((e) => (
              <li key={e.id}>
                <b>{e.issuer || e.account || t('au.unnamed')}</b>
                {e.issuer && e.account ? <span className="muted small"> · {e.account}</span> : null}
              </li>
            ))}
          </ul>
          {preview ? (
            <p className="au-preview">
              {t('au.codeNow')} <code id="previewCode">{preview}</code>
            </p>
          ) : null}
          <p className="hint">{found.length === 1 ? t('au.foundHint') : t('au.foundMany', { n: found.length })}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setFound([])}>
              {t('au.back')}
            </button>
            <button type="button" className="btn btn-primary" id="addFound" onClick={() => void add()}>
              <Icon name="plus" />
              <span>{t('au.addThese', { n: found.length })}</span>
            </button>
          </div>
        </div>
      ) : scanning ? (
        <Camera
          canvas={canvas}
          onText={(text) => {
            setScanning(false);
            take(text);
          }}
          onCancel={() => setScanning(false)}
          onError={(m) => {
            setScanning(false);
            setError(m);
          }}
        />
      ) : (
        <>
          <div className="au-ways">
            <button type="button" className="way" id="scanBtn" onClick={() => setScanning(true)}>
              <Icon name="scan-qr-code" />
              <span>
                <b>{t('au.scan')}</b>
                <span className="muted small">{t('au.scanText')}</span>
              </span>
            </button>
            <label className="way" id="pictureBtn">
              <input
                type="file"
                accept="image/*"
                id="picture"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file || !canvas.current) return;
                  try {
                    take(await readQrFile(file, canvas.current));
                  } catch {
                    setError(t('au.noQr'));
                  }
                }}
              />
              <Icon name="image-up" />
              <span>
                <b>{t('au.picture')}</b>
                <span className="muted small">{t('au.pictureText')}</span>
              </span>
            </label>
          </div>
          <form className="form" id="manualForm" onSubmit={manual}>
            <label className="field">
              <span>{t('au.textLabel')}</span>
              <textarea name="text" rows={2} required spellCheck={false} autoCapitalize="none" placeholder="otpauth://totp/… · JBSW Y3DP EHPK 3PXP" />
            </label>
            <details className="au-more">
              <summary>{t('au.manualMore')}</summary>
              <label className="field">
                <span>{t('au.issuer')}</span>
                <input name="issuer" maxLength={80} />
              </label>
              <label className="field">
                <span>{t('au.account')}</span>
                <input name="account" maxLength={120} />
              </label>
              <div className="au-three">
                <label className="field">
                  <span>{t('au.algorithm')}</span>
                  <select name="algorithm" defaultValue="SHA1">
                    {ALGORITHMS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('au.digits')}</span>
                  <select name="digits" defaultValue="6">
                    {[6, 7, 8].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('au.period')}</span>
                  <select name="period" defaultValue="30">
                    {[30, 60].map((p) => (
                      <option key={p} value={p}>
                        {p} s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
            <div className="modal-actions">
              <button type="button" className="btn" data-close onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" id="readText">
                {t('au.continue')}
              </button>
            </div>
          </form>
        </>
      )}
      {error ? (
        <p className="form-error" role="alert" id="addError">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/** The camera, looking for a QR code a few times a second until it finds one; the stream stops when it closes. */
function Camera({
  canvas,
  onText,
  onCancel,
  onError,
}: {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  onText: (t: string) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the camera starts once per opening
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s;
        if (done || !video.current) {
          for (const tr of s.getTracks()) tr.stop();
          return;
        }
        video.current.srcObject = s;
        video.current.play().catch(() => {});
        timer = setInterval(async () => {
          if (done || !video.current || !canvas.current || video.current.readyState < 2) return;
          const text = await readQr(video.current, canvas.current).catch(() => null);
          if (text && !done) {
            done = true;
            onText(text);
          }
        }, 250);
      })
      .catch(() => onError(t('au.noCamera')));
    if (!navigator.mediaDevices) onError(t('au.noCamera'));
    return () => {
      done = true;
      if (timer) clearInterval(timer);
      for (const tr of stream?.getTracks() || []) tr.stop();
    };
  }, []);
  return (
    <div className="au-camera">
      <video ref={video} playsInline muted />
      <p className="hint">{t('au.cameraHint')}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
