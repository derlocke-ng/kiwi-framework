// The feed's own settings: who new entries are for, unless chosen otherwise
// when writing. Account, relays, media servers, friends and circles, blocks
// are the site's.
import { tErr } from '../../../shared/i18n.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useKiwi, useSpace, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { useAudienceChoices, useAudienceLabel, usePrefs } from '../state';
import { defaultAudience } from './Compose';

export function FeedSettings() {
  const t = useT();
  const kiwi = useKiwi();
  const mount = useMount();
  const prefs = usePrefs();
  const space = useSpace();
  const choices = useAudienceChoices(Boolean(space));
  const label = useAudienceLabel();
  const current = defaultAudience(prefs, choices);
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('fd.back')} how={['fd.how.1', ...HOW.feed]}>
      <div className="card">
        <h2>
          <Icon name="users" />
          {t('fd.settings.audience')}
        </h2>
        <p className="muted small">{t('fd.settings.audienceText')}</p>
        <label className="field">
          <span>{t('fd.audience')}</span>
          <select
            id="defaultAudience"
            value={current}
            onChange={(e) =>
              prefs
                .set({ audience: e.target.value })
                .then(() => toast(t('fd.settings.saved'), 'success'))
                .catch((err: unknown) => toast(tErr(err), 'error'))
            }
          >
            {choices.map((c) => (
              <option key={c} value={c}>
                {label(c, space?.name)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          <a href={`${kiwi.base}settings.html#circles`}>{t('fd.settings.circles')}</a>
        </p>
      </div>
    </AppSettings>
  );
}
