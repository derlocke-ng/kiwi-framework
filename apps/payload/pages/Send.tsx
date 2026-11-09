// Sending: drop or choose files, then one of three ways. A link: the files go
// encrypted to the person's media servers and wait there for whoever has the
// link. To people: the same upload, then a sealed file message to each friend
// and group chosen, which shows up in their Uplink. Directly: the files go
// from this open page to the other open page, nothing stored anywhere, any
// size.
import { useEffect, useRef, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { qrSvg } from '../../../shared/qr.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { sendAsMessage } from '../../../ui/share';
import { copyText, toast } from '../../../ui/toast';
import { Tabs } from '../App';
import { createShare, keptShare, MAX_FILE, MAX_FILES, shareFragment } from '../data/shares.js';
import { size, usePrefs } from '../state';
import { Bar, DirectSend } from './Direct';
import { SendTo } from './SendTo';

type Way = 'link' | 'people' | 'direct';

/** The page's address without its fragment: where a link opens. */
const page = () => location.href.split('#')[0];

export function Send() {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [way, setWay] = useState<Way | null>(null);
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((cur) => [...cur, ...[...list]].slice(0, 200));
    setWay(null);
  };
  const reset = () => {
    setFiles([]);
    setWay(null);
  };
  const total = files.reduce((s, f) => s + f.size, 0);
  const tooBig = files.some((f) => f.size > MAX_FILE);
  const tooMany = files.length > MAX_FILES;
  const stored = !tooBig && !tooMany; // a link or to people: the files go to media servers, which take so much

  if (way === 'direct') return <DirectSend files={files} onStop={reset} />;
  return (
    <div className="pl-page">
      <div className="app-bar">
        <Tabs page="send" />
      </div>
      {way === 'link' ? <LinkShare files={files} onDone={reset} /> : null}
      {way === 'people' ? <SendTo files={files} onDone={reset} onCancel={() => setWay(null)} /> : null}
      {!way || way === 'people' ? (
        files.length ? (
          <section className="card" id="chosen">
            <h2>
              <Icon name="file" />
              {t('pl.chosen', { n: files.length, size: size(total) })}
            </h2>
            <ul className="files pl-chosen">
              {files.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows and shrinks by its own buttons
                <li key={i}>
                  <span className="file-name">{f.name}</span>
                  <span className="file-size">{size(f.size)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('pl.removeFile', { name: f.name })}
                    onClick={() => setFiles(files.filter((_, k) => k !== i))}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
            <label className="link-btn pl-more">
              <input type="file" multiple hidden onChange={(e) => add(e.target.files)} />
              <Icon name="plus" /> {t('pl.addMore')}
            </label>
            <h3 className="pl-how">{t('pl.howSend')}</h3>
            <div className="ways" id="ways">
              <button type="button" className="way" data-way="link" disabled={!stored} onClick={() => setWay('link')}>
                <Icon name="link" />
                <span>
                  <b>{t('pl.way.link')}</b>
                  <span className="muted small">{t('pl.way.linkText')}</span>
                </span>
              </button>
              <button type="button" className="way" data-way="people" disabled={!stored} onClick={() => setWay('people')}>
                <Icon name="users" />
                <span>
                  <b>{t('pl.way.people', { app: chatMount()?.name || 'Uplink' })}</b>
                  <span className="muted small">{t('pl.way.peopleText', { app: chatMount()?.name || 'Uplink' })}</span>
                </span>
              </button>
              <button type="button" className="way" data-way="direct" onClick={() => setWay('direct')}>
                <Icon name="radio-tower" />
                <span>
                  <b>{t('pl.way.direct')}</b>
                  <span className="muted small">{t('pl.way.directText')}</span>
                </span>
              </button>
            </div>
            {tooBig ? <p className="hint">{t('pl.tooBig', { max: size(MAX_FILE) })}</p> : null}
            {tooMany ? <p className="hint">{t('pl.tooMany', { n: MAX_FILES })}</p> : null}
            <button type="button" className="btn" data-act="clear" onClick={reset}>
              {t('common.cancel')}
            </button>
          </section>
        ) : (
          <>
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
                add(e.dataTransfer.files);
              }}
            >
              <input type="file" id="files" multiple hidden onChange={(e) => add(e.target.files)} />
              <Icon name="upload" className="drop-icon" />
              <strong>{t('pl.drop')}</strong>
              <span>{t('pl.dropText')}</span>
            </label>
            <OpenForm />
          </>
        )
      ) : null}
    </div>
  );
}

