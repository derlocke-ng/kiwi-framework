// One event, over the view: when, how it repeats, the reminder, where, the
// notes, which calendar. Edit opens the composer; delete asks, and for a
// repeating event offers this occurrence alone or every one (a menu).
import { useMemo, useState } from 'react';
import type { Occurrence } from '../../../shared/caldav.js';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { toast } from '../../../ui/toast';
import { addDays, fromDayKey } from '../data/calendar.js';
import { useCalendar, useRange } from '../state';
import { longDayText, rangeText, reminderText } from './format';

export function EventPage({ day, id }: { day: string; id: string }) {
  const t = useT();
  const { calendars, dav, changed, setCompose } = useCalendar();
  const from = useMemo(() => fromDayKey(day), [day]);
  const to = useMemo(() => addDays(from, 1), [from]);
  const { list, loading } = useRange(from, to);
  const o = list.find((x) => x.id === id) || null;
  const [busy, setBusy] = useState(false);
  if (!o) return <p className="empty">{loading ? t('common.loading') : t('cal.gone')}</p>;
  const cal = calendars.find((c) => c.url === o.calendar);
  const remove = async (only: boolean) => {
    setBusy(true);
    try {
      if (only && o.recurrenceId) await dav?.skip(o, o.recurrenceId);
      else await dav?.remove(o);
      changed();
      toast(t('cal.deleted'), 'success');
      goBack('#/');
    } catch (err) {
      setBusy(false);
      changed();
      toast(tErr(err), 'error', 6000);
    }
  };
  const askDelete = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (o.recurrenceId)
      // a repeating event: this one, or all of them
      return openMenu(e.currentTarget, [
        { label: t('cal.deleteOne', { date: longDayText(o.start) }), icon: 'calendar', act: 'delete-one', danger: true, run: () => remove(true) },
        { label: t('cal.deleteAll'), icon: 'repeat', act: 'delete-all', danger: true, run: () => remove(false) },
      ]);
    if (await confirmDialog({ title: t('cal.deleteTitle'), message: o.title || t('cal.untitled'), confirm: t('common.delete'), danger: true })) remove(false);
  };
  return (
    <article className="cal-detail" id="eventDetail" style={{ '--cal-color': cal?.color || 'var(--accent)' } as any}>
      <h2 id="eventTitle">{o.title || t('cal.untitled')}</h2>
      <p className="cal-line">
        <Icon name="clock" />
        <span>
          {longDayText(o.start)}
          <br />
          <span id="eventWhen">{rangeText(o)}</span>
        </span>
      </p>
      {o.repeat ? (
        <p className="cal-line" id="eventRepeat">
          <Icon name="repeat" />
          <span>{t(`cal.repeat.${o.repeat.toLowerCase()}`)}</span>
        </p>
      ) : null}
      <p className="cal-line" id="eventReminder">
        <Icon name="bell" />
        <span>{o.reminders.length ? o.reminders.map((m) => reminderText(m)).join(', ') : t('cal.reminder.none')}</span>
      </p>
      {o.location ? (
        <p className="cal-line">
          <Icon name="map-pin" />
          <span id="eventWhere">{o.location}</span>
        </p>
      ) : null}
      {o.description ? <p className="cal-notes">{o.description}</p> : null}
      <p className="cal-line muted">
        <i className="cal-dot" />
        <span id="eventCalendar">{cal?.name || ''}</span>
      </p>
      <div className="cal-actions">
        <button type="button" className="btn btn-primary" data-act="edit" disabled={busy} onClick={() => setCompose({ existing: o })}>
          <Icon name="pencil" />
          <span>{t('cal.edit')}</span>
        </button>
        <button type="button" className="btn btn-danger" data-act="delete" disabled={busy} onClick={askDelete}>
          <Icon name="trash-2" />
          <span>{t('common.delete')}</span>
        </button>
      </div>
      {o.recurrenceId ? <p className="muted small">{t('cal.seriesNote')}</p> : null}
    </article>
  );
}

export type { Occurrence };
