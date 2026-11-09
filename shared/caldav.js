// The calendar's link to a CalDAV server: Nextcloud first, and any other server
// that speaks CalDAV (Radicale, Baïkal, a mail provider's). The server holds the
// calendar; nothing of it goes on nostr, and the page keeps no copy beyond what
// it shows. tsdav speaks WebDAV and ical.js reads and writes iCalendar, both
// vendored in caldav-lib.mjs (scripts/vendor.mjs).
//
// A hub reaches the server one of two ways: its container forwards
// /remote.php/dav/ to a Nextcloud beside it (HUB_CALDAV, container/entrypoint.sh),
// so the page asks its own origin; or the person names a server of their own,
// which must then allow the hub's origin (CORS).
//
// Times: an event is written in the device's time zone, with a VTIMEZONE made
// from what the browser knows (so a weekly 9:00 stays at 9:00 across daylight
// saving time); a whole-day event as dates. Reading honours the VTIMEZONEs a
// server sends and, without one, a zone name the browser knows. A repeating
// event is shown as each of its occurrences in the range asked for; a change
// applies to the whole series, and one occurrence can be taken out (EXDATE).

import {
  createAccount,
  createCalendarObject,
  deleteCalendarObject,
  fetchCalendarObjects,
  fetchCalendars,
  getBasicAuthHeaders,
  ICAL,
  updateCalendarObject,
} from './caldav-lib.mjs';
import { fail } from './util.js';

const PRODID = '-//kiwi-framework//calendar//EN';
/** How an event repeats, as the composer offers it ('' never); a rule beyond these is kept as it is. */
export const REPEATS = ['', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
/** Reminders the composer offers, in minutes before the start; null: none. */
export const REMINDERS = [null, 0, 5, 10, 15, 30, 60, 120, 1440, 2880];
const MAX_ITER = 5000; // occurrences looked at per series and range: 13 years of a daily event

/**
 * @typedef {{ url: string, name: string, color: string }} Calendar
 * @typedef {{ url: string, etag: string|null, data: string, calendar: string }} CalObject
 * @typedef {{
 *   id: string, url: string, etag: string|null, data: string, calendar: string, uid: string,
 *   title: string, location: string, description: string, allDay: boolean, start: Date, end: Date,
 *   repeat: string, recurrenceId: string|null, reminders: number[], seriesStart: Date, seriesEnd: Date
 * }} Occurrence
 * @typedef {{ title: string, allDay: boolean, start: Date, end: Date, location?: string, description?: string,
 *   repeat?: string, reminder?: number|null }} EventFields
 *   end is exclusive: for a whole-day event the midnight after its last day; repeat 'custom' keeps the rule;
 *   reminder undefined keeps the reminders as they are
 */

// ——— where the server is ————————————————————————————————————————————————————

/** Where CalDAV may live, from what a person typed: the address itself, then Nextcloud's path below it. */
export function serverCandidates(server, base = globalThis.location?.href) {
  let url;
  try {
    url = new URL(String(server || '').trim(), base);
  } catch {
    return [];
  }
  if (!/^https?:$/.test(url.protocol)) return [];
  const list = [url.href];
  if (!/dav/i.test(url.pathname)) {
    const dir = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    list.push(new URL(`${dir}remote.php/dav/`, url).href);
  }
  return [...new Set(list)];
}

const authFailed = (err) => /Invalid credentials|401/.test(String(err?.message || err));

/** What went wrong, in words the calendar can show. */
function explain(err) {
  if (err?.code?.startsWith?.('cal.')) return err;
  if (authFailed(err)) return fail('cal.error.auth', 'The server did not take that username and password.');
  if (err instanceof TypeError) return fail('cal.error.reach', 'The server did not answer this page: is the address right, and does it allow this hub?');
  return fail('cal.error.notFound', 'No calendars at that address.');
}

/** A refused write, in words. */
function check(res) {
  if (res?.ok) return res;
  const status = res?.status || 0;
  if (status === 412) throw fail('cal.error.changed', 'The event was changed elsewhere meanwhile. It has been loaded again.');
  if (status === 401) throw fail('cal.error.auth', 'The server did not take that username and password.');
  if (status === 403) throw fail('cal.error.readOnly', 'This calendar cannot be changed from here.');
  throw fail('cal.error.server', `The server refused it (${status}).`, { status });
}

const text = (v) => (typeof v === 'string' ? v : v?._cdata || v?._text || '').trim();
const colorOf = (v) => {
  const m = /^#([0-9a-f]{6})/i.exec(text(v));
  return m ? `#${m[1].toLowerCase()}` : '';
};
const lastSegment = (url) => decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
const slash = (url) => (url.endsWith('/') ? url : `${url}/`);
const newUid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).toLowerCase();

