// What the calendar's screens share that is not the server (shared/caldav.js):
// the routes, the days a view covers, how a time is written for a person, and
// the reminders, which go off while a page of the calendar is open on this
// device: each one once, a late one (the page was closed) up to a quarter of
// an hour after its time, then no more.
import { store } from '../../../shared/util.js';

/** The app's settings in the account (shared/settings.js): the server, the login, hidden calendars, the view. */
export const NAMESPACE = 'calendar';
const FIRED_KEY = 'wjs.calendar.fired';
const LATE = 15 * 60_000; // a reminder missed by at most this much still goes off when the page opens
const AHEAD = 48 * 3600_000; // reminders looked for so far ahead

/**
 * #/ the view, #/e/<yyyy-mm-dd>/<occurrence id> one event over it (the date keeps the view where it is), #/settings.
 * @returns {{ page: 'view' } | { page: 'event', day: string, id: string } | { page: 'settings' }}
 */
export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#\/?/, '');
  if (h.startsWith('settings')) return { page: 'settings' };
  const m = /^e\/(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(h);
  if (m) return { page: 'event', day: m[1], id: decodeURIComponent(m[2]) };
  return { page: 'view' };
}

export const eventHash = (o) => `#/e/${dayKey(o.start)}/${encodeURIComponent(o.id)}`;

/** A day as yyyy-mm-dd, in local time. */
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromDayKey = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a, b) => dayKey(a) === dayKey(b);

/** The first day of the week where the person lives: Monday, Sunday or Saturday (0 = Sunday). */
export function firstWeekday(lang) {
  try {
    const info = new Intl.Locale(lang || 'en').maximize();
    const week = info.getWeekInfo?.() || info.weekInfo;
    if (week?.firstDay) return week.firstDay % 7;
  } catch {
    /* an old browser: Monday */
  }
  return 1;
}

/** The six weeks a month view shows: from the week the month starts in. */
export function monthGrid(anchor, firstDay = 1) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() - firstDay + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The days an occurrence covers, as day keys (an event ending at midnight does not cover the next day). */
export function daysOf(o) {
  const out = [];
  const last = new Date(Math.max(+o.start, +o.end - 1));
  for (let d = startOfDay(o.start); d <= last && out.length < 366; d = addDays(d, 1)) out.push(dayKey(d));
  return out.length ? out : [dayKey(o.start)];
}

/** Occurrences by the days they cover. */
export function byDay(list) {
  const map = new Map();
  for (const o of list)
    for (const k of daysOf(o)) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    }
  for (const l of map.values()) l.sort((a, b) => Number(b.allDay) - Number(a.allDay) || +a.start - +b.start);
  return map;
}

/** The next full hour, for a new event. */
export function nextHour(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** A Date for <input type=date> and type=time, and back. */
export const timeKey = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export function joinDateTime(day, time) {
  const d = fromDayKey(day);
  const [h, m] = String(time || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/**
 * The reminders that go off on this device while the page is open. `notify(occurrence, minutes)` shows one.
 * set() takes the occurrences of the next hours each time they are read again.
 */
export class Reminders {
  constructor(notify, { now = () => Date.now() } = {}) {
    this.notify = notify;
    this.now = now;
    this.timers = new Map();
  }

  /** @param {Array<{ id: string, start: Date, reminders: number[], title: string }>} list */
  set(list) {
    const now = this.now();
    const wanted = new Map();
    for (const o of list)
      for (const m of o.reminders || []) {
        const at = +o.start - m * 60_000;
        if (at < now - LATE || at > now + AHEAD) continue;
        wanted.set(`${o.id}|${m}`, { o, m, at });
      }
    for (const [key, timer] of this.timers)
      if (!wanted.has(key)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    const fired = this.fired();
    for (const [key, { o, m, at }] of wanted) {
      if (fired[key] || this.timers.has(key)) continue;
      this.timers.set(
        key,
        setTimeout(() => this.fire(key, o, m), Math.max(0, at - now)),
      );
    }
  }

  fire(key, o, m) {
    this.timers.delete(key);
    const fired = this.fired();
    if (fired[key]) return;
    const now = this.now();
    fired[key] = now;
    for (const [k, at] of Object.entries(fired)) if (now - Number(at) > 3 * 86_400_000) delete fired[k]; // forgotten after three days
    store.set(FIRED_KEY, fired);
    this.notify(o, m);
  }

  fired() {
    return store.get(FIRED_KEY, {}) || {};
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
