// The calendar's main screen: the coming days as a list (on a phone the view
// a calendar opens with), or a month with the chosen day's events below it.
// The round button makes an event; one opens over the view.
import { useMemo, useState } from 'react';
import type { Occurrence } from '../../../shared/caldav.js';
import { store } from '../../../shared/util.js';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { addDays, byDay, dayKey, eventHash, firstWeekday, fromDayKey, monthGrid, sameDay, startOfDay } from '../data/calendar.js';
import { useCalendar, useRange } from '../state';
import { dayHeading, locale, monthText, rangeText, timeText, weekdayShort } from './format';

type View = 'agenda' | 'month';
const VIEW_KEY = 'wjs.calendar.view';
const AGENDA_DAYS = 30;

export function CalendarView() {
  const t = useT();
  const { connecting, error, retry, calendars, setCompose } = useCalendar();
  const [view, setViewState] = useState<View>(() => (store.get(VIEW_KEY) === 'month' ? 'month' : 'agenda'));
  const setView = (v: View) => {
    setViewState(v);
    store.set(VIEW_KEY, v);
  };
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const today = () => {
    const d = new Date();
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelected(dayKey(d));
  };
  if (error)
    return (
      <div className="card cal-problem" id="calError" role="alert">
        <h2>
          <Icon name="cloud-off" />
          {t('cal.problem')}
        </h2>
        <p>{error}</p>
        <div className="cal-actions">
          <button type="button" className="btn btn-primary" data-act="retry" onClick={retry}>
            <Icon name="refresh-cw" />
            <span>{t('cal.retry')}</span>
          </button>
          <a className="btn" href="#/settings">
            <Icon name="settings" />
            <span>{t('cal.checkLogin')}</span>
          </a>
        </div>
      </div>
    );
  return (
    <div className="cal-page">
      <div className="toolbar app-bar">
        <div className="seg" role="radiogroup" aria-label={t('cal.view')} id="calView">
          {(['agenda', 'month'] as View[]).map((v) => (
            <label key={v}>
              <input type="radio" name="view" value={v} checked={view === v} onChange={() => setView(v)} />
              <span>{t(`cal.view.${v}`)}</span>
            </label>
          ))}
        </div>
        {view === 'month' ? (
          <div className="cal-nav">
            <button
              type="button"
              className="icon-btn"
              data-act="prev"
              aria-label={t('cal.prevMonth')}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <Icon name="chevron-left" />
            </button>
            <strong id="monthTitle">{monthText(month)}</strong>
            <button
              type="button"
              className="icon-btn"
              data-act="next"
              aria-label={t('cal.nextMonth')}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <Icon name="chevron-right" />
            </button>
          </div>
        ) : null}
        <button type="button" className="btn" data-act="today" onClick={today}>
          {t('cal.today')}
        </button>
        <button type="button" className="btn btn-primary fab" id="newEvent" onClick={() => setCompose({ day: view === 'month' ? fromDayKey(selected) : null })}>
          <Icon name="plus" />
          <span>{t('cal.new')}</span>
        </button>
      </div>
      {connecting && !calendars.length ? (
        <p className="empty">{t('cal.connecting')}</p>
      ) : !calendars.length ? (
        <p className="empty" id="noCalendars">
          {t('cal.noCalendars')}
        </p>
      ) : view === 'agenda' ? (
        <Agenda />
      ) : (
        <Month month={month} selected={selected} onSelect={setSelected} />
      )}
    </div>
  );
}

/** One event in a list: its time, its calendar's color, title and place. */
function EventRow({ o }: { o: Occurrence }) {
  const t = useT();
  const { calendars } = useCalendar();
  const cal = calendars.find((c) => c.url === o.calendar);
  return (
    <li>
      <a className="cal-event" href={eventHash(o)} data-event={o.title} style={{ '--cal-color': cal?.color || 'var(--accent)' } as any}>
        <span className="cal-time">{o.allDay ? t('cal.allDay') : timeText(o.start)}</span>
        <span className="cal-what">
          <b>{o.title || t('cal.untitled')}</b>
          {o.allDay ? null : <span className="muted small">{rangeText(o)}</span>}
          {o.location ? (
            <span className="muted small cal-where">
              <Icon name="map-pin" />
              {o.location}
            </span>
          ) : null}
        </span>
        {o.repeat ? <Icon name="repeat" className="muted" /> : null}
      </a>
    </li>
  );
}