// ——— the server ————————————————————————————————————————————————————————————

export class CalDav {
  /**
   * @param {{ server: string, username: string, password: string, fetch?: typeof fetch | null }} options
   *   server: the address as given (a path on this hub, e.g. /remote.php/dav/, or https://cloud.example.org)
   */
  constructor({ server, username, password, fetch: fetchImpl = null }) {
    this.server = server;
    this.headers = getBasicAuthHeaders({ username, password });
    // no cookies of the hub's or the server's: the password goes with each request, and CORS stays simple
    this.fetch = fetchImpl || ((url, init) => globalThis.fetch(url, { ...init, credentials: 'omit', cache: 'no-store' }));
    this.account = null;
  }

  /** Find the server's calendars (the address as given, then Nextcloud's path below it). */
  async connect() {
    let last = null;
    for (const serverUrl of serverCandidates(this.server)) {
      try {
        this.account = await createAccount({ account: { serverUrl, accountType: 'caldav' }, headers: this.headers, fetch: this.fetch });
        return await this.calendars();
      } catch (err) {
        last = err;
        if (authFailed(err)) break;
      }
    }
    throw explain(last);
  }

  /** @returns {Promise<Calendar[]>} the calendars that hold events */
  async calendars() {
    try {
      const list = await fetchCalendars({ account: this.account, headers: this.headers, fetch: this.fetch });
      return list
        .filter((c) => !c.components?.length || c.components.includes('VEVENT'))
        .map((c) => ({ url: c.url, name: text(c.displayName) || lastSegment(c.url), color: colorOf(c.calendarColor) }));
    } catch (err) {
      throw explain(err);
    }
  }

  /**
   * The occurrences in [start, end) of these calendars, by start.
   * @param {Calendar[]} calendars
   * @param {Date} start
   * @param {Date} end
   * @returns {Promise<Occurrence[]>}
   */
  async range(calendars, start, end) {
    const timeRange = { start: start.toISOString(), end: end.toISOString() };
    const lists = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const objects = await fetchCalendarObjects({ calendar: { url: cal.url }, headers: this.headers, fetch: this.fetch, timeRange });
          return objects.filter((o) => o.data).flatMap((o) => occurrences({ url: o.url, etag: o.etag || null, data: o.data, calendar: cal.url }, start, end));
        } catch (err) {
          throw explain(err);
        }
      }),
    );
    return lists.flat().sort((a, b) => +a.start - +b.start || a.title.localeCompare(b.title));
  }

  /**
   * A new event in a calendar.
   * @param {string} calendar  its url
   * @param {EventFields} fields
   * @returns {Promise<CalObject>}
   */
  async create(calendar, fields) {
    const uid = newUid();
    const data = writeEvent(fields, null, { uid });
    const filename = `${uid}.ics`;
    const res = check(await createCalendarObject({ calendar: { url: calendar }, filename, iCalString: data, headers: this.headers, fetch: this.fetch }).catch(rethrow));
    return { url: new URL(filename, slash(calendar)).href, etag: res.headers?.get?.('ETag') || null, data, calendar };
  }

  /**
   * The event changed (for a series: every occurrence).
   * @param {CalObject} object
   * @param {EventFields} fields
   */
  async update(object, fields) {
    return this.put(object, writeEvent(fields, object.data));
  }

  /** One occurrence of a series taken out; the others stay. */
  async skip(object, recurrenceId) {
    return this.put(object, withoutOccurrence(object.data, recurrenceId));
  }

  /** @param {CalObject} object */
  async remove(object) {
    check(await deleteCalendarObject({ calendarObject: { url: object.url, etag: object.etag || undefined }, headers: this.headers, fetch: this.fetch }).catch(rethrow));
  }

  async put(object, data) {
    check(await updateCalendarObject({ calendarObject: { url: object.url, etag: object.etag || undefined, data }, headers: this.headers, fetch: this.fetch }).catch(rethrow));
    return { ...object, data };
  }
}

function rethrow(err) {
  throw explain(err);
}

// ——— time zones ————————————————————————————————————————————————————————————

/** The device's time zone, e.g. Europe/Berlin (null where the browser does not say). */
export const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

const knownZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const partsCache = new Map();
/** The wall clock in a zone at an instant: [year, month, day, hour, minute, second, weekday 0-6]. */
function wall(tz, ms) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day, +p.hour % 24, +p.minute, +p.second, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)];
}

