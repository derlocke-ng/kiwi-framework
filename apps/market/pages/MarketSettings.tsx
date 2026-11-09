// The market's own settings, in the account: the country I am in (what the
// listings are filtered by and where new listings start), the contact new
// listings carry, how long they stay up. Account, relays, media servers,
// friends and blocks are the site's.
import { countriesByName } from '../../../shared/countries.js';
import { currentLanguage, tErr } from '../../../shared/i18n.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { DURATIONS, LIMITS } from '../data/market.js';
import { usePrefs } from '../state';

export function MarketSettings() {
  const t = useT();
  const mount = useMount();
  const prefs = usePrefs();
  const save = (patch: Record<string, unknown>) =>
    prefs
      .set(patch)
      .then(() => toast(t('mk.settings.saved'), 'success'))
      .catch((err: unknown) => toast(tErr(err), 'error'));
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('mk.back')} how={['mk.how.1', 'mk.how.2', ...HOW.market]}>
      <div className="card">
        <h2>
          <Icon name="globe" />
          {t('mk.settings.where')}
        </h2>
        <p className="muted small">{t('mk.settings.whereText')}</p>
        <form className="form" id="marketPrefs" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span>{t('mk.settings.country')}</span>
            <select name="country" value={String(prefs.get('country') || '')} onChange={(e) => save({ country: e.target.value || undefined })}>
              <option value="">{t('mk.chooseCountry')}</option>
              {countriesByName(currentLanguage()).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('mk.contact')}</span>
            <input
              name="contact"
              maxLength={LIMITS.contact}
              defaultValue={String(prefs.get('contact') || '')}
              placeholder={t('mk.contactPlaceholder')}
              onBlur={(e) => {
                const contact = e.currentTarget.value.trim();
                if (contact !== String(prefs.get('contact') || '')) save({ contact });
              }}
            />
          </label>
          <label className="field">
            <span>{t('mk.duration')}</span>
            <select name="days" value={String(prefs.get('days') || 30)} onChange={(e) => save({ days: Number(e.target.value) })}>
              {DURATIONS.map((n) => (
                <option key={n} value={n}>
                  {t('mk.days', { n })}
                </option>
              ))}
            </select>
          </label>
        </form>
      </div>
    </AppSettings>
  );
}
