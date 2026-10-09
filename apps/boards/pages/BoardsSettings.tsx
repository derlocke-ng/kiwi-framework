// The app's own settings: the starters on the start page and their
// templates. Account, relays, backup, language and appearance are the site's.
import { type FormEvent, useRef } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { STARTER_KEYS, starters } from '../data/starters.js';
import { useBoardsSettings } from '../state';

/** "How it works": the app's own parts, then the framework's topics it is built from (shared/how.js). */
export const HOW_BOARDS = ['loadout.how.boards', 'loadout.how.links', 'linkKeys', 'loadout.how.wallet', 'offline', 'relays', 'backup'];

export function BoardsSettings() {
  const t = useT();
  const mount = useMount();
  const settings = useBoardsSettings();
  const form = useRef<HTMLFormElement | null>(null);
  const fail = (err: unknown) => toast(tErr(err), 'error');
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const custom: Record<string, { title?: string; text?: string }> = {};
    for (const { key } of STARTER_KEYS) {
      const title = String(data.get(`title-${key}`) || '').trim();
      const text = String(data.get(`text-${key}`) ?? '');
      const o: { title?: string; text?: string } = {};
      if (title && title !== t(`home.starter.${key}`)) o.title = title.slice(0, 120);
      if (text !== t(`home.template.${key}`)) o.text = text.slice(0, 20_000);
      if (Object.keys(o).length) custom[key] = o;
    }
    try {
      await settings.set({ starters: custom });
      toast(t('settings.saved'), 'success');
    } catch (err) {
      fail(err);
    }
  };
  const reset = (key: string) => {
    const f = form.current;
    if (!f) return;
    (f.elements.namedItem(`title-${key}`) as HTMLInputElement).value = t(`home.starter.${key}`);
    (f.elements.namedItem(`text-${key}`) as HTMLTextAreaElement).value = t(`home.template.${key}`);
  };
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('app.backToBoards')} how={HOW_BOARDS}>
      <div className="card">
        <h2>
          <Icon name="list-checks" />
          {t('settings.home')}
        </h2>
        <label className="check-row">
          <input
            type="checkbox"
            id="showStarters"
            checked={settings.get('showStarters', true) ?? true}
            onChange={(e) => settings.set({ showStarters: e.target.checked }).catch(fail)}
          />
          <span>{t('settings.showStarters')}</span>
        </label>
        <details className="templates">
          <summary>{t('settings.starters')}</summary>
          <p className="muted small">{t('settings.startersText')}</p>
          <form className="form" id="startersForm" ref={form} onSubmit={save}>
            {starters(settings, t).map((st) => (
              <fieldset key={st.key} className="starter-edit" data-key={st.key}>
                <legend>
                  {t(`home.starter.${st.key}`)} · {t(`type.${st.kind}`)}
                </legend>
                <label className="field">
                  {t('settings.starterTitle')}
                  <input name={`title-${st.key}`} maxLength={120} defaultValue={st.title} />
                </label>
                <label className="field">
                  {t('settings.starterText')}
                  <textarea name={`text-${st.key}`} rows={5} spellCheck={false} defaultValue={st.text} />
                </label>
                <button type="button" className="link-btn" data-reset={st.key} onClick={() => reset(st.key)}>
                  {t('settings.reset')}
                </button>
              </fieldset>
            ))}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        </details>
      </div>
    </AppSettings>
  );
}