/** Minutes east of UTC in a zone at an instant. */
function offsetAt(tz, ms) {
  const [y, mo, d, h, mi, s] = wall(tz, ms);
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant a wall clock time in a zone stands for. */
function fromWall(tz, y, mo, d, h = 0, mi = 0, s = 0) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = asUtc - offsetAt(tz, asUtc) * 60000;
  ms = asUtc - offsetAt(tz, ms) * 60000; // once more, across a change of offset
  return new Date(ms);
}

const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
const offsetText = (min) => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}${pad(Math.abs(min) % 60)}`;
const stamp = (y, mo, d, h = 0, mi = 0, s = 0) => `${pad(y, 4)}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}${pad(s)}`;

/**
 * A VTIMEZONE for a zone, from the browser's own rules: the offset changes of the given year, each as a yearly
 * rule (the n-th or last weekday of its month), as calendars write them. A zone without changes gets one
 * standard observance.
 */
export function vtimezone(tz, year = new Date().getFullYear()) {
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const changes = [];
  let prev = offsetAt(tz, from);
  for (let t = from + 86_400_000; t <= to; t += 86_400_000) {
    const off = offsetAt(tz, t);
    if (off === prev) continue;
    // to the minute: the last instant with the old offset
    let lo = t - 86_400_000;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (offsetAt(tz, mid) === prev) lo = mid;
      else hi = mid;
    }
    changes.push({ at: hi, from: prev, to: off });
    prev = off;
  }
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  if (!changes.length) {
    const off = offsetText(prev);
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, 'END:STANDARD');
  } else {
    const max = Math.max(...changes.map((c) => c.to));
    for (const c of changes) {
      // the change as the wall clock before it shows it, and as a rule: the n-th (or last) weekday of the month
      const local = new Date(c.at + c.from * 60000);
      const mo = local.getUTCMonth() + 1;
      const day = local.getUTCDate();
      const wd = local.getUTCDay();
      const dim = new Date(Date.UTC(year, mo, 0)).getUTCDate();
      const nth = day + 7 > dim ? -1 : Math.ceil(day / 7);
      const byday = `${nth}${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][wd]}`;
      // the rule's first occurrence in 1970, so it holds for every year an event may have
      const first = nthWeekday(1970, mo, wd, nth);
      const kind = c.to === max && c.to !== Math.min(...changes.map((x) => x.to)) ? 'DAYLIGHT' : 'STANDARD';
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${stamp(1970, mo, first, local.getUTCHours(), local.getUTCMinutes())}`,
        `RRULE:FREQ=YEARLY;BYMONTH=${mo};BYDAY=${byday}`,
        `TZOFFSETFROM:${offsetText(c.from)}`,
        `TZOFFSETTO:${offsetText(c.to)}`,
        `END:${kind}`,
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines.join('\r\n');
}

/** The day of the month of the n-th (-1: last) weekday wd in a month. */
function nthWeekday(year, month, wd, nth) {
  if (nth > 0) {
    const firstWd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((wd - firstWd + 7) % 7) + (nth - 1) * 7;
  }
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWd = new Date(Date.UTC(year, month - 1, dim)).getUTCDay();
  return dim - ((lastWd - wd + 7) % 7);
}

/** The VTIMEZONEs an object carries, known to ical.js before its times are read. */
function registerZones(cal) {
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }
}

/** A zone ical.js knows, made from the browser's rules when it does not yet. */
function zoneFor(tz) {
  if (!tz || !knownZone(tz) || /^(UTC|Etc\/UTC|GMT)$/i.test(tz)) return null;
  if (!ICAL.TimezoneService.has(tz)) ICAL.TimezoneService.register(new ICAL.Component(ICAL.parse(vtimezone(tz))));
  return ICAL.TimezoneService.get(tz);
}

/** A time from the server as an instant (a date as local midnight); a zone it names but does not define, from the browser. */
function toDate(time, tzid) {
  if (time.isDate) return new Date(time.year, time.month - 1, time.day);
  const floating = !time.zone || time.zone.tzid === 'floating';
  if (floating && tzid && knownZone(tzid)) return fromWall(tzid, time.year, time.month, time.day, time.hour, time.minute, time.second);
  return time.toJSDate();
}

// ——— reading ———————————————————————————————————————————————————————————————

/** The reminders of an event, in minutes before its start (relative triggers; an absolute one against `start`). */
function remindersOf(vevent, start) {
  const out = new Set();
  for (const alarm of vevent.getAllSubcomponents('valarm')) {
    const prop = alarm.getFirstProperty('trigger');
    const value = prop?.getFirstValue();
    if (!value) continue;
    if (value instanceof ICAL.Duration) {
      if (String(prop.getParameter('related') || '').toUpperCase() === 'END') continue; // rare; not offered here
      out.add(Math.round(-value.toSeconds() / 60));
    } else if (value instanceof ICAL.Time) {
      out.add(Math.round((+start - +value.toJSDate()) / 60000));
    }
  }
  return [...out].sort((a, b) => b - a);
}

