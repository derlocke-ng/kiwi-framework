// A link someone sent: its manifest fetched and opened with the key the link
// carries, then each file downloaded from the media server, checked against its
// hash, decrypted here and saved. The sender need not be online.
import { useEffect, useState } from 'react';
import { openFile } from '../../../shared/files.js';
import { fmtDateTime, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useKiwi, useT } from '../../../ui/hooks';
import { openShare, type parseShare } from '../data/shares.js';
import { saveBytes, size } from '../state';

export function OpenLink({ shareRef }: { shareRef: ReturnType<typeof parseShare> }) {
  const t = useT();
  const kiwi = useKiwi();
  const [manifest, setManifest] = useState<{ from: string; at: number; files: any[] } | null>(null);
  const [error, setError] = useState(shareRef ? '' : t('pl.error.badLink'));
  const [state, setState] = useState<Record<number, 'busy' | 'done' | 'failed'>>({});
  useEffect(() => {
    if (!shareRef) return;
    let live = true;
    openShare(shareRef)
      .then((m) => live && setManifest(m))
      .catch((err: unknown) => live && setError(tErr(err)));
    return () => {
      live = false;
    };
  }, [shareRef?.x, shareRef]);
  const one = async (i: number) => {
    const f = manifest?.files[i];
    if (!f) return;
    setState((s) => ({ ...s, [i]: 'busy' }));
    try {
      saveBytes(await openFile(f, { servers: kiwi.mediaServers() }), f.name, f.type);
      setState((s) => ({ ...s, [i]: 'done' }));
    } catch (err) {
      setState((s) => ({ ...s, [i]: 'failed' }));
      setError(tErr(err));
    }
  };
  const all = async () => {
    for (let i = 0; i < (manifest?.files.length || 0); i++) if (state[i] !== 'done') await one(i);
  };
  if (error && !manifest)
    return (
      <section className="card" id="openCard">
        <h2>
          <Icon name="link" />
          {t('pl.openTitle')}
        </h2>
        <p className="form-error" id="openError" role="alert">
          {error}
        </p>
        <a className="btn" href="#/">
          {t('pl.toSend')}
        </a>
      </section>
    );
  if (!manifest)
    return (
      <section className="card" id="openCard">
        <div className="state">
          <span className="spinner" />
          <p>{t('pl.opening')}</p>
        </div>
      </section>
    );
  const total = manifest.files.reduce((n, f) => n + (f.size || 0), 0);
  return (
    <section className="card" id="openCard">
      <h2>
        <Icon name="download" />
        {t('pl.openReady', { n: manifest.files.length, size: size(total) })}
      </h2>
      <p className="from muted">
        {manifest.from ? t('pl.sharedBy', { name: manifest.from }) : t('pl.sharedAnon')}
        {manifest.at ? ` · ${fmtDateTime(manifest.at)}` : ''}
      </p>
      <ul className="pl-list" id="openFiles">
        {manifest.files.map((f, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a manifest's files never change order, and two may share a name
          <li key={i} className="pl-item" data-file={f.name}>
            <Icon name={/^image\//.test(f.type) ? 'image' : 'file'} />
            <span className="pl-what">
              <b>{f.name}</b>
              <span className="muted small">
                {f.size != null ? size(f.size) : ''}
                {state[i] === 'done' ? ` · ${t('pl.verified')}` : state[i] === 'failed' ? ` · ${t('pl.failed')}` : ''}
              </span>
            </span>
            <span className="pl-buttons">
              <button
                type="button"
                className="btn"
                data-act="download"
                disabled={state[i] === 'busy'}
                onClick={() => void one(i)}
                aria-label={t('pl.downloadName', { name: f.name })}
              >
                <Icon name={state[i] === 'done' ? 'check' : 'download'} />
                <span className="phone-hide">{t('pl.download')}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {manifest.files.length > 1 ? (
        <button type="button" className="btn btn-primary" id="downloadAll" onClick={() => void all()}>
          <Icon name="download" />
          <span>{t('pl.downloadAll', { n: manifest.files.length })}</span>
        </button>
      ) : null}
      <p className="note">{t('pl.openNote')}</p>
    </section>
  );
}
