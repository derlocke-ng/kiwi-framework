// The app's own settings: defaults for new notes, and collapsed notes shown
// opened. Account, relays, language, backup and blocks are the site's.
import { tErr } from '../../../shared/i18n.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { DURATIONS, LIMITS } from '../data/notices.js';
import { defaults, usePrefs } from '../state';

/** "How it works": the app's own parts and the framework's topics (shared/how.js). */
export const HOW_NOTICES = ['db.how.1', 'pow', 'db.how.3', 'db.how.4', 'blocks'];

export function NoticesSettings() {
  const t = useT();
  const mount = useMount();
  const prefs = usePrefs();
  const d = defaults(prefs);
  const fail = (err: unknown) => toast(tErr(err), 'error');
  const save = (patch: Record<string, unknown>) =>
    prefs
      .set(patch)
      .then(() => toast(t('db.settings.saved'), 'success'))
      .catch(fail);
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('db.settings.back')} how={HOW_NOTICES}>
      <div className="card">
        <h2>
          <Icon name="pencil" />
          {t('db.settings.defaults')}
        </h2>
        <p className="muted small">{t('db.settings.defaultsText')}</p>
        <form className="form" id="defaultsForm" onSubmit={(e) => e.preventDefault()}>
          <div className="seg" role="radiogroup" aria-label={t('db.compose.iam')}>
            {(['hiring', 'available'] as const).map((type) => (
              <label key={type}>
                <input type="radio" name="type" value={type} checked={d.type === type} onChange={() => save({ type })} />
                <span>{t(`db.compose.${type}`)}</span>
              </label>
            ))}
          </div>
          <label className="field">
            {t('db.compose.contact')}
            <input
              name="contact"
              maxLength={LIMITS.contact}
              defaultValue={d.contact}
              placeholder={t('db.compose.contactPlaceholder')}
              onBlur={(e) => {
                const contact = e.currentTarget.value.trim().slice(0, LIMITS.contact);
                if (contact !== d.contact) save({ contact });
              }}
            />
          </label>
          <label className="field">
            {t('db.compose.duration')}
            <select name="days" value={String(d.days)} onChange={(e) => save({ days: Number(e.target.value) })}>
              {DURATIONS.map((n) => (
                <option key={n} value={n}>
                  {t(`db.duration.${n}`)}
                </option>
              ))}
            </select>
          </label>
        </form>
      </div>
      <div className="card">
        <h2>
          <Icon name="eye" />
          {t('db.settings.board')}
        </h2>
        <label className="check-row">
          <input type="checkbox" id="showCollapsed" checked={d.showCollapsed} onChange={(e) => prefs.set({ showCollapsed: e.target.checked }).catch(fail)} />
          <span>{t('db.settings.showCollapsed')}</span>
        </label>
      </div>
    </AppSettings>
  );
}
