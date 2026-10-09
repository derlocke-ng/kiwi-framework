// Choose a photo: it is scaled down, stripped of what cameras put in it
// (location, device), encrypted unless the app says it is public, and
// uploaded to the person's media servers, first choice first. When none of
// them takes encrypted files, the person is asked before it goes up
// unencrypted: never silently.
//
//   <ImageUpload onUpload={(media) => save({ ...item, photo: media })} />
import { useRef, useState } from 'react';
import { uploadMedia } from '../../shared/blossom.js';
import { tErr } from '../../shared/i18n.js';
import { Icon } from '../components';
import { useKiwi, useT } from '../hooks';
import type { Media } from './MediaImage';

export interface ImageUploadProps {
  onUpload: (media: Media) => unknown;
  /** Encrypt before uploading (the default). false: the photo is public anyway, like a market listing. */
  encrypt?: boolean;
  /** May the person upload unencrypted when no server takes encrypted files? (default true) */
  allowPlain?: boolean;
  /** Long side in pixels after scaling (2048), and the thumbnail's (480; 0 for none). */
  max?: number;
  thumb?: number;
  /** The button's text; "Add a photo" by default. */
  label?: string;
  disabled?: boolean;
}

type State = { phase: 'idle' } | { phase: 'working'; progress: number } | { phase: 'failed'; message: string; reasons: string[]; retryPlain: File | null };

const host = (server: string) => server.replace(/^https?:\/\//, '');

export function ImageUpload({ onUpload, encrypt = true, allowPlain = true, max = 2048, thumb = 480, label, disabled = false }: ImageUploadProps) {
  const kiwi = useKiwi();
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const servers = kiwi.mediaServers();

  const send = async (file: File, encrypted: boolean) => {
    setState({ phase: 'working', progress: 0 });
    try {
      const media = await uploadMedia(file, {
        servers,
        sk: kiwi.identity().sk,
        encrypt: encrypted,
        max,
        thumb,
        onProgress: (progress: number) => setState({ phase: 'working', progress }),
      });
      setState({ phase: 'idle' });
      await onUpload(media as Media);
    } catch (err) {
      const e = err as { code?: string; errors?: { server: string; reason: string }[] };
      const refused = e?.code === 'media.error.noServer';
      setState({
        phase: 'failed',
        message: tErr(err),
        reasons: (e?.errors || []).map((x) => `${host(x.server)}: ${x.reason}`),
        retryPlain: refused && encrypted && allowPlain && servers.length > 0 ? file : null,
      });
    }
  };

  if (!servers.length) {
    return (
      <p className="wjs-upload none muted small">
        {t('media.none')} <a href={`${kiwi.base}settings.html#media`}>{t('media.chooseServers')}</a>
      </p>
    );
  }
  const working = state.phase === 'working';
  return (
    <div className="wjs-upload" data-state={state.phase}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) send(file, encrypt);
        }}
      />
      <div className="wjs-upload-row">
        <button type="button" className="btn btn-sm" data-act="upload" disabled={disabled || working} onClick={() => input.current?.click()}>
          <Icon name="image-plus" />
          <span>{working ? t('upload.uploading') : label || t('upload.choose')}</span>
        </button>
        <span className="wjs-upload-note muted small">
          <Icon name={encrypt ? 'lock' : 'globe'} />
          <span>{t(encrypt ? 'upload.encrypted' : 'upload.public')}</span>
        </span>
      </div>
      {working && <progress max={1} value={state.progress} aria-label={t('upload.uploading')} />}
      {state.phase === 'failed' && (
        <div className="wjs-upload-error" role="alert">
          <p>{state.message}</p>
          {state.reasons.length > 0 && (
            <ul className="small muted">
              {state.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {state.retryPlain && <p>{t('upload.plainOffer')}</p>}
          <div className="form-actions">
            {state.retryPlain && (
              <button type="button" className="btn btn-sm" data-act="upload-plain" onClick={() => state.retryPlain && send(state.retryPlain, false)}>
                <Icon name="globe" />
                <span>{t('upload.plain')}</span>
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" data-act="upload-dismiss" onClick={() => setState({ phase: 'idle' })}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