/** A link someone sent: pasted here, opened here. */
function OpenForm() {
  const t = useT();
  return (
    <form
      className="open-link"
      id="openLink"
      onSubmit={(e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get('link') || '').trim();
        const frag = v.includes('#') ? v.slice(v.indexOf('#')) : `#${v}`;
        if (/^#[\w-]{22}$/.test(frag) || /^#\/l\//.test(frag)) location.hash = frag;
        else toast(t('pl.error.badLink'), 'error');
      }}
    >
      <input name="link" placeholder={t('pl.pastePlaceholder')} autoComplete="off" spellCheck={false} aria-label={t('pl.linkLabel')} />
      <button type="submit" className="btn">
        {t('pl.receive')}
      </button>
    </form>
  );
}

/** A link: upload, then the link with its ways to pass it on; kept under Links. */
function LinkShare({ files, onDone }: { files: File[]; onDone: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const people = usePeople();
  const id = useIdentity();
  const prefs = usePrefs();
  const [progress, setProgress] = useState(0);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [qr, setQr] = useState(false);
  // one upload for these files (the ref outlives React's second mount in development)
  const startedFor = useRef<File[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the files are the key; the rest is read when it starts
  useEffect(() => {
    if (startedFor.current === files) return;
    startedFor.current = files;
    createShare(files, { servers: kiwi.mediaServers(), sk: id.sk, from: id.alias || '', onProgress: setProgress })
      .then(async (share) => {
        const url = `${page()}#/${shareFragment(share)}`;
        setLink(url);
        const kept = prefs.get('shares') || [];
        await prefs.set({ shares: [{ ...keptShare(share), link: url }, ...kept].slice(0, 500) });
      })
      .catch((err: unknown) => setError(tErr(err)));
  }, [files]);
  const chat = chatMount();
  if (error)
    return (
      <section className="card" id="linkCard">
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="button" className="btn" onClick={onDone}>
          {t('pl.back')}
        </button>
      </section>
    );
  if (!link)
    return (
      <section className="card" id="linkCard">
        <h2>{t('pl.uploading')}</h2>
        <p className="muted">{t('pl.uploadingText', { n: files.length, size: size(files.reduce((s, f) => s + f.size, 0)) })}</p>
        <Bar value={Math.round(progress * 100)} id="upBar" />
      </section>
    );
  return (
    <section className="card" id="linkCard">
      <h2>
        <Icon name="link" />
        {t('pl.linkReady')}
      </h2>
      <div className="copy-field">
        <input id="shareLink" readOnly value={link} aria-label={t('pl.linkLabel')} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-primary" id="copyShare" onClick={() => void copyText(link, t('pl.theLink'))}>
          <Icon name="copy" />
          <span>{t('pl.copy')}</span>
        </button>
      </div>
      <div className="pl-actions">
        {'share' in navigator ? (
          <button type="button" className="btn" onClick={() => navigator.share({ title: 'Payload', url: link }).catch(() => {})}>
            <Icon name="share-2" />
            <span>{t('pl.shareSheet')}</span>
          </button>
        ) : null}
        {people && chat ? (
          <button type="button" className="btn" onClick={() => void sendAsMessage(kiwi, people, t('pl.linkMessage', { link })).catch(() => {})}>
            <Icon name="message-circle" />
            <span>{t('pl.sendIn', { app: chat.name })}</span>
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => setQr((q) => !q)}>
          <Icon name="qr-code" />
          <span>{t('pl.qr')}</span>
        </button>
      </div>
      <div className="qr-box" hidden={!qr} dangerouslySetInnerHTML={{ __html: qr ? qrSvg(link) : '' }} />
      <p className="note">{t('pl.linkNote')}</p>
      <div className="pl-actions">
        <button type="button" className="btn" data-act="another" onClick={onDone}>
          {t('pl.sendMore')}
        </button>
        <a className="btn" href="#/links">
          {t('pl.toLinks')}
        </a>
      </div>
    </section>
  );
}