/** The coming days that have something, from today; more days on request. */
function Agenda() {
  const t = useT();
  const [days, setDays] = useState(AGENDA_DAYS);
  const from = useMemo(() => startOfDay(new Date()), []);
  const to = useMemo(() => addDays(from, days), [from, days]);
  const { list, loading, error } = useRange(from, to);
  const groups = useMemo(() => {
    const map = byDay(list);
    return [...map.entries()].filter(([k]) => fromDayKey(k) >= from && fromDayKey(k) < to).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [list, from, to]);
  return (
    <div className="cal-agenda" id="agenda">
      {error ? <p className="empty">{error}</p> : null}
      {groups.length ? (
        groups.map(([k, items]) => (
          <section key={k} className="cal-day" data-day={k}>
            <h3>{dayHeading(fromDayKey(k))}</h3>
            <ul className="cal-events">
              {items.map((o: Occurrence) => (
                <EventRow key={o.id} o={o} />
              ))}
            </ul>
          </section>
        ))
      ) : loading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : (
        <p className="empty" id="agendaEmpty">
          {t('cal.emptyAgenda', { n: days })}
        </p>
      )}
      <button type="button" className="btn cal-more" data-act="more-days" disabled={loading} onClick={() => setDays(days + AGENDA_DAYS)}>
        {t('cal.moreDays', { n: AGENDA_DAYS })}
      </button>
    </div>
  );
}

/** A month: six weeks of days with what is on them; the chosen day's events below. */
function Month({ month, selected, onSelect }: { month: Date; selected: string; onSelect: (k: string) => void }) {
  const t = useT();
  const { calendars } = useCalendar();
  const first = firstWeekday(locale());
  const grid = useMemo(() => monthGrid(month, first), [month, first]);
  const { list, loading } = useRange(grid[0], addDays(grid[41], 1));
  const map = useMemo(() => byDay(list), [list]);
  const now = new Date();
  const items = map.get(selected) || [];
  const color = (o: Occurrence) => calendars.find((c) => c.url === o.calendar)?.color || 'var(--accent)';
  return (
    <div className="cal-month" id="month">
      <div className="cal-grid" role="grid" aria-label={monthText(month)} aria-busy={loading}>
        {grid.slice(0, 7).map((d) => (
          <span key={`h${d.getDay()}`} className="cal-wd" aria-hidden="true">
            {weekdayShort(d)}
          </span>
        ))}
        {grid.map((d) => {
          const k = dayKey(d);
          const on = map.get(k) || [];
          return (
            <button
              type="button"
              key={k}
              data-day={k}
              className={`cal-cell${d.getMonth() !== month.getMonth() ? ' out' : ''}${sameDay(d, now) ? ' today' : ''}${k === selected ? ' sel' : ''}`}
              aria-pressed={k === selected}
              aria-label={`${dayHeading(d)}${on.length ? ` · ${t('cal.count', { n: on.length })}` : ''}`}
              onClick={() => onSelect(k)}
            >
              <span className="cal-num">{d.getDate()}</span>
              <span className="cal-dots">
                {on.slice(0, 3).map((o: Occurrence) => (
                  <i key={o.id} style={{ background: color(o) }} />
                ))}
                {on.length > 3 ? <em>+{on.length - 3}</em> : null}
              </span>
              <span className="cal-titles phone-hide">
                {on.slice(0, 2).map((o: Occurrence) => (
                  <span key={o.id} style={{ borderColor: color(o) }}>
                    {o.title || t('cal.untitled')}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <section className="cal-day" id="dayList" data-day={selected}>
        <h3>{dayHeading(fromDayKey(selected))}</h3>
        {items.length ? (
          <ul className="cal-events">
            {items.map((o: Occurrence) => (
              <EventRow key={o.id} o={o} />
            ))}
          </ul>
        ) : (
          <p className="muted">{loading ? t('common.loading') : t('cal.emptyDay')}</p>
        )}
      </section>
    </div>
  );
}
