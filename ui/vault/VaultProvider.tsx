// The open vault for an app's page (the password manager, the authenticator):
// the keys record in the account's settings (namespace `vault`), the entries
// (shared/vaultstore.js), and the screens that stand before them: setting up a
// passphrase the first time, opening the vault with it, and removing it when it
// is lost. 0.26's authenticator kept its codes in a vault of its own; the first
// unlock with its passphrase moves them into this one.
//
// The vault key lives in this page's memory only: the lock button, the page
// being away for longer than this device's choice, and leaving the page lock
// it again.
//
//   <VaultProvider>
//     <VaultGate><Codes /></VaultGate>       // the gate shows setup or unlock until the vault is open
//   </VaultProvider>
import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { changePassphrase, createKeys, isKeys, isVault, MIN_PASSPHRASE, openKeys, openVault } from '../../shared/vault.js';
import { fromAuthenticator, VaultStore } from '../../shared/vaultstore.js';
import { Icon } from '../components';
import { confirmDialog } from '../dialogs';
import { useIdentity, useKiwi, useT, useTick } from '../hooks';
import { toast } from '../toast';

export interface VaultItem {
  id: string;
  type: string;
  name: string;
  username: string;
  password: string;
  urls: string[];
  notes: string;
  totp: { secret: string; algorithm: string; digits: number; period: number } | null;
  card: { holder: string; number: string; exp: string; code: string; brand: string } | null;
  ssh: {
    keyType: string;
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    comment: string;
    ca: boolean;
    issued: { serial: number; type: 'user' | 'host'; keyId: string; principals: string[]; validBefore: number | null; at: number; fingerprint: string }[];
  } | null;
  pki: {
    kind: 'root' | 'intermediate' | 'server' | 'client' | 'both';
    origin: 'ca' | 'self' | 'external';
    keyType: string;
    certPem: string;
    keyPem: string;
    chainPem: string;
    csrPem: string;
    subject: { cn: string; o: string; ou: string; c: string; st: string; l: string };
    permitted: { dns: string[]; ips: string[] };
    days: number;
    previous: { serial: string; notAfter: number; at: number }[];
    sans: { dns: string[]; ips: string[]; emails: string[] };
    serial: string;
    notAfter: number;
    caId: string;
    issued: { serial: string; cn: string; kind: string; notAfter: number; at: number; entryId: string }[];
  } | null;
  fields: { name: string; value: string; hidden: boolean }[];
  tags: string[];
  fav: boolean;
  history: { password: string; at: number }[];
  created: number;
  updated: number;
  changed: number;
  [extra: string]: any;
}

export interface Vault {
  /** the account's settings for the vault (namespace `vault`): `keys`, `breachCheck` */
  prefs: any;
  store: VaultStore;
  record: any | null;
  /** 0.26's authenticator vault, while its codes have not moved */
  legacy: any | null;
  open: boolean;
  items: VaultItem[];
  create: (passphrase: string, onProgress: (share: number) => void) => Promise<void>;
  unlock: (passphrase: string, onProgress: (share: number) => void) => Promise<void>;
  lock: () => void;
  changePassphrase: (current: string, next: string, onProgress: (share: number) => void) => Promise<void>;
  /** the vault and every entry in it removed (its passphrase lost) */
  removeVault: () => Promise<void>;
}

const VaultContext = createContext<Vault | null>(null);

export function useVault(): Vault {
  const v = useContext(VaultContext);
  if (!v) throw new Error('useVault() outside a <VaultProvider>');
  return v;
}

const LOCK_KEY = 'vault.lockAfter';
export const LOCK_CHOICES = [1, 5, 15, 60];

/** Minutes away after which the vault locks again on this device (5 unless the person chose otherwise). */
export function lockAfter(): number {
  try {
    const raw = localStorage.getItem(LOCK_KEY) ?? localStorage.getItem('authenticator.lockAfter') ?? '5';
    const v = Number(JSON.parse(raw));
    return LOCK_CHOICES.includes(v) ? v : 5;
  } catch {
    return 5;
  }
}

