// The calendar: a person's CalDAV calendars (their Nextcloud, or any other
// server), on the phone as a list of the coming days or a month, with
// reminders while a page is open. The hub's container can forward
// /remote.php/dav/ to a Nextcloud beside it (HUB_CALDAV), which is then the
// address offered; the login is kept in the account's settings, sealed to the
// person's key, so every device they sign in on has it.
// Routes: #/ the view, #/e/<day>/<id> one event over it, #/settings.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalDav, type Calendar } from '../../shared/caldav.js';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { tErr, t as translate } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT } from '../../ui/hooks';
import { goBack, useHash } from '../../ui/route';
import { toast } from '../../ui/toast';
import { Panel } from '../../ui/widgets/Panel';
import { NAMESPACE, parseRoute, Reminders } from './data/calendar.js';
import { CalendarSettings } from './pages/CalendarSettings';
import { CalendarView } from './pages/CalendarView';
import { Composer } from './pages/Composer';
import { Connect } from './pages/Connect';
import { EventPage } from './pages/EventPage';
import { whenText } from './pages/format';
import { CalendarContext, type CalendarState, type Compose, useCalendar, usePrefs, useRange } from './state';

/** The address the hub offers: its own forwarding to a Nextcloud, or one its distribution names. */
export const defaultServer = (): string => String((DISTRIBUTION as any).caldav || '');

export function CalendarApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const hash = useHash({ scroll: false });
  const route = parseRoute(hash);
  const [prefsObj, setPrefsObj] = useState<any>(null);

  // the app's settings belong to the identity and live, like everything of the account's, on the hub's network
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const prefs = new AccountSettings(identity, kiwi.hubNet, NAMESPACE);
    let live = true;
    prefs
      .start()
      .then(() => live && setPrefsObj(prefs))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      prefs.stop();
      setPrefsObj(null);
    };
  }, [identity.pk, kiwi]);
  const prefs = usePrefs(prefsObj);

  // the connection: made again when the login changes, or when the person asks
  const server = prefs?.get('server') || '';
  const username = prefs?.get('username') || '';
  const password = prefs?.get('password') || '';
  const [attempt, setAttempt] = useState(0);
  const [conn, setConn] = useState<{ dav: CalDav | null; calendars: Calendar[]; connecting: boolean; error: string }>({
    dav: null,
    calendars: [],
    connecting: false,
    error: '',
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks again
  useEffect(() => {
    if (!server || !username || !password) {
      setConn({ dav: null, calendars: [], connecting: false, error: '' });
      return;
    }
    const dav = new CalDav({ server, username, password });
    let live = true;
    setConn((c) => ({ ...c, connecting: true, error: '' }));
    dav
      .connect()
      .then((calendars) => live && setConn({ dav, calendars, connecting: false, error: '' }))
      .catch((err: unknown) => live && setConn({ dav: null, calendars: [], connecting: false, error: tErr(err) }));
    return () => {
      live = false;
    };
  }, [server, username, password, attempt]);

  const [version, setVersion] = useState(0);
  const [compose, setCompose] = useState<Compose | null>(null);
  const hidden: string[] = prefs?.get('hidden') || [];
  const hiddenKey = hidden.join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: hiddenKey stands for hidden
  const shown = useMemo(() => conn.calendars.filter((c) => !hidden.includes(c.url)), [conn.calendars, hiddenKey]);
  const state: CalendarState | null = prefs
    ? {
        prefs,
        dav: conn.dav,
        calendars: conn.calendars,
        shown,
        connecting: conn.connecting,
        error: conn.error,
        retry: () => setAttempt((n) => n + 1),
        version,
        changed: () => setVersion((n) => n + 1),
        compose,
        setCompose,
      }
    : null;

  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);
  useEffect(() => {
    if (route.page === 'settings') window.scrollTo(0, 0);
  }, [route.page]);

  const configured = Boolean(server && username && password);
  const page = !state ? (
    <p className="empty">{t('common.loading')}</p>
  ) : route.page === 'settings' ? (
    <CalendarSettings />
  ) : !configured ? (
    <Connect />
  ) : (
    <>
      <CalendarView />
      {route.page === 'event' ? (
        <Panel key={route.id} title={t('cal.event')} onClose={() => goBack('#/')}>
          <EventPage day={route.day} id={route.id} />
        </Panel>
      ) : null}
      {compose ? (
        <Composer key={compose.existing?.id || 'new'} existing={compose.existing || null} day={compose.day || null} onClose={() => setCompose(null)} />
      ) : null}
      {conn.dav ? <ReminderRunner /> : null}
    </>
  );
  return (
    <AppShell footer={t('cal.footer')} settings="#/settings">
      {state ? <CalendarContext.Provider value={state}>{page}</CalendarContext.Provider> : page}
    </AppShell>
  );
}

/**
 * The reminders of the next two days, going off while this page is open: a notification when the person
 * allowed them on this device, a note on the page always.
 */
function ReminderRunner() {
  const { prefs } = useCalendar();
  // the window moves on every quarter of an hour
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15 * 60_000);
    return () => clearInterval(id);
  }, []);
  const [from, to] = useMemo(() => [new Date(now - 30 * 60_000), new Date(now + 49 * 3600_000)], [now]);
  const { list } = useRange(from, to);
  const reminders = useRef<Reminders | null>(null);
  if (!reminders.current)
    reminders.current = new Reminders((o: any, minutes: number) => {
      const when = whenText(o);
      toast(`${o.title || translate('cal.untitled')} · ${when}`, 'info', 15_000);
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && prefs.get('notify') !== false)
          new Notification(o.title || translate('cal.untitled'), { body: when, tag: `${o.id}|${minutes}`, icon: '../icon-192.png' });
      } catch {
        /* a browser that shows notifications only from a service worker: the note on the page stays */
      }
    });
  useEffect(() => {
    reminders.current?.set(list);
  }, [list]);
  useEffect(() => () => reminders.current?.stop(), []);
  return null;
}
