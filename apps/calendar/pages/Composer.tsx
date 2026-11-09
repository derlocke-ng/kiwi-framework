// Making or changing an event: what, whole day or from–to, how it repeats, a
// reminder, which calendar, where, notes. A repeating event is changed as a
// whole, so the form shows its first occurrence's times. A whole-day event's
// last day is inclusive here and exclusive on the server (shared/caldav.js).
import { type FormEvent, useState } from 'react';
import { type Occurrence, REMINDERS, REPEATS } from '../../../shared/caldav.js';
import { tErr } from '../../../shared/i18n.js';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { addDays, dayKey, joinDateTime, nextHour, timeKey } from '../data/calendar.js';
import { useCalendar } from '../state';
import { reminderText } from './format';

const DEFAULT_REMINDER = 15;

export function Composer({ existing, day, onClose }: { existing: Occurrence | null; day: Date | null; onClose: () => void }) {
  const t = useT();
  const { dav, shown, calendars, prefs, changed } = useCalendar();
  // a series is edited from its first occurrence; a new event starts at the next full hour (of the chosen day)
  const start0 = existing ? (existing.recurrenceId ? existing.seriesStart : existing.start) : day ? joinDateTime(dayKey(day), timeKey(nextHour())) : nextHour();
  const end0 = existing ? (existing.recurrenceId ? existing.seriesEnd : existing.end) : new Date(+start0 + 3600_000);
  const allDay0 = Boolean(existing?.allDay);
  const [title, setTitle] = useState(existing?.title || '');
  const [allDay, setAllDay] = useState(allDay0);
  const [startDay, setStartDay] = useState(dayKey(start0));
  const [startTime, setStartTime] = useState(timeKey(start0));
  // a whole-day event's end on the server is the midnight after its last day
  const [endDay, setEndDay] = useState(dayKey(allDay0 ? addDays(end0, -1) : end0));
  const [endTime, setEndTime] = useState(timeKey(end0));
  const [repeat, setRepeat] = useState(existing?.repeat || '');
  const reminder0 = existing
    ? existing.reminders.length
      ? existing.reminders[existing.reminders.length - 1]
      : null
    : (prefs.get('reminder') ?? DEFAULT_REMINDER);
  const [reminder, setReminder] = useState<number | null>(reminder0);
  const lastCalendar = prefs.get('calendar');
  const [calendar, setCalendar] = useState(
    existing?.calendar || (shown.some((c) => c.url === lastCalendar) ? lastCalendar : shown[0]?.url || calendars[0]?.url || ''),
  );
  const [location, setLocation] = useState(existing?.location || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [busy, setBusy] = useState(false);
  const reminders = REMINDERS.includes(reminder) ? REMINDERS : [...REMINDERS, reminder];

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dav) return;
    const start = allDay ? joinDateTime(startDay, '00:00') : joinDateTime(startDay, startTime);
    const end = allDay ? addDays(joinDateTime(endDay, '00:00'), 1) : joinDateTime(endDay, endTime);
    if (end < start || (!allDay && +end === +start && endDay !== startDay)) return toast(t('cal.error.endBeforeStart'), 'error');
    const fields = {
      title: title.trim(),
      allDay,
      start,
      end,
      location,
      description,
      repeat,
      // an edit that leaves the reminder as it was keeps the event's own reminders as they are
      reminder: existing && reminder === reminder0 ? undefined : reminder,
    };
    setBusy(true);
    try {
      if (existing) await dav.update(existing, fields);
      else await dav.create(calendar, fields);
      if (!existing) prefs.set({ calendar, reminder: allDay ? (prefs.get('reminder') ?? DEFAULT_REMINDER) : reminder }).catch(() => {});
      changed();
      toast(t(existing ? 'cal.saved' : 'cal.created'), 'success');
      onClose();
    } catch (err) {
      setBusy(false);
      if ((err as any)?.code === 'cal.error.changed') changed();
      toast(tErr(err), 'error', 6000);
    }
  };

  return (
    <Modal open wide id="composer" title={existing ? t('cal.editTitle') : t('cal.newTitle')} onClose={onClose}>
      <form className="form cal-form" id="eventForm" onSubmit={submit}>
        <label className="field">
          <span>{t('cal.title')}</span>
          <input
            name="title"
            value={title}
            maxLength={300}
            required
            data-autofocus
            placeholder={t('cal.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>{t('cal.allDay')}</span>
        </label>
        <div className="cal-when">
          <label className="field">
            <span>{t('cal.starts')}</span>
            <span className="cal-dt">
              <input
                type="date"
                name="startDay"
                value={startDay}
                required
                onChange={(e) => {
                  // the end moves with the start, keeping the length
                  const shift = +joinDateTime(e.target.value, '00:00') - +joinDateTime(startDay, '00:00');
                  setStartDay(e.target.value);
                  if (e.target.value) setEndDay(dayKey(new Date(+joinDateTime(endDay, '00:00') + shift)));
                }}
              />
              {allDay ? null : <input type="time" name="startTime" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />}
            </span>
          </label>
          <label className="field">
            <span>{t('cal.ends')}</span>
            <span className="cal-dt">
              <input type="date" name="endDay" value={endDay} min={startDay} required onChange={(e) => setEndDay(e.target.value)} />
              {allDay ? null : <input type="time" name="endTime" value={endTime} required onChange={(e) => setEndTime(e.target.value)} />}
            </span>
          </label>
        </div>
        <div className="cal-two">
          <label className="field">
            <span>{t('cal.repeat')}</span>
            <select name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              {REPEATS.map((r) => (
                <option key={r || 'none'} value={r}>
                  {t(`cal.repeat.${r ? r.toLowerCase() : 'none'}`)}
                </option>
              ))}
              {repeat === 'custom' ? <option value="custom">{t('cal.repeat.custom')}</option> : null}
            </select>
          </label>
          <label className="field">
            <span>{t('cal.reminder')}</span>
            <select
              name="reminder"
              value={reminder === null ? '' : String(reminder)}
              onChange={(e) => setReminder(e.target.value === '' ? null : Number(e.target.value))}
            >
              {reminders.map((m) => (
                <option key={m === null ? 'none' : m} value={m === null ? '' : String(m)}>
                  {reminderText(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {existing ? null : (
          <label className="field">
            <span>{t('cal.calendar')}</span>
            <select name="calendar" value={calendar} onChange={(e) => setCalendar(e.target.value)}>
              {(shown.length ? shown : calendars).map((c) => (
                <option key={c.url} value={c.url}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t('cal.location')}</span>
          <input name="location" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('cal.notes')}</span>
          <textarea name="description" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {existing?.recurrenceId ? <p className="hint">{t('cal.seriesNote')}</p> : null}
        <p className="hint">{t('cal.reminderHint')}</p>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !calendar}>
            {existing ? t('cal.save') : t('cal.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