/** How a series repeats, as the composer names it; 'custom' for a rule it does not offer. */
function repeatOf(vevent) {
  const rule = vevent.getFirstPropertyValue('rrule');
  if (!rule) return '';
  const simple = REPEATS.includes(rule.freq) && (rule.interval || 1) === 1 && !rule.until && !rule.count && !Object.keys(rule.parts || {}).length;
  return simple ? rule.freq : 'custom';
}

/**
 * The occurrences of an object's events in [start, end): one for a single event, one per repeat for a series
 * (a changed occurrence as changed, a removed one not at all).
 * @param {CalObject} object
 * @param {Date} start
 * @param {Date} end
 * @returns {Occurrence[]}
 */
export function occurrences(object, start, end) {
  let cal;
  try {
    cal = new ICAL.Component(ICAL.parse(object.data));
  } catch {
    return [];
  }
  registerZones(cal);
  const vevents = cal.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
  const overlaps = (s, e) => s < end && (e > start || (+s === +e && s >= start));
  const out = [];
  // moved occurrences of a series kept elsewhere: each on its own
  for (const master of masters.length ? masters.slice(0, 1) : vevents) {
    const event = new ICAL.Event(master);
    if (masters.length) for (const v of vevents) if (v.hasProperty('recurrence-id')) event.relateException(v);
    const tzid = master.getFirstProperty('dtstart')?.getParameter('tzid') || null;
    const seriesStart = toDate(event.startDate, tzid);
    const seriesEnd = toDate(event.endDate, tzid);
    const base = {
      url: object.url,
      etag: object.etag,
      data: object.data,
      calendar: object.calendar,
      uid: event.uid || '',
      allDay: event.startDate.isDate,
      repeat: repeatOf(master),
      seriesStart,
      seriesEnd,
    };
    const details = (vevent, s) => ({
      title: vevent.getFirstPropertyValue('summary') || '',
      location: vevent.getFirstPropertyValue('location') || '',
      description: vevent.getFirstPropertyValue('description') || '',
      reminders: remindersOf(vevent.getAllSubcomponents('valarm').length ? vevent : master, s),
    });
    if (!masters.length || !event.isRecurring()) {
      if (overlaps(seriesStart, seriesEnd)) out.push({ ...base, ...details(master, seriesStart), id: `${object.url}|`, start: seriesStart, end: seriesEnd, recurrenceId: null });
      continue;
    }
    const it = event.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_ITER; i++, next = it.next()) {
      if (toDate(next, tzid) >= end) break;
      const d = event.getOccurrenceDetails(next);
      const s = toDate(d.startDate, tzid);
      const e = toDate(d.endDate, tzid);
      if (!overlaps(s, e)) continue;
      const rid = d.recurrenceId.toString();
      out.push({ ...base, ...details(d.item.component, s), id: `${object.url}|${rid}`, start: s, end: e, recurrenceId: rid });
    }
  }
  return out;
}

// ——— writing ———————————————————————————————————————————————————————————————

/** A time for DTSTART/DTEND: a date for a whole-day event, else the wall clock in the device's zone (UTC without one). */
function timeOf(date, allDay, tz) {
  if (allDay) return { time: new ICAL.Time({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), isDate: true }), tzid: null };
  const zone = zoneFor(tz);
  if (!zone) return { time: ICAL.Time.fromJSDate(date, true), tzid: null };
  const [y, mo, d, h, mi, s] = wall(tz, +date);
  return { time: new ICAL.Time({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }, zone), tzid: tz };
}

function setTime(vevent, name, date, allDay, tz) {
  vevent.removeAllProperties(name);
  const { time, tzid } = timeOf(date, allDay, tz);
  const prop = new ICAL.Property(name);
  if (allDay) prop.resetType('date');
  prop.setValue(time);
  if (tzid) prop.setParameter('tzid', tzid);
  vevent.addProperty(prop);
  return tzid;
}

function setText(vevent, name, value) {
  const v = String(value || '').trim();
  if (v) vevent.updatePropertyWithValue(name, v);
  else vevent.removeAllProperties(name);
}

const utcNow = (now) => ICAL.Time.fromJSDate(now, true);

/**
 * The iCalendar text of an event: new, or `previous` changed (its other properties, attendees and the like,
 * kept). For a series the times are the series' first occurrence's; moving it or changing how it repeats drops
 * the changed and removed occurrences, which would no longer fit.
 * @param {EventFields} fields
 * @param {string|null} previous
 * @param {{ uid?: string|null, timeZone?: string|null, now?: Date }} [options]
 */
