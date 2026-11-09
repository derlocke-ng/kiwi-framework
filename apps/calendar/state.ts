// What the calendar's screens share: the app's settings in the account (the
// server and the login among them), the connection to the server and its
// calendars, the events of a range as they are read, the composer, and a
// version that moves on whenever something was written, so every range reads
// again.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CalDav, Calendar, Occurrence } from '../../shared/caldav.js';
import { tErr } from '../../shared/i18n.js';
import { useTick } from '../../ui/hooks';

export interface Compose {
  existing?: Occurrence | null;
  day?: Date | null;
}

export interface CalendarState {
  prefs: any;
  dav: CalDav | null;
  calendars: Calendar[];
  /** the calendars shown (the person may hide some) */
  shown: Calendar[];
  connecting: boolean;
  error: string;
  retry: () => void;
  version: number;
  changed: () => void;
  compose: Compose | null;
  setCompose: (c: Compose | null) => void;
}

export const CalendarContext = createContext<CalendarState | null>(null);

export function useCalendar(): CalendarState {
  const state = useContext(CalendarContext);
  if (!state) throw new Error('useCalendar outside the calendar app');
  return state;
}

/** The app's settings in the account, re-rendering on every change. */
export function usePrefs(prefs: any): any {
  useTick(useCallback((fn: () => void) => (prefs ? prefs.onChange(fn) : () => {}), [prefs]));
  return prefs;
}

const REFRESH = 5 * 60_000; // a range is read again this often while the page is open, and on return to it

/** The occurrences in [start, end) of the calendars shown, read again after every change, on return and every few minutes. */
export function useRange(start: Date, end: Date): { list: Occurrence[]; loading: boolean; error: string } {
  const { dav, shown, version } = useCalendar();
  const [state, setState] = useState<{ list: Occurrence[]; loading: boolean; error: string; key: string }>({ list: [], loading: true, error: '', key: '' });
  const [tick, setTick] = useState(0);
  const from = +start;
  const to = +end;
  const cals = shown.map((c) => c.url).join('|');
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && setTick((n) => n + 1);
    const id = setInterval(again, REFRESH);
    document.addEventListener('visibilitychange', again);
    addEventListener('pageshow', again);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', again);
      removeEventListener('pageshow', again);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the range, the calendars and the version are the key
  useEffect(() => {
    if (!dav) return;
    const key = `${from}|${to}|${cals}`;
    let live = true;
    setState((s) => ({ ...s, loading: true, ...(s.key === key ? {} : { list: [], key }) }));
    dav
      .range(shown, new Date(from), new Date(to))
      .then((list) => live && setState({ list, loading: false, error: '', key }))
      .catch((err: unknown) => live && setState((s) => ({ ...s, loading: false, error: tErr(err) })));
    return () => {
      live = false;
    };
  }, [dav, from, to, cals, version, tick]);
  return state;
}
