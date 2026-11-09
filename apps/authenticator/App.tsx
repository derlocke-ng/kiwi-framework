// The authenticator: two-factor codes (TOTP) for the person's accounts
// elsewhere. The secrets are in a vault (shared/vault.js) in the account's
// settings, so every device of the account has them, sealed with a key only
// the vault's own passphrase gives (the owner's choice: the account's password
// alone does not open them). The vault is opened on the device with the
// passphrase and kept open in memory only, until the person locks it, the page
// has been away for a while, or the page goes; a change on another device is
// read with the same key while it is open.
// Routes: #/ the codes, #/settings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { cleanEntry } from '../../shared/totp.js';
import { isVault, readVault, sealVault } from '../../shared/vault.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT, useTick } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { toast } from '../../ui/toast';
import { AuthSettings } from './pages/AuthSettings';
import { Codes } from './pages/Codes';
import { Setup, Unlock } from './pages/Lock';
import { type Entry, lockAfter, VaultContext, type VaultState } from './state';

export const NAMESPACE = 'authenticator';

export function AuthenticatorApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const hash = useHash();
  const page = hash.startsWith('#/settings') ? 'settings' : 'codes';
  const [prefs, setPrefs] = useState<any>(null);
  // the open vault: its key and items, in memory only
  const [open, setOpen] = useState<{ key: CryptoKey; items: Entry[] } | null>(null);
  const [notice, setNotice] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const p = new AccountSettings(identity, kiwi.hubNet, NAMESPACE);
    let live = true;
    p.start()
      .then(() => live && setPrefs(p))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      p.stop();
      setPrefs(null);
      setOpen(null); // another person, another vault
    };
  }, [identity.pk, kiwi]);
  useTick(useCallback((fn: () => void) => (prefs ? prefs.onChange(fn) : () => {}), [prefs]));
  const record = prefs?.get('vault');

  // a change from another device while the vault is open: read with the same key; a new passphrase there locks it here
  const recordKey = record ? `${record.iv}|${record.data.length}` : '';
  const keyRef = useRef<CryptoKey | null>(null);
  keyRef.current = open?.key || null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey stands for the record
  useEffect(() => {
    const key = keyRef.current;
    if (!key) return;
    // removed on another device (its passphrase was lost there): nothing is open here any more
    if (!isVault(record)) return setOpen(null);
    readVault(record, key)
      .then((items: any[]) => setOpen((o) => (o && o.key === key ? { key, items: items.map(cleanEntry).filter(Boolean) as Entry[] } : o)))
      .catch(() => {
        setOpen(null);
        setNotice(t('au.lockedElsewhere'));
      });
  }, [recordKey]);

  // locked again after the page has been away for a while (the person's choice on this device), and on leaving it
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > lockAfter() * 60_000) setOpen(null);
    };
    // leaving the page locks too, also when the browser keeps it to come back to (back/forward cache)
    const onPageHide = () => setOpen(null);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);

  const state: VaultState | null = prefs
    ? {
        prefs,
        record: isVault(record) ? record : null,
        items: open?.items || [],
        open: Boolean(open),
        unlock: (key, items) => {
          setNotice('');
          setOpen({ key, items: items.map(cleanEntry).filter(Boolean) as Entry[] });
        },
        lock: () => setOpen(null),
        save: async (items) => {
          if (!open || !isVault(record)) return;
          const clean = items.map(cleanEntry).filter(Boolean) as Entry[];
          const next = await sealVault(record, open.key, clean);
          setOpen({ key: open.key, items: clean });
          await prefs.set({ vault: next });
        },
        replace: async (next, key, items) => {
          setOpen({ key, items: items.map(cleanEntry).filter(Boolean) as Entry[] });
          await prefs.set({ vault: next });
        },
      }
    : null;

  const body = !state ? (
    <p className="empty">{t('common.loading')}</p>
  ) : page === 'settings' ? (
    <AuthSettings />
  ) : !state.record ? (
    <Setup />
  ) : !state.open ? (
    <Unlock notice={notice} />
  ) : (
    <Codes />
  );
  return (
    <AppShell footer={t('au.footer')} settings="#/settings">
      {state ? <VaultContext.Provider value={state}>{body}</VaultContext.Provider> : body}
    </AppShell>
  );
}
