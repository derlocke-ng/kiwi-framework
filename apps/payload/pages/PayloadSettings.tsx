// Payload's own settings: where links and files go (the media servers, set in
// the site's settings), and whether direct transfers always go through the
// relays on this device. Account, relays and the rest are the site's.
import { useState } from 'react';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useKiwi, useT } from '../../../ui/hooks';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { forceRelay } from '../state';

export function PayloadSettings() {
  const t = useT();
  const kiwi = useKiwi();
  const mount = useMount();
  const servers = kiwi.mediaServers();
  const [relayOnly, setRelayOnly] = useState(forceRelay());
  const setRelay = (on: boolean) => {
    setRelayOnly(on);
    try {
      localStorage.setItem('payload.forceRelay', JSON.stringify(on));
    } catch {
      /* storage blocked: the choice holds for this page */
    }
  };
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('pl.back')} how={['pl.how.1', ...HOW.files]}>
      <div className="card" id="serversCard">
        <h2>
          <Icon name="server" />
          {t('pl.settings.servers')}
        </h2>
        <p className="muted small">{t('pl.settings.serversText')}</p>
        {servers.length ? (
          <ul className="pl-servers">
            {servers.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p id="noServers">{t('pl.settings.noServers')}</p>
        )}
        <a className="btn" href={`${kiwi.base}settings.html#media`}>
          <Icon name="settings" />
          <span>{t('pl.settings.chooseServers')}</span>
        </a>
      </div>
      <div className="card" id="directCardSettings">
        <h2>
          <Icon name="radio-tower" />
          {t('pl.settings.direct')}
        </h2>
        <label className="check-row">
          <input type="checkbox" id="relayOnly" checked={relayOnly} onChange={(e) => setRelay(e.target.checked)} />
          <span>
            {t('pl.settings.relayOnly')}
            <br />
            <span className="muted small">{t('pl.settings.relayOnlyText')}</span>
          </span>
        </label>
      </div>
    </AppSettings>
  );
}
