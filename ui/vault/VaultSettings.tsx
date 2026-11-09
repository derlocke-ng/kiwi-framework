// The vault's part of an app's settings page, the same in every app that opens
// the vault: when it locks again on this device, a new passphrase (the
// current one asked first, as the key in memory cannot be taken out again), a
// backup file (the vault as the relays hold it, still sealed) and bringing one
// back, and removing the vault. An app adds its own ways in and out (the
// password manager's imports and exports, the authenticator's lists of links).
import { type FormEvent, type ReactNode, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { backupOf, MIN_PASSPHRASE, readBackup } from '../../shared/vault.js';
import { fromAuthenticator, sameItem } from '../../shared/vaultstore.js';
import { Icon } from '../components';
import { confirmDialog } from '../dialogs';
import { useT } from '../hooks';
import { download, toast } from '../toast';
import { LOCK_CHOICES, lockAfter, setLockAfter, useVault } from './VaultProvider';

/** Entries added to the vault, those already in it left out; says how many came in. */
export function useAddItems() {
  const t = useT();
  const vault = useVault();
  return async (incoming: any[]) => {
    const fresh: any[] = [];
    for (const item of incoming) if (!vault.items.some((e) => sameItem(e, item)) && !fresh.some((e) => sameItem(e, item))) fresh.push(item);
    await vault.store.putAll(fresh);
    toast(fresh.length ? t('vault.added', { n: fresh.length }) : t('vault.alreadyThere'), fresh.length ? 'success' : 'info');
    return fresh.length;
  };
}

function LockedHint() {
  const t = useT();
  return (
    <p className="hint">
      {t('vault.settings.unlockFirst')} <a href="#/">{t('vault.settings.toUnlock')}</a>
    </p>
  );
}

export function LockCard() {
  const t = useT();
  const vault = useVault();
  const [minutes, setMinutes] = useState(lockAfter());
  return (
    <div className="card" id="lockCard">
      <h2>
        <Icon name="timer" />
        {t('vault.settings.lock')}
      </h2>
      <label className="field">
        <span>{t('vault.settings.lockAfter')}</span>
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
              {t('vault.settings.minutes', { n: m })}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{t('vault.settings.lockText')}</p>
      {vault.open ? (
        <button type="button" className="btn" id="lockNow" onClick={() => vault.lock()}>
          <Icon name="lock" />
          <span>{t('vault.lock')}</span>
        </button>
      ) : null}
    </div>
  );
}

export function PassphraseCard() {
  const t = useT();
  const vault = useVault();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  if (!vault.record) return null;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = String(f.get('pass') || '');
    if (next !== String(f.get('pass2') || '')) return setError(t('vault.mismatch'));
    setError('');
    setBusy(0);
    try {
      await vault.changePassphrase(String(f.get('current') || ''), next, setBusy);
      form.reset();
      toast(t('vault.settings.passChanged'), 'success');
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(null);
  };
  return (
    <div className="card" id="passCard">
      <h2>
        <Icon name="key-round" />
        {t('vault.settings.passphrase')}
      </h2>
      <p className="muted small">{t('vault.settings.passText')}</p>
      <form className="form" id="passForm" onSubmit={submit}>
        <label className="field">
          <span>{t('vault.settings.currentPass')}</span>
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>{t('vault.settings.newPass')}</span>
          <input name="pass" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
        </label>
        <label className="field">
          <span>{t('vault.passphraseAgain')}</span>
          <input name="pass2" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
        </label>
        {error ? (
          <p className="form-error" role="alert" id="passError">
            {error}
          </p>
        ) : null}
        {busy !== null ? <p className="muted small">{t('vault.deriving', { p: Math.floor(busy * 100) })}</p> : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" id="passBtn" disabled={busy !== null}>
            {t('vault.settings.changePass')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Backups out and in. `parse` turns any other file an app takes (a list of links, another manager's
 * export) into entries, or null when it does not know it; `exports` are the app's plain exports.
 */
export function BackupCard({
  parse,
  exports = null,
  importText,
}: {
  parse?: (text: string, name: string) => any[] | null;
  exports?: ReactNode;
  importText: string;
}) {
  const t = useT();
  const vault = useVault();
  const add = useAddItems();
  const [pending, setPending] = useState<any>(null); // a backup file waiting for its passphrase
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  if (!vault.record && !vault.legacy) return null;
  const day = new Date().toISOString().slice(0, 10);

  const pick = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    const text = await file.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON: an app's own format, perhaps */
    }
    if (json?.type === 'kiwi-vault-backup' || json?.type === 'kiwi-authenticator-backup') return setPending(json);
    let items: any[] | null = null;
    try {
      items = parse ? parse(text, file.name) : null;
    } catch (err) {
      return setError(tErr(err));
    }
    if (!items?.length) return setError(t('vault.settings.nothingFound'));
    await add(items);
  };
  const openBackup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pass = String(new FormData(e.currentTarget).get('pass') || '');
    setError('');
    setBusy(0);
    try {
      const { kind, items } = await readBackup(pending, pass, setBusy);
      setPending(null);
      await add(kind === 'authenticator' ? items.map(fromAuthenticator) : items);
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(null);
  };

  return (
    <div className="card" id="backupCard">
      <h2>
        <Icon name="download" />
        {t('vault.settings.backup')}
      </h2>
      <p className="muted small">{t('vault.settings.backupText')}</p>
      <div className="vault-buttons">
        {vault.record ? (
          <button
            type="button"
            className="btn"
            id="saveBackup"
            onClick={() => download(`vault-backup-${day}.json`, JSON.stringify(backupOf(vault.record, vault.store.sealed()), null, 1), 'application/json')}
          >
            <Icon name="download" />
            <span>{t('vault.settings.saveBackup')}</span>
          </button>
        ) : null}
        {vault.open ? (
          <>
            <label className="btn" id="importBtn">
              <input
                type="file"
                id="importFile"
                hidden
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Icon name="upload" />
              <span>{t('vault.settings.import')}</span>
            </label>
            {exports}
          </>
        ) : null}
      </div>
      {vault.open ? <p className="muted small">{importText}</p> : <LockedHint />}
      {pending ? (
        <form className="form" id="backupPassForm" onSubmit={openBackup}>
          <label className="field">
            <span>{t('vault.settings.backupPass')}</span>
            <input name="pass" type="password" autoComplete="off" required data-autofocus />
          </label>
          {busy !== null ? <p className="muted small">{t('vault.deriving', { p: Math.floor(busy * 100) })}</p> : null}
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
              {t('vault.settings.import')}
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

/** A plain export behind a warning: every secret readable by whoever has the file. */
export function PlainExport({
  id,
  label,
  file,
  make,
  type = 'text/plain',
  empty = false,
}: {
  id: string;
  label: string;
  file: string;
  make: () => string;
  type?: string;
  empty?: boolean;
}) {
  const t = useT();
  const vault = useVault();
  const run = async () => {
    if (
      !(await confirmDialog({
        title: t('vault.settings.plainTitle'),
        message: t('vault.settings.plainText'),
        confirm: t('vault.settings.plainConfirm'),
        danger: true,
      }))
    )
      return;
    download(file, make(), type);
  };
  return (
    <button type="button" className="btn" id={id} onClick={() => void run()} disabled={empty || !vault.items.length}>
      <Icon name="file-text" />
      <span>{label}</span>
    </button>
  );
}

export function RemoveCard() {
  const t = useT();
  const vault = useVault();
  if (!vault.record && !vault.legacy) return null;
  const remove = async () => {
    if (!(await confirmDialog({ title: t('vault.removeTitle'), message: t('vault.removeText'), confirm: t('vault.removeConfirm'), danger: true }))) return;
    await vault.removeVault();
    toast(t('vault.removed'), 'success');
    location.hash = '#/';
  };
  return (
    <div className="card" id="removeCard">
      <h2>
        <Icon name="trash-2" />
        {t('vault.settings.remove')}
      </h2>
      <p className="muted small">{t('vault.settings.removeHint')}</p>
      <button type="button" className="btn btn-danger" id="removeVault" onClick={() => void remove()}>
        <Icon name="trash-2" />
        <span>{t('vault.settings.remove')}</span>
      </button>
    </div>
  );
}
