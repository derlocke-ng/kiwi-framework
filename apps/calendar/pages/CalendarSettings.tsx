// The calendar's own settings: the server and login, which calendars are
// shown, reminders on this device. Account, relays and the rest are the site's.
import { useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { HOW } from '../../../ui/widgets/HowItWorks';
import { useCalendar } from '../state';
import { LoginForm } from './Connect';

const notifyState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function CalendarSettings() {
  const t = useT();
  const mount = useMount();
  const { prefs, calendars, error } = useCalendar();
  const hidden: string[] = prefs.get('hidden') || [];
  const [permission, setPermission] = useState<string>(notifyState());
  const configured = Boolean(prefs.get('server') && prefs.get('username') && prefs.get('password'));
  const toggle = (url: string, show: boolean) =>
    prefs.set({ hidden: show ? hidden.filter((h) => h !== url) : [...new Set([...hidden, url])] }).catch((err: unknown) => toast(tErr(err), 'error'));
  const allow = async () => {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(notifyState());
    }
  };
  const disconnect = async () => {
    if (!(await confirmDialog({ title: t('cal.disconnectTitle'), message: t('cal.disconnectText'), confirm: t('cal.disconnect'), danger: true }))) return;
    await prefs.set({ server: '', username: '', password: '', hidden: [] }).catch((err: unknown) => toast(tErr(err), 'error'));
    toast(t('cal.disconnected'), 'success');
  };
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('cal.back')} how={['cal.how.1', ...HOW.calendar]}>
      <div className="card" id="serverCard">
        <h2>
          <Icon name="server" />
          {t('cal.serverTitle')}
        </h2>
        {configured ? (
          <p className="muted small" id="connectedAs">
            {error ? t('cal.notConnected', { error }) : t('cal.connectedAs', { user: prefs.get('username'), n: calendars.length })}
          </p>
        ) : null}
        <LoginForm onDone={() => (location.hash = '#/')} />
        {configured ? (
          <button type="button" className="btn btn-danger" data-act="disconnect" onClick={disconnect}>
            <Icon name="log-out" />
            <span>{t('cal.disconnect')}</span>
          </button>
        ) : null}
      </div>
      {calendars.length ? (
        <div className="card" id="calendarsCard">
          <h2>
            <Icon name="calendar" />
            {t('cal.calendars')}
          </h2>
          <p className="muted small">{t('cal.calendarsText')}</p>
          <ul className="cal-list">
            {calendars.map((c) => (
              <li key={c.url}>
                <label className="check-row">
                  <input type="checkbox" checked={!hidden.includes(c.url)} data-calendar={c.name} onChange={(e) => toggle(c.url, e.target.checked)} />
                  <i className="cal-dot" style={{ background: c.color || 'var(--accent)' }} />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="card" id="remindersCard">
        <h2>
          <Icon name="bell" />
          {t('cal.reminders')}
        </h2>
        <p className="muted small">{t('cal.remindersText')}</p>
        {permission === 'granted' ? (
          <p id="notifyState">
            <Icon name="check" /> {t('cal.notifyOn')}
          </p>
        ) : permission === 'denied' ? (
          <p className="muted" id="notifyState">
            {t('cal.notifyDenied')}
          </p>
        ) : permission === 'unsupported' ? (
          <p className="muted" id="notifyState">
            {t('cal.notifyUnsupported')}
          </p>
        ) : (
          <button type="button" className="btn" id="allowNotify" onClick={allow}>
            <Icon name="bell" />
            <span>{t('cal.notifyAllow')}</span>
          </button>
        )}
      </div>
    </AppSettings>
  );
}