export function setLockAfter(minutes: number) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(minutes));
  } catch {
    /* storage blocked: the default holds */
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const [parts, setParts] = useState<{ prefs: any; legacyPrefs: any; store: VaultStore } | null>(null);
  const [notice, setNotice] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const prefs = new AccountSettings(identity, kiwi.hubNet, 'vault');
    const legacyPrefs = new AccountSettings(identity, kiwi.hubNet, 'authenticator');
    const store = new VaultStore(identity, kiwi.hubNet);
    let live = true;
    Promise.all([prefs.start(), legacyPrefs.start(), store.start()])
      .then(() => live && setParts({ prefs, legacyPrefs, store }))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      prefs.stop();
      legacyPrefs.stop();
      store.stop();
      setParts(null);
    };
  }, [identity.pk, kiwi]);
  useTick(useCallback((fn: () => void) => (parts ? parts.prefs.onChange(fn) : () => {}), [parts]));
  useTick(useCallback((fn: () => void) => (parts ? parts.legacyPrefs.onChange(fn) : () => {}), [parts]));
  useTick(useCallback((fn: () => void) => (parts ? parts.store.onChange(fn) : () => {}), [parts]));

  const raw = parts?.prefs.get('keys');
  const record = isKeys(raw) ? raw : null;
  const legacyRaw = parts?.legacyPrefs.get('vault');
  const legacy = !record && isVault(legacyRaw) ? legacyRaw : null;

  // the vault this page opened: removed elsewhere, or made anew there, it closes here (a new passphrase keeps it open)
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    if (!parts?.store.open) return;
    if (!record || record.id !== openedId.current) {
      parts.store.lock();
      openedId.current = null;
      setNotice(record ? t('vault.madeAnew') : '');
    }
  }, [parts, record, t]);

  // locked again after the page has been away for a while (the person's choice on this device), and on leaving it
  useEffect(() => {
    if (!parts) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > lockAfter() * 60_000) parts.store.lock();
    };
    const onPageHide = () => parts.store.lock();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [parts]);

  // the list is made again only when the store changed: screens compare it to know when to recompute
  const version = parts?.store.version ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version stands for the store's contents
  const items = useMemo(() => (parts ? (parts.store.list() as VaultItem[]) : []), [parts, version]);
  // made again on every render: the store's tick re-renders, and its state is read live
  const { prefs, legacyPrefs, store } = parts || ({} as { prefs: any; legacyPrefs: any; store: VaultStore });
  const vault: Vault | null = parts
    ? {
        prefs,
        store,
        record,
        legacy,
        open: store.open,
        items,
        create: async (passphrase, onProgress) => {
          const made = await createKeys(passphrase, onProgress);
          openedId.current = made.record.id;
          await store.unlock(made.key);
          await prefs.set({ keys: made.record });
          setNotice('');
        },
        unlock: async (passphrase, onProgress) => {
          if (record) {
            const key = await openKeys(record, passphrase, onProgress);
            openedId.current = record.id;
            await store.unlock(key);
            setNotice('');
            return;
          }
          if (!legacy) throw new Error('No vault');
          // 0.26's codes: opened with their passphrase, moved into a vault under the same passphrase (no second key derivation)
          const old = await openVault(legacy, passphrase, onProgress);
          const made = await createKeys(passphrase, null, { kdf: legacy.kdf, passKey: old.key });
          openedId.current = made.record.id;
          await store.unlock(made.key);
          await prefs.set({ keys: made.record });
          await store.putAll(old.items.map(fromAuthenticator));
          await legacyPrefs.set({ vault: null, moved: true });
          toast(t('vault.moved', { n: old.items.length }), 'success');
        },
        lock: () => store.lock(),
        changePassphrase: async (current, next, onProgress) => {
          if (!record) return;
          await prefs.set({ keys: await changePassphrase(record, current, next, onProgress) });
        },
        removeVault: async () => {
          store.lock();
          openedId.current = null;
          await store.clear();
          await prefs.set({ keys: null });
          if (legacyRaw) await legacyPrefs.set({ vault: null });
        },
      }
    : null;

  return (
    <VaultContext.Provider value={vault}>
      <NoticeContext.Provider value={notice}>{vault ? children : <p className="empty">{t('common.loading')}</p>}</NoticeContext.Provider>
    </VaultContext.Provider>
  );
}