export function writeEvent(fields, previous = null, { uid = null, timeZone = localZone(), now = new Date() } = {}) {
  let cal;
  let master;
  if (previous) {
    cal = new ICAL.Component(ICAL.parse(previous));
    registerZones(cal);
    master = cal.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id')) || cal.getFirstSubcomponent('vevent');
  }
  if (!master) {
    cal = new ICAL.Component(['vcalendar', [], []]);
    cal.updatePropertyWithValue('prodid', PRODID);
    cal.updatePropertyWithValue('version', '2.0');
    cal.updatePropertyWithValue('calscale', 'GREGORIAN');
    master = new ICAL.Component('vevent');
    cal.addSubcomponent(master);
    master.updatePropertyWithValue('uid', uid || newUid());
    master.updatePropertyWithValue('created', utcNow(now));
  }
  setText(master, 'summary', fields.title);
  setText(master, 'location', fields.location);
  setText(master, 'description', fields.description);

  // the times, unless they are what the event says already (its own zone and form kept then)
  const was = previous ? new ICAL.Event(master) : null;
  const wasTzid = master.getFirstProperty('dtstart')?.getParameter('tzid') || null;
  const moved =
    !was ||
    was.startDate.isDate !== Boolean(fields.allDay) ||
    +toDate(was.startDate, wasTzid) !== +fields.start ||
    +toDate(was.endDate, wasTzid) !== +fields.end;
  if (moved) {
    master.removeAllProperties('duration');
    const tzid = setTime(master, 'dtstart', fields.start, fields.allDay, timeZone);
    setTime(master, 'dtend', fields.end, fields.allDay, timeZone);
    if (tzid && !cal.getAllSubcomponents('vtimezone').some((z) => z.getFirstPropertyValue('tzid') === tzid))
      cal.addSubcomponent(new ICAL.Component(ICAL.parse(vtimezone(tzid, fields.start.getFullYear()))));
  }

  // how it repeats
  const repeat = fields.repeat ?? '';
  const repeatChanged = repeat !== 'custom' && repeat !== repeatOf(master);
  if (repeatChanged) {
    master.removeAllProperties('rrule');
    if (repeat) master.addPropertyWithValue('rrule', ICAL.Recur.fromData({ freq: repeat }));
  }
  if (previous && (moved || repeatChanged)) {
    master.removeAllProperties('exdate');
    for (const v of cal.getAllSubcomponents('vevent')) if (v !== master && v.hasProperty('recurrence-id')) cal.removeSubcomponent(v);
  }

  // the reminder: one, shown by the device, so many minutes before
  if (fields.reminder !== undefined) {
    master.removeAllSubcomponents('valarm');
    if (fields.reminder !== null) {
      const alarm = new ICAL.Component('valarm');
      alarm.updatePropertyWithValue('action', 'DISPLAY');
      alarm.updatePropertyWithValue('description', String(fields.title || '').trim() || 'Reminder');
      alarm.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(-Math.max(0, fields.reminder) * 60));
      master.addSubcomponent(alarm);
    }
  }

  master.updatePropertyWithValue('dtstamp', utcNow(now));
  master.updatePropertyWithValue('last-modified', utcNow(now));
  if (previous) master.updatePropertyWithValue('sequence', (Number(master.getFirstPropertyValue('sequence')) || 0) + 1);
  return cal.toString();
}

/** A series without one of its occurrences (by its recurrence id, as occurrences() gives it). */
export function withoutOccurrence(data, recurrenceId) {
  const cal = new ICAL.Component(ICAL.parse(data));
  registerZones(cal);
  const vevents = cal.getAllSubcomponents('vevent');
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'));
  if (!master) throw fail('cal.error.notSeries', 'This event does not repeat.');
  for (const v of vevents) if (v !== master && v.getFirstPropertyValue('recurrence-id')?.toString() === recurrenceId) cal.removeSubcomponent(v);
  const time = ICAL.Time.fromString(recurrenceId);
  const prop = new ICAL.Property('exdate');
  if (time.isDate) prop.resetType('date');
  prop.setValue(time);
  const tzid = master.getFirstProperty('dtstart')?.getParameter('tzid');
  if (tzid && !time.isDate && !recurrenceId.endsWith('Z')) prop.setParameter('tzid', tzid);
  master.addProperty(prop);
  master.updatePropertyWithValue('sequence', (Number(master.getFirstPropertyValue('sequence')) || 0) + 1);
  return cal.toString();
}
