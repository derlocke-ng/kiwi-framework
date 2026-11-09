// The vault's doors: setting it up with a passphrase of its own (the first
// time, on any device of the account), and opening it with that passphrase.
// The passphrase cannot be recovered: without it the codes are gone, which the
// first screen says plainly, and the settings offer a backup.
import { type FormEvent, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { createVault, MIN_PASSPHRASE, openVault } from '../../../shared/vault.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, useT } from '../../../ui/hooks';
import { useVault } from '../state';

function Progress({ share }: { share: number | null }) {
  const t = useT();
  if (share === null) return null;
  return (
    <p className="muted small" id="deriving">
      {t('au.deriving', { p: Math.floor(share * 100) })}
    </p>
  );
}

export function Setup() {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const vault = useVault();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pass = String(f.get('pass') || '');
    if (pass !== String(f.get('pass2') || '')) return setError(t('au.mismatch'));
    setError('');
    setBusy(0);
    try {
      const { record, key } = await createVault(pass, [], setBusy);
      await vault.replace(record, key, []);
    } catch (err) {
      setError(tErr(err));
      setBusy(null);
    }
  };
  return (
    <section className="au-lock">
      <div className="card" id="setupCard">
        <h2>
          <Icon name="shield-check" />
          {t('au.setupTitle')}
        </h2>
        <p>{t('au.setupText')}</p>
        <form className="form" id="setupForm" onSubmit={submit}>
          <label className="field">
            <span>{t('au.passphrase')}</span>
            <input name="pass" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required data-autofocus />
          </label>
          <label className="field">
            <span>{t('au.passphraseAgain')}</span>
            <input name="pass2" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
          </label>
          <p className="hint">{t('au.setupHint', { n: MIN_PASSPHRASE })}</p>
          {error ? (
            <p className="form-error" role="alert" id="setupError">
              {error}
            </p>
          ) : null}
          <Progress share={busy} />
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" id="setupBtn" disabled={busy !== null}>
              <Icon name="lock" />
              <span>{t('au.setupBtn')}</span>
            </button>
          </div>
        </form>
      </div>
      <p className="muted small">
        {id.alias ? t('au.syncedAccount') : t('au.syncedKey')} <a href={`${kiwi.base}settings.html#account`}>{t('au.accountLink')}</a>
      </p>
    </section>
  );
}

export function Unlock({ notice }: { notice: string }) {
  const t = useT();
  const vault = useVault();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pass = String(new FormData(e.currentTarget).get('pass') || '');
    setError('');
    setBusy(0);
    try {
      const { items, key } = await openVault(vault.record, pass, setBusy);
      vault.unlock(key, items);
    } catch (err) {
      setError(tErr(err));
      setBusy(null);
    }
  };
  return (
    <section className="au-lock">
      <div className="card" id="unlockCard">
        <h2>
          <Icon name="lock" />
          {t('au.lockedTitle')}
        </h2>
        {notice ? <p className="hint">{notice}</p> : null}
        <form className="form" id="unlockForm" onSubmit={submit}>
          <label className="field">
            <span>{t('au.passphrase')}</span>
            <input name="pass" type="password" autoComplete="current-password" required data-autofocus />
          </label>
          {error ? (
            <p className="form-error" role="alert" id="unlockError">
              {error}
            </p>
          ) : null}
          <Progress share={busy} />
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" id="unlockBtn" disabled={busy !== null}>
              <Icon name="lock-open" />
              <span>{t('au.unlock')}</span>
            </button>
          </div>
        </form>
        <p className="muted small">
          {t('au.lockedText')} <a href="#/settings">{t('au.forgot')}</a>
        </p>
      </div>
    </section>
  );
}
