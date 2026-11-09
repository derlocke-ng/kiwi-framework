// The account card: who you are on this device, and the sign-in / create /
// import form. `full` adds the key export and leaves out the "open the app" button.
import { type FormEvent, useState } from 'react';
import {
  adoptIdentity,
  checkPassword,
  createAccount,
  exportEncrypted,
  forgetIdentity,
  importKey,
  login,
  npub,
  nsec,
  pubkeyOf,
  upgradeAccount,
} from '../../shared/account.js';
import { MOUNTS } from '../../shared/apps.js';
import { deviceId } from '../../shared/device.js';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { fingerprint } from '../../shared/events.js';
import { has, relTime, tErr } from '../../shared/i18n.js';
import { pendingReturn, takeReturn } from '../../ui/AccountGate';
import { Icon } from '../../ui/components';
import { useIdentity, useKiwi, useKiwiTick, useT } from '../../ui/hooks';
import { copyText, download, toast, toastError } from '../../ui/toast';

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

/** A new password for the account: the old one stops opening it everywhere the change reaches. */
function PasswordBox() {
  const kiwi = useKiwi();
  const t = useT();
  const id = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const needsOld = (id.accountVersion || 1) !== 2; // the first form: only its password can retire it
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = String(f.get('newPass') || '');
    setError('');
    if (next !== String(f.get('newPass2') || '')) return setError(t('account.passwordsMismatch'));
    setBusy(true);
    try {
      await kiwi.changePassword(next, String(f.get('oldPass') || '') || null, (msg, params) => setProgress(has(msg) ? t(msg, params) : msg));
      form.reset();
      toast(t('account.passwordChanged'), 'success');
    } catch (err) {
      setError(tErr(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  return (
    <form className="form password-form" id="passwordForm" autoComplete="on" onSubmit={submit}>
      <h3>{t('account.changePassword')}</h3>
      <p className="muted small">{t('account.changePasswordText')}</p>
      <input name="username" autoComplete="username" value={id.alias || ''} readOnly hidden />
      {needsOld ? (
        <label className="field">
          {t('account.currentPassword')}
          <input name="oldPass" type="password" autoComplete="current-password" required />
        </label>
      ) : null}
      <label className="field">
        {t('account.newPassword')}
        <input name="newPass" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <label className="field">
        {t('account.repeatPassword')}
        <input name="newPass2" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-sm" id="passwordBtn" disabled={busy}>
          {t('account.changePassword')}
        </button>
        <span className="progress-text">{progress}</span>
      </div>
      <p className="form-error" id="passwordError" role="alert" hidden={!error}>
        {error}
      </p>
    </form>
  );
}

/** The devices this key is signed in on, and the way to sign the others out. */
function DevicesBox() {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const devices = kiwi.devices();
  const [busy, setBusy] = useState(false);
  const others = devices.filter((d) => !d.me);
  const signOutOthers = async () => {
    if (!confirm(t('account.signOutOthersConfirm'))) return;
    setBusy(true);
    try {
      await kiwi.signOutOtherDevices();
      toast(t('account.signOutOthersDone'), 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="devices" id="devices">
      <h3>{t('account.devices')}</h3>
      <p className="muted small">{t('account.devicesText')}</p>
      <ul className="device-list">
        {devices.map((d) => (
          <li key={d.id} data-device={d.id} data-me={d.me ? '1' : undefined}>
            <span className="device-name">
              {d.name || t('account.aDevice')}
              {d.me ? <small className="muted"> · {t('account.thisDevice')}</small> : null}
            </span>
            <span className="muted small">{d.seen ? t('account.seen', { when: relTime(d.seen) }) : ''}</span>
            {d.me ? null : (
              <button type="button" className="btn btn-sm btn-ghost" data-revoke={d.id} onClick={() => kiwi.revokeDevice(d.id).catch(toastError)}>
                {t('account.signOutDevice')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" id="signOutOthers" disabled={busy || !others.length} onClick={signOutOthers}>
        <Icon name="log-out" />
        <span>{t('account.signOutOthers')}</span>
      </button>
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
      const since = Date.now(); // this device takes the key now: a sign-out of other devices asked before leaves it be
      deviceId({ fresh: true }); // and is a new device, not one that was signed out
      let next: Record<string, unknown>;
      if (mode === 'create') {
        checkPassword(pass);
        if (pass !== String(f.get('pass2') || '')) throw new Error(t('account.passwordsMismatch'));
        setProgress(t('account.progress.create'));
        const pow = DISTRIBUTION.policy?.registerPow || 0; // the proof of work the hub's relay asks of a sign-up
        const { alias, lookupPk } = await createAccount(kiwi.net, String(f.get('alias') || ''), pass, current.sk, onProgress, { pow });
        next = { ...current, alias, accountPk: lookupPk, accountVersion: 2, since };
      } else if (mode === 'signin') {
        setProgress(t('account.progress.signIn'));
        const { sk, pk, alias, event, version, lookup } = await login(kiwi.net.pool, String(f.get('alias') || ''), pass, onProgress);
        await kiwi.net.db.put(event);
        let accountVersion = version;
        if (version === 1) {
          // the first form, which only its password can retire: now, while we hold it, the entry moves to today's form
          try {
            await upgradeAccount(kiwi.net, lookup, sk);
            accountVersion = 2;
          } catch {
            /* the relays did not take it: the first form stays, and a password change asks for the current one */
          }
        }
        next = { sk, pk, alias, accountPk: lookup.lookupPk, accountVersion, created: Date.now(), since };
      } else {
        const sk = importKey(String(f.get('key') || ''), pass);
        next = { sk, pk: pubkeyOf(sk), alias: null, accountPk: null, imported: true, created: Date.now(), since };
      }
      adoptIdentity(next);
      await kiwi.restart();
      if (next.alias) await kiwi.rememberAccount({ alias: String(next.alias), accountPk: (next.accountPk as string | null) || null }); // the key's own settings carry them to every device
      setBusy(false);
      setProgress('');
      form.reset();
      if (next.alias) toast(t('hub.welcome', { alias: String(next.alias) }), 'success');
      else toast(t('hub.keyInUse', { fp: fingerprint(String(next.pk)) }), 'success');
      // a mount that asks for an account sent the person here: with one now, they go back
      const back = next.accountPk ? takeReturn() : null;
      if (back) location.href = back.url;
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
      setProgress('');
    }
  };

  const labels: Record<Mode, string> = { signin: t('account.tab.signIn'), create: t('account.tab.create'), import: t('account.button.import') };
  const hints: Record<Mode, string> = { signin: t('account.hint.signIn'), create: t('account.hint.create'), import: t('account.hint.import') };
  const named = Boolean(id.alias && !id.accountPk); // a key with a name, not an account
  const saveName = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') || '')
      .trim()
      .slice(0, 40);
    if (!name) return;
    try {
      await kiwi.rememberAccount({ alias: name });
      toast(t('account.nameSaved'), 'success');
    } catch (err) {
      toastError(err);
    }
  };
  const back = id.accountPk ? null : pendingReturn(); // a mount that asks for an account sent the person here
  const authForm = (
    <>
      {back ? (
        <p className="banner return-note" id="returnNote">
          <Icon name="key-round" />
          <span>{t('account.returnNote', { app: back.name })}</span>
        </p>
      ) : null}
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
    </>
  );
  if (id.alias) {
    const app = featured();
    const alias = id.alias.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    return (
      <>
        <p dangerouslySetInnerHTML={{ __html: named ? t('account.namedKey', { alias }) : t('account.signedIn', { alias }) }} />
        <p className="muted small">
          {named ? null : <>{t('hub.accountSigned')} · </>}
          {t('account.publicKey')} <code>{fingerprint(id.pk)}</code>
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
        {named && full ? (
          <div className="key-account" id="keyAccount">
            <h3>{t('account.createForKey')}</h3>
            {authForm}
          </div>
        ) : null}
        {full && id.accountPk ? <PasswordBox /> : null}
        {full ? <DevicesBox /> : null}
      </>
    );
  }
  return (
    <>
      <p>{t('hub.accountText')}</p>
      {authForm}
      {full ? (
        <form className="name-form" id="nameForm" onSubmit={saveName}>
          <label className="field">
            {t('account.yourName')}
            <input name="name" maxLength={40} required autoComplete="nickname" />
          </label>
          <button type="submit" className="btn btn-sm">
            {t('account.saveName')}
          </button>
          <p className="muted small">{t('account.yourNameHint')}</p>
        </form>
      ) : null}
      <p className="muted small" id="keyNote" data-key={id.imported ? 'imported' : 'device'}>
        <span dangerouslySetInnerHTML={{ __html: id.imported ? t('account.importedKey', { fp: fingerprint(id.pk) }) : t('account.deviceKey') }} />{' '}
        {full ? (
          <>
            {id.imported ? null : (
              <>
                {t('account.publicKey')} <code>{fingerprint(id.pk)}</code>{' '}
              </>
            )}
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
