// Dates and times as a person reads them, in their language: the browser's
// Intl does the words (weekdays, months, "tomorrow", "15 minutes"), the
// catalog only what Intl has no word for.
import { currentLanguage, t } from '../../../shared/i18n.js';
import { addDays, sameDay } from '../data/calendar.js';

/** The language chosen here, with the browser's region when it speaks the same language (en-GB: Monday first, 24 hours). */
export function locale(): string {
  const chosen = currentLanguage() || 'en';
  const nav = (typeof navigator !== 'undefined' && navigator.languages) || [];
  return nav.find((x) => x.toLowerCase().split('-')[0] === chosen) || chosen;
}
const lang = locale;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang(), o);
const cap = (s: string) => s.charAt(0).toLocaleUpperCase(lang()) + s.slice(1);

export const timeText = (d: Date) => fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
export const dayText = (d: Date) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
export const longDayText = (d: Date) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const monthText = (d: Date) => cap(fmt({ month: 'long', year: 'numeric' }).format(d));
export const weekdayShort = (d: Date) => fmt({ weekday: 'narrow' }).format(d);

/** "Today", "Tomorrow", else the weekday and date. */
export function dayHeading(d: Date, now = new Date()) {
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  if (sameDay(d, now)) return `${cap(rtf.format(0, 'day'))} · ${dayText(d)}`;
  if (sameDay(d, addDays(now, 1))) return `${cap(rtf.format(1, 'day'))} · ${dayText(d)}`;
  return cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d));
}

/** When an occurrence is: "All day", "09:00 – 10:00", or across days with the dates. */
export function rangeText(o: { start: Date; end: Date; allDay: boolean }) {
  if (o.allDay) {
    const last = addDays(o.end, -1);
    return sameDay(o.start, last) || last < o.start ? t('cal.allDay') : `${dayText(o.start)} – ${dayText(last)}`;
  }
  if (sameDay(o.start, o.end) || +o.end === +o.start) return `${timeText(o.start)} – ${timeText(o.end)}`;
  return `${dayText(o.start)} ${timeText(o.start)} – ${dayText(o.end)} ${timeText(o.end)}`;
}

/** A length of time in words: 15 minutes, 2 hours, 1 day. */
export function durationText(minutes: number) {
  const unit = (n: number, u: string) => new Intl.NumberFormat(lang(), { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  if (minutes >= 1440 && minutes % 1440 === 0) return unit(minutes / 1440, 'day');
  if (minutes >= 60 && minutes % 60 === 0) return unit(minutes / 60, 'hour');
  return unit(minutes, 'minute');
}

/** A reminder's choice in words. */
export function reminderText(minutes: number | null) {
  if (minutes === null) return t('cal.reminder.none');
  if (minutes <= 0) return t('cal.reminder.atStart');
  return t('cal.reminder.before', { time: durationText(minutes) });
}

/** What a reminder says when it goes off: in how long, and when. */
export function whenText(o: { start: Date; end: Date; allDay: boolean }) {
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  const left = Math.round((+o.start - Date.now()) / 60_000);
  const soon =
    left <= 0
      ? t('cal.remind.now')
      : left < 60
        ? rtf.format(left, 'minute')
        : left < 1440
          ? rtf.format(Math.round(left / 60), 'hour')
          : rtf.format(Math.round(left / 1440), 'day');
  return `${cap(soon)} · ${o.allDay ? dayText(o.start) : `${dayText(o.start)} ${timeText(o.start)}`}`;
}
