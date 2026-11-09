// The authenticator's own settings: when the vault locks again on this
// device, a new passphrase, backups (the vault as it is, still sealed with its
// passphrase; or its accounts as plain otpauth:// links for another app, with
// a warning), bringing accounts in from such a file, and removing the vault
// when its passphrase is lost. Account, relays and the rest are the site's.
import { type FormEvent, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { cleanEntry, otpauthOf } from '../../../shared/totp.js';
import { isVault, MIN_PASSPHRASE, openVault, rekeyVault } from '../../../shared/vault.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { download, toast } from '../../../ui/toast';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { entriesFrom } from '../data/scan.js';
import { type Entry, LOCK_CHOICES, lockAfter, setLockAfter, useVault } from '../state';

/** What a backup file says it is, so an import knows it from a list of links. */
const BACKUP_TYPE = 'kiwi-authenticator-backup';

export function AuthSettings() {
  const t = useT();
  const mount = useMount();
  const vault = useVault();
  const [minutes, setMinutes] = useState(lockAfter());
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('au.back')} how={['au.how.1', ...HOW.authenticator, 'au.how.2']}>
      <div className="card" id="lockCard">
        <h2>
          <Icon name="timer" />
          {t('au.settings.lock')}
        </h2>
        <label className="field">
          <span>{t('au.settings.lockAfter')}</span>
          <select
            id="lockAfter"
            value={minutes}
            onChange={(e) => {
              const m = Number(e.target.value);
              setMinutes(m);
              setLockAfter(m);
            }}
          >
            {LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {t('au.settings.minutes', { n: m })}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{t('au.settings.lockText')}</p>
        {vault.open ? (
          <button type="button" className="btn" id="lockNow" onClick={() => vault.lock()}>
            <Icon name="lock" />
            <span>{t('au.lock')}</span>
          </button>
        ) : null}
      </div>
      {vault.record ? (
        <>
          <Passphrase />
          <Backup />
          <Remove />
        </>
      ) : null}
    </AppSettings>
  );
}

function LockedHint() {
  const t = useT();
  return (
    <p className="hint">
      {t('au.settings.unlockFirst')} <a href="#/">{t('au.settings.toUnlock')}</a>
    </p>
  );
}

/** A new passphrase: the open vault sealed anew under it (a new salt, a new key); other devices then ask for it. */
function Passphrase() {
  const t = useT();
  const vault = useVault();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    if (pass !== String(f.get('pass2') || '')) return setError(t('au.mismatch'));
    setError('');
    setBusy(0);
    try {
      const { record, key } = await rekeyVault(vault.items, pass, setBusy);
      await vault.replace(record, key, vault.items);
      form.reset();
      toast(t('au.settings.passChanged'), 'success');
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(null);
  };
  return (
    <div className="card" id="passCard">
      <h2>
        <Icon name="key-round" />
        {t('au.settings.passphrase')}
      </h2>
      <p className="muted small">{t('au.settings.passText')}</p>
      {vault.open ? (
        <form className="form" id="passForm" onSubmit={submit}>
          <label className="field">
            <span>{t('au.settings.newPass')}</span>
            <input name="pass" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
          </label>
          <label className="field">
            <span>{t('au.passphraseAgain')}</span>
            <input name="pass2" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
          </label>
          {error ? (
            <p className="form-error" role="alert" id="passError">
              {error}
            </p>
          ) : null}
          {busy !== null ? <p className="muted small">{t('au.deriving', { p: Math.floor(busy * 100) })}</p> : null}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" id="passBtn" disabled={busy !== null}>
              {t('au.settings.changePass')}
            </button>
          </div>
        </form>
      ) : (
        <LockedHint />
      )}
    </div>
  );
}