const NoticeContext = createContext('');

/** What needs the open vault: setup or unlock until it is. */
export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault();
  const notice = useContext(NoticeContext);
  if (vault.open) return <>{children}</>;
  if (!vault.record && !vault.legacy) return <Setup />;
  return <Unlock notice={notice} />;
}

function Progress({ share }: { share: number | null }) {
  const t = useT();
  if (share === null) return null;
  return (
    <p className="muted small" id="deriving">
      {t('vault.deriving', { p: Math.floor(share * 100) })}
    </p>
  );
}

function Setup() {
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
    if (pass !== String(f.get('pass2') || '')) return setError(t('vault.mismatch'));
    setError('');
    setBusy(0);
    try {
      await vault.create(pass, setBusy);
    } catch (err) {
      setError(tErr(err));
      setBusy(null);
    }
  };
  return (
    <section className="vault-lock">
      <div className="card" id="setupCard">
        <h2>
          <Icon name="shield-check" />
          {t('vault.setupTitle')}
        </h2>
        <p>{t('vault.setupText')}</p>
        <form className="form" id="setupForm" onSubmit={submit}>
          <label className="field">
            <span>{t('vault.passphrase')}</span>
            <input name="pass" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required data-autofocus />
          </label>
          <label className="field">
            <span>{t('vault.passphraseAgain')}</span>
            <input name="pass2" type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} required />
          </label>
          <p className="hint">{t('vault.setupHint', { n: MIN_PASSPHRASE })}</p>
          {error ? (
            <p className="form-error" role="alert" id="setupError">
              {error}
            </p>
          ) : null}
          <Progress share={busy} />
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" id="setupBtn" disabled={busy !== null}>
              <Icon name="lock" />
              <span>{t('vault.setupBtn')}</span>
            </button>
          </div>
        </form>
      </div>
      <p className="muted small">
        {id.alias ? t('vault.syncedAccount') : t('vault.syncedKey')} <a href={`${kiwi.base}settings.html#account`}>{t('vault.accountLink')}</a>
      </p>
    </section>
  );
}

function Unlock({ notice }: { notice: string }) {
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
      await vault.unlock(pass, setBusy);
    } catch (err) {
      setError(tErr(err));
      setBusy(null);
    }
  };
  const forgot = async () => {
    if (!(await confirmDialog({ title: t('vault.removeTitle'), message: t('vault.removeText'), confirm: t('vault.removeConfirm'), danger: true }))) return;
    await vault.removeVault();
    toast(t('vault.removed'), 'success');
  };
  return (
    <section className="vault-lock">
      <div className="card" id="unlockCard">
        <h2>
          <Icon name="lock" />
          {t('vault.lockedTitle')}
        </h2>
        {notice ? <p className="hint">{notice}</p> : null}
        {vault.legacy ? <p className="hint">{t('vault.moveText')}</p> : null}
        <form className="form" id="unlockForm" onSubmit={submit}>
          <label className="field">
            <span>{t('vault.passphrase')}</span>
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
              <span>{t('vault.unlock')}</span>
            </button>
          </div>
        </form>
        <p className="muted small">
          {t('vault.lockedText')}{' '}
          <button type="button" className="link-btn" id="forgotBtn" onClick={() => void forgot()}>
            {t('vault.forgot')}
          </button>
        </p>
      </div>
    </section>
  );
}
