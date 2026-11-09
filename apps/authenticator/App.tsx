// The authenticator: two-factor codes (TOTP) for the person's accounts
// elsewhere. Since 0.27 the codes are entries of the vault the password
// manager opens too (shared/vault.js, ui/vault/): every device of the account
// has them, sealed with a key only the vault's own passphrase gives (the
// owner's choice: the account's password alone does not open them). A login
// of the password manager that carries a 2FA secret shows here as well. The
// vault is opened on the device with the passphrase and kept open in memory
// only; 0.26's codes move into it on the first unlock.
// Routes: #/ the codes, #/settings.
import { useEffect } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { VaultGate, VaultProvider } from '../../ui/vault/VaultProvider';
import { AuthSettings } from './pages/AuthSettings';
import { Codes } from './pages/Codes';

export function AuthenticatorApp() {
  const t = useT();
  const mount = useMount();
  const hash = useHash();
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);
  return (
    <AppShell footer={t('au.footer')} settings="#/settings">
      <VaultProvider>
        {hash.startsWith('#/settings') ? (
          <AuthSettings />
        ) : (
          <VaultGate>
            <Codes />
          </VaultGate>
        )}
      </VaultProvider>
    </AppShell>
  );
}
