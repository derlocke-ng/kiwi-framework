// The password manager's settings: the vault's own cards (when it locks again
// on this device, its passphrase, backups, removing it; ui/vault/VaultSettings),
// the breach check (off unless the person turns it on: an outside service), and
// what is the password manager's: imports from other managers and plain
// exports for them. Account, relays and the rest are the site's.
import { useState } from 'react';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { useVault } from '../../../ui/vault/VaultProvider';
import { BackupCard, LockCard, PassphraseCard, PlainExport, RemoveCard } from '../../../ui/vault/VaultSettings';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { toCsv, toJson } from '../data/export.js';
import { importFile } from '../data/import.js';

function BreachCard() {
  const t = useT();
  const vault = useVault();
  const [on, setOn] = useState(Boolean(vault.prefs.get('breachCheck', false)));
  return (
    <div className="card" id="breachCard">
      <h2>
        <Icon name="shield-alert" />
        {t('pw.settings.breach')}
      </h2>
      <label className="check-row">
        <input
          type="checkbox"
          id="breachCheck"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void vault.prefs.set({ breachCheck: e.target.checked });
          }}
        />
        <span>
          {t('pw.settings.breachOn')}
          <br />
          <span className="muted small">{t('pw.settings.breachText')}</span>
        </span>
      </label>
    </div>
  );
}

export function VaultAppSettings() {
  const t = useT();
  const mount = useMount();
  const vault = useVault();
  const day = new Date().toISOString().slice(0, 10);
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('pw.back')} how={['pw.how.1', ...HOW.passwords, 'pw.how.keys', 'pw.how.2']}>
      <LockCard />
      <PassphraseCard />
      <BreachCard />
      <BackupCard
        importText={t('pw.settings.importText')}
        parse={(text, name) => importFile(text, name)}
        exports={
          <>
            <PlainExport
              id="exportJson"
              label={t('pw.settings.exportJson')}
              file={`vault-${day}.json`}
              type="application/json"
              make={() => toJson(vault.items)}
            />
            <PlainExport id="exportCsv" label={t('pw.settings.exportCsv')} file={`vault-${day}.csv`} type="text/csv" make={() => toCsv(vault.items)} />
          </>
        }
      />
      <RemoveCard />
    </AppSettings>
  );
}