/** Backups out, accounts in. */
function Backup() {
  const t = useT();
  const vault = useVault();
  // a backup file chosen for import, waiting for its passphrase
  const [pending, setPending] = useState<any>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const day = new Date().toISOString().slice(0, 10);

  const merge = async (items: any[]) => {
    const known = new Set(vault.items.map((e) => e.secret));
    const fresh = (items as Entry[]).filter((e) => e && !known.has(e.secret));
    if (fresh.length) await vault.save([...vault.items, ...fresh]);
    toast(fresh.length ? t('au.added', { n: fresh.length }) : t('au.alreadyThere'), fresh.length ? 'success' : 'info');
  };
  const pick = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    const text = await file.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON: a list of links */
    }
    if (parsed?.type === BACKUP_TYPE && isVault(parsed.vault)) return setPending(parsed.vault);
    const entries = entriesFrom(text);
    if (!entries.length) return setError(t('au.settings.nothingFound'));
    await merge(entries);
  };
  const openBackup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pass = String(new FormData(e.currentTarget).get('pass') || '');
    setError('');
    setBusy(0);
    try {
      const { items } = await openVault(pending, pass, setBusy);
      setPending(null);
      await merge(items.map(cleanEntry).filter(Boolean));
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(null);
  };
  const plain = async () => {
    if (
      !(await confirmDialog({ title: t('au.settings.plainTitle'), message: t('au.settings.plainText'), confirm: t('au.settings.plainConfirm'), danger: true }))
    )
      return;
    download(`authenticator-${day}.txt`, `${vault.items.map(otpauthOf).join('\n')}\n`);
  };

  return (
    <div className="card" id="backupCard">
      <h2>
        <Icon name="download" />
        {t('au.settings.backup')}
      </h2>
      <p className="muted small">{t('au.settings.backupText')}</p>
      <div className="au-buttons">
        <button
          type="button"
          className="btn"
          id="saveBackup"
          onClick={() =>
            download(`authenticator-backup-${day}.json`, JSON.stringify({ type: BACKUP_TYPE, v: 1, vault: vault.record }, null, 1), 'application/json')
          }
        >
          <Icon name="download" />
          <span>{t('au.settings.saveBackup')}</span>
        </button>
        {vault.open ? (
          <>
            <label className="btn" id="importBtn">
              <input
                type="file"
                id="importFile"
                accept=".json,.txt,application/json,text/plain"
                hidden
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Icon name="upload" />
              <span>{t('au.settings.import')}</span>
            </label>
            <button type="button" className="btn" id="plainExport" onClick={() => void plain()} disabled={!vault.items.length}>
              <Icon name="file-text" />
              <span>{t('au.settings.plain')}</span>
            </button>
          </>
        ) : null}
      </div>
      {vault.open ? <p className="muted small">{t('au.settings.importText')}</p> : <LockedHint />}
      {pending ? (
        <form className="form" id="backupPassForm" onSubmit={openBackup}>
          <label className="field">
            <span>{t('au.settings.backupPass')}</span>
            <input name="pass" type="password" autoComplete="off" required data-autofocus />
          </label>
          {busy !== null ? <p className="muted small">{t('au.deriving', { p: Math.floor(busy * 100) })}</p> : null}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPending(null);
                setError('');
              }}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" id="backupPassBtn" disabled={busy !== null}>
              {t('au.settings.importThese')}
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="form-error" role="alert" id="importError">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The vault removed from the account: the way out when its passphrase is lost (the accounts in it are lost with it). */
function Remove() {
  const t = useT();
  const vault = useVault();
  const remove = async () => {
    if (
      !(await confirmDialog({
        title: t('au.settings.removeTitle'),
        message: t('au.settings.removeText'),
        confirm: t('au.settings.removeConfirm'),
        danger: true,
      }))
    )
      return;
    vault.lock();
    await vault.prefs.set({ vault: null });
    toast(t('au.settings.removed'), 'success');
    location.hash = '#/';
  };
  return (
    <div className="card" id="removeCard">
      <h2>
        <Icon name="trash-2" />
        {t('au.settings.remove')}
      </h2>
      <p className="muted small">{t('au.settings.removeHint')}</p>
      <button type="button" className="btn btn-danger" id="removeVault" onClick={() => void remove()}>
        <Icon name="trash-2" />
        <span>{t('au.settings.removeBtn')}</span>
      </button>
    </div>
  );
}
