// The account card: who you are on this device, and the sign-in / create /
// import form. `full` adds the key export and leaves out the "open the app" button.
import { type FormEvent, useState } from 'react';
import { adoptIdentity, checkPassword, createAccount, exportEncrypted, forgetIdentity, importKey, login, npub, nsec, pubkeyOf } from '../../shared/account.js';
import { MOUNTS } from '../../shared/apps.js';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { fingerprint } from '../../shared/events.js';
import { has, tErr } from '../../shared/i18n.js';
import { Icon } from '../../ui/components';
import { useIdentity, useKiwi, useT } from '../../ui/hooks';
import { copyText, download, toast } from '../../ui/toast';

type Mode = 'signin' | 'create' | 'import';
const featured = () => MOUNTS.find((m) => m.featured) || MOUNTS[0] || null;

function ExportBox() {
  const t = useT();
  const id = useIdentity();
  const [reveal, setReveal] = useState(false);
  const [pass, setPass] = useState('');
  const secret = nsec(id.sk);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (pass.length < 10) return toast(t('account.export.min10'), 'error');
    download(`${DISTRIBUTION.id}-key-${id.alias || 'device'}.txt`, `${exportEncrypted(id.sk, pass)}\n`);
  };
  return (
    <div id="exportBox">
      <div className="export">
        <p className="small" dangerouslySetInnerHTML={{ __html: t('account.export.text') }} />
        <div className="copy-field">
          <input id="nsecOut" readOnly type={reveal ? 'text' : 'password'} value={secret} aria-label={t('account.export.secretKey')} />
          <button type="button" className="btn btn-sm" data-act="reveal" onClick={() => setReveal(!reveal)}>
            {reveal ? t('common.hide') : t('common.show')}
          </button>
          <button type="button" className="btn btn-sm btn-primary" data-act="copy-nsec" onClick={() => copyText(secret, t('account.export.secretKey'))}>
            {t('common.copy')}
          </button>
        </div>
        <form className="form" id="ncryptForm" onSubmit={save}>
          <label className="field">
            {t('account.export.downloadLabel')}
            <input
              name="pass"
              type="password"
              autoComplete="new-password"
              minLength={10}
              placeholder={t('account.export.placeholder')}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-sm">
              {t('account.export.download')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Account({ full = false }: { full?: boolean }) {
  const kiwi = useKiwi();
  const t = useT();
  const id = useIdentity();
  const [mode, setMode] = useState<Mode>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const signOut = async () => {
    if (!confirm(t('account.signOutDialog.text'))) return;
    forgetIdentity();
    await kiwi.restart();
    toast(t('hub.signedOut'));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    const onProgress = (msg: string, params?: Record<string, unknown>) => setProgress(has(msg) ? t(msg, params) : msg);
    setError('');
    setBusy(true);
    try {
      const current = kiwi.identity();
      let next: Record<string, unknown>;
      if (mode === 'create') {
        checkPassword(pass);
        if (pass !== String(f.get('pass2') || '')) throw new Error(t('account.passwordsMismatch'));
        setProgress(t('account.progress.create'));
        const { event, alias } = await createAccount(kiwi.net, String(f.get('alias') || ''), pass, current.sk, onProgress);
        next = { ...current, alias, accountPk: event.pubkey };
      } else if (mode === 'signin') {
        setProgress(t('account.progress.signIn'));
        const { sk, pk, alias, event } = await login(kiwi.net.pool, String(f.get('alias') || ''), pass, onProgress);
        await kiwi.net.db.put(event);
        next = { sk, pk, alias, accountPk: event.pubkey, created: Date.now() };
      } else {
        const sk = importKey(String(f.get('key') || ''), pass);
        next = { sk, pk: pubkeyOf(sk), alias: null, accountPk: null, created: Date.now() };
      }
      adoptIdentity(next);
      await kiwi.restart();
      setBusy(false);
      setProgress('');
      if (next.alias) toast(t('hub.welcome', { alias: String(next.alias) }), 'success');
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
      setProgress('');
    }
  };

  if (id.alias) {
    const app = featured();
    return (
      <>
        <p dangerouslySetInnerHTML={{ __html: t('account.signedIn', { alias: id.alias.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) }) }} />
        <p className="muted small">
          {t('hub.accountSigned')} · {t('account.publicKey')} <code>{fingerprint(id.pk)}</code>
        </p>
        <div className="form-actions">
          {!full && app ? (
            <a className="btn btn-primary" href={`${app.id}/`}>
              <Icon name={app.icon} />
              <span>{t('hub.openApp', { name: app.name })}</span>
            </a>
          ) : null}
          {full ? (
            <>
              <button type="button" className="btn" data-act="copy-pub" onClick={() => copyText(npub(id.pk), t('account.publicKey'))}>
                <Icon name="copy" />
                <span>{t('account.copyNpub')}</span>
              </button>
              <button type="button" className="btn" data-act="export-key" onClick={() => setExportOpen(!exportOpen)}>
                <Icon name="key-round" />
                <span>{t('account.exportKey')}</span>
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-ghost" data-act="signout" onClick={signOut}>
            <Icon name="log-out" />
            <span>{t('account.signOut')}</span>
          </button>
        </div>
        {exportOpen ? <ExportBox /> : <div id="exportBox" hidden />}
      </>
    );
  }

  const labels: Record<Mode, string> = { signin: t('account.tab.signIn'), create: t('account.tab.create'), import: t('account.button.import') };
  const hints: Record<Mode, string> = { signin: t('account.hint.signIn'), create: t('account.hint.create'), import: t('account.hint.import') };
  return (
    <>
      <p>{t('hub.accountText')}</p>
      <div className="seg" role="tablist">
        {(['signin', 'create', 'import'] as Mode[]).map((m) => (
          <label key={m}>
            <input type="radio" name="authTab" value={m} checked={mode === m} onChange={() => setMode(m)} />
            <span>{m === 'signin' ? t('account.tab.signIn') : m === 'create' ? t('account.tab.create') : t('account.tab.import')}</span>
          </label>
        ))}
      </div>
      <form className="form" id="authForm" autoComplete="on" onSubmit={submit}>
        <label className="field" id="aliasField" hidden={mode === 'import'}>
          {t('account.username')}
          <input name="alias" autoComplete="username" required={mode !== 'import'} minLength={3} maxLength={40} spellCheck={false} autoCapitalize="off" />
        </label>
        <label className="field" id="keyField" hidden={mode !== 'import'}>
          {t('account.secretKey')} <small>{t('account.secretKeyHint')}</small>
          <textarea name="key" rows={2} spellCheck={false} autoCapitalize="off" placeholder="nsec1…" required={mode === 'import'} />
        </label>
        <label className="field" id="passField">
          <span id="passLabel">{mode === 'import' ? t('account.passwordForKey') : t('account.password')}</span>
          <input name="pass" type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required={mode !== 'import'} />
        </label>
        <label className="field" id="confirmField" hidden={mode !== 'create'}>
          {t('account.repeatPassword')}
          <input name="pass2" type="password" autoComplete="new-password" required={mode === 'create'} />
        </label>
        <p className="hint" id="authHint">
          {hints[mode]}
        </p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" id="authBtn" disabled={busy}>
            {labels[mode]}
          </button>
          <span className="progress-text" id="authProgress">
            {progress}
          </span>
        </div>
        <p className="form-error" id="authError" role="alert" hidden={!error}>
          {error}
        </p>
      </form>
      <p className="muted small">
        <span dangerouslySetInnerHTML={{ __html: t('account.deviceKey') }} />{' '}
        {full ? (
          <>
            {t('account.publicKey')} <code>{fingerprint(id.pk)}</code>{' '}
            <button type="button" className="link-btn" data-act="export-key" onClick={() => setExportOpen(!exportOpen)}>
              {t('account.exportKey')}
            </button>
          </>
        ) : null}
      </p>
      {exportOpen ? <ExportBox /> : <div id="exportBox" hidden />}
    </>
  );
}
