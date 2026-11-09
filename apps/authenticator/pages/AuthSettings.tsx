// The authenticator's settings: the vault's own cards (when it locks again on
// this device, its passphrase, backups, removing it; ui/vault/VaultSettings),
// plus what is the authenticator's: bringing in a list of otpauth:// links or a
// Google Authenticator export from a file, and sending its codes out as a list
// of links for another authenticator. Account, relays and the rest are the site's.
import { otpauthOf } from '../../../shared/totp.js';
import { fromAuthenticator } from '../../../shared/vaultstore.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { useT } from '../../../ui/hooks';
import { BackupCard, LockCard, PassphraseCard, PlainExport, RemoveCard } from '../../../ui/vault/VaultSettings';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { entriesFrom } from '../data/scan.js';
import { useEntries } from '../state';

export function AuthSettings() {
  const t = useT();
  const mount = useMount();
  const entries = useEntries();
  const day = new Date().toISOString().slice(0, 10);
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('au.back')} how={['au.how.1', ...HOW.authenticator, 'au.how.2']}>
      <LockCard />
      <PassphraseCard />
      <BackupCard
        importText={t('au.settings.importText')}
        parse={(text) => entriesFrom(text).map(fromAuthenticator)}
        exports={
          <PlainExport
            id="plainExport"
            label={t('au.settings.plain')}
            file={`authenticator-${day}.txt`}
            make={() => `${entries.map(otpauthOf).join('\n')}\n`}
            empty={!entries.length}
          />
        }
      />
      <RemoveCard />
    </AppSettings>
  );
}
