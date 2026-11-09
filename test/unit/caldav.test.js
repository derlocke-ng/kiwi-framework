// The calendar's CalDAV client (shared/caldav.js) against the test server laid out like Nextcloud
// (scripts/caldav-server.mjs): finding the calendars, events written in the device's zone with a VTIMEZONE
// the browser's rules make, a weekly event that keeps its wall clock across daylight saving time, whole-day
// events, a series with one occurrence moved and one taken out, edits that keep what the calendar does not
// show, and the refusals (a stale ETag, a wrong password, a read-only calendar) in words.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { CalDav, occurrences, serverCandidates, vtimezone, withoutOccurrence, writeEvent } from '../../shared/caldav.js';
import { startCalDav } from '../../scripts/caldav-server.mjs';

const dav = await startCalDav({
  users: { alice: 'app-password' },
  calendars: [
    { id: 'personal', name: 'Personal', color: '#0082c9' },
    { id: 'holidays', name: 'Holidays', readOnly: true },
  ],
});
after(() => dav.close());

const object = (data, url = 'http://x/remote.php/dav/calendars/alice/personal/e.ics') => ({ url, etag: null, data, calendar: 'http://x/remote.php/dav/calendars/alice/personal/' });
const range = (a, b) => [new Date(a), new Date(b)];
const iso = (list) => list.map((o) => o.start.toISOString());

test('where CalDAV may be: the address as given, then Nextcloud’s path below it', () => {
  assert.deepEqual(serverCandidates('https://cloud.example.org'), ['https://cloud.example.org/', 'https://cloud.example.org/remote.php/dav/']);
  assert.deepEqual(serverCandidates('https://example.org/nextcloud'), ['https://example.org/nextcloud', 'https://example.org/nextcloud/remote.php/dav/']);
  assert.deepEqual(serverCandidates('/remote.php/dav/', 'https://hub.example.org/calendar/'), ['https://hub.example.org/remote.php/dav/']);
  assert.deepEqual(serverCandidates('ftp://x'), []);
});

test('a VTIMEZONE from the browser’s rules: the last Sundays in Europe, the second and first in America, none in India, the south turned round', () => {
  const berlin = vtimezone('Europe/Berlin', 2026);
  assert.match(berlin, /BEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0200/);
  assert.match(berlin, /BEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100/);
  const ny = vtimezone('America/New_York', 2026);
  assert.match(ny, /BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400/);
  assert.match(ny, /BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500/);
  assert.match(vtimezone('Asia/Kolkata', 2026), /BEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:\+0530\r\nTZOFFSETTO:\+0530/);
  const sydney = vtimezone('Australia/Sydney', 2026);
  assert.match(sydney, /BEGIN:DAYLIGHT\r\nDTSTART:\d{8}T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU\r\nTZOFFSETFROM:\+1000\r\nTZOFFSETTO:\+1100/);
  assert.match(sydney, /BEGIN:STANDARD\r\nDTSTART:\d{8}T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU\r\nTZOFFSETFROM:\+1100\r\nTZOFFSETTO:\+1000/);
});

test('a weekly event in Berlin keeps 9:00 across the change to summer time', () => {
  const start = new Date('2027-03-22T08:00:00Z'); // Monday 9:00 in Berlin, winter time
  const data = writeEvent({ title: 'Standup', allDay: false, start, end: new Date(+start + 15 * 60000), repeat: 'WEEKLY', reminder: 10 }, null, { timeZone: 'Europe/Berlin' });
  assert.match(data, /DTSTART;TZID=Europe\/Berlin:20270322T090000/);
  assert.match(data, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Berlin/);
  assert.match(data, /RRULE:FREQ=WEEKLY/);
  assert.match(data, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Standup\r\nTRIGGER:-PT10M/);
  const list = occurrences(object(data), ...range('2027-03-20T00:00:00Z', '2027-04-06T00:00:00Z'));
  assert.deepEqual(iso(list), ['2027-03-22T08:00:00.000Z', '2027-03-29T07:00:00.000Z', '2027-04-05T07:00:00.000Z'], 'one hour earlier in UTC once summer time starts');
  assert.deepEqual(list[0].reminders, [10]);
  assert.equal(list[0].repeat, 'WEEKLY');
  assert.equal(list[1].recurrenceId, '2027-03-29T09:00:00');
});

test('a whole-day event is dates: from local midnight to the midnight after its last day', () => {
  const data = writeEvent({ title: 'Fair', allDay: true, start: new Date(2026, 10, 12), end: new Date(2026, 10, 14) }, null);
  assert.match(data, /DTSTART;VALUE=DATE:20261112/);
  assert.match(data, /DTEND;VALUE=DATE:20261114/);
  const [o] = occurrences(object(data), new Date(2026, 10, 1), new Date(2026, 11, 1));
  assert.equal(o.allDay, true);
  assert.equal(+o.start, +new Date(2026, 10, 12));
  assert.equal(+o.end, +new Date(2026, 10, 14));
  assert.equal(occurrences(object(data), new Date(2026, 10, 14), new Date(2026, 10, 20)).length, 0, 'not on the day after');
});

test('a zone named without a VTIMEZONE is read with the browser’s rules', () => {
  const data = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:g', 'DTSTART;TZID=America/New_York:20260704T120000', 'DTEND;TZID=America/New_York:20260704T130000', 'SUMMARY:Picnic', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const [o] = occurrences(object(data), ...range('2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z'));
  assert.equal(o.start.toISOString(), '2026-07-04T16:00:00.000Z');
  assert.equal(o.title, 'Picnic');
});

test('a series with one occurrence moved and one taken out; editing keeps what the calendar does not show', () => {
  const data = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nextcloud//EN',
    'BEGIN:VEVENT',
    'UID:s',
    'DTSTART:20261102T100000Z',
    'DTEND:20261102T110000Z',
    'RRULE:FREQ=DAILY;COUNT=5',
    'EXDATE:20261104T100000Z',
    'SUMMARY:Shift',
    'ATTENDEE;CN=Bea:mailto:bea@example.org',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:s',
    'RECURRENCE-ID:20261103T100000Z',
    'DTSTART:20261103T140000Z',
    'DTEND:20261103T150000Z',
    'SUMMARY:Shift (late)',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const list = occurrences(object(data), ...range('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'));
  assert.deepEqual(iso(list), ['2026-11-02T10:00:00.000Z', '2026-11-03T14:00:00.000Z', '2026-11-05T10:00:00.000Z', '2026-11-06T10:00:00.000Z']);
  assert.equal(list[1].title, 'Shift (late)', 'the moved one as moved');
  assert.deepEqual(list[1].reminders, [30], 'with the series’ reminder');
  assert.equal(list[0].repeat, 'custom', 'a rule the composer does not offer is kept');
  // taking one out
  const fewer = occurrences(object(withoutOccurrence(data, list[2].recurrenceId)), ...range('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'));
  assert.deepEqual(iso(fewer), ['2026-11-02T10:00:00.000Z', '2026-11-03T14:00:00.000Z', '2026-11-06T10:00:00.000Z']);
  // a new title, nothing else: the attendee, the rule, the reminder and the moved occurrence stay
  const renamed = writeEvent({ title: 'Early shift', allDay: false, start: list[0].seriesStart, end: list[0].seriesEnd, repeat: 'custom' }, data);
  assert.match(renamed, /ATTENDEE;CN=Bea:mailto:bea@example.org/);
  assert.match(renamed, /RRULE:FREQ=DAILY;COUNT=5/);
  assert.match(renamed, /TRIGGER:-PT30M/);
  assert.match(renamed, /RECURRENCE-ID:20261103T100000Z/);
  assert.match(renamed, /SEQUENCE:1/);
  // moved by an hour: the moved occurrence and the removed one no longer fit, and go
  const moved = writeEvent({ title: 'Early shift', allDay: false, start: new Date('2026-11-02T09:00:00Z'), end: new Date('2026-11-02T10:00:00Z'), repeat: 'custom' }, data, { timeZone: null });
  assert.doesNotMatch(moved, /RECURRENCE-ID|EXDATE/);
  assert.equal(occurrences(object(moved), ...range('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z')).length, 5);
});

test('the server: calendars found, an event made, read back as occurrences, one taken out, renamed, deleted', async () => {
  const cal = new CalDav({ server: dav.url, username: 'alice', password: 'app-password', fetch: (u, i) => fetch(u, i) });
  const calendars = await cal.connect();
  assert.deepEqual(
    calendars.map((c) => [c.name, c.color]),
    [
      ['Personal', '#0082c9'],
      ['Holidays', ''],
    ],
  );
  const personal = calendars[0];
  const start = new Date('2026-11-10T09:00:00Z');
  await cal.create(personal.url, { title: 'Review', allDay: false, start, end: new Date(+start + 3600_000), repeat: 'DAILY', reminder: 15, location: 'Room 2' });
  const [from, to] = range('2026-11-10T00:00:00Z', '2026-11-13T00:00:00Z');
  const list = await cal.range(calendars, from, to);
  assert.equal(list.length, 3);
  assert.equal(list[0].location, 'Room 2');
  await cal.skip(list[1], list[1].recurrenceId);
  const after = await cal.range(calendars, from, to);
  assert.equal(after.length, 2);
  await assert.rejects(cal.update(list[0], { ...list[0], title: 'stale' }), (err) => err.code === 'cal.error.changed', 'an edit over an older version is refused');
  await cal.update(after[0], { title: 'Review (all)', allDay: false, start: after[0].seriesStart, end: after[0].seriesEnd, repeat: 'DAILY' });
  assert.deepEqual(
    (await cal.range(calendars, from, to)).map((o) => o.title),
    ['Review (all)', 'Review (all)'],
  );
  await assert.rejects(cal.create(calendars[1].url, { title: 'x', allDay: true, start: new Date(2026, 10, 1), end: new Date(2026, 10, 2) }), (err) => err.code === 'cal.error.readOnly');
  await cal.remove((await cal.range(calendars, from, to))[0]);
  assert.equal((await cal.range(calendars, from, to)).length, 0);
});

test('a wrong password and an address without CalDAV are said as such', async () => {
  await assert.rejects(new CalDav({ server: dav.url, username: 'alice', password: 'nope', fetch: (u, i) => fetch(u, i) }).connect(), (err) => err.code === 'cal.error.auth');
  // a web server without CalDAV (the well-known address would lead to it from any path of a real one)
  const web = http.createServer((req, res) => res.writeHead(404).end('not here'));
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  await assert.rejects(new CalDav({ server: `http://127.0.0.1:${web.address().port}/`, username: 'alice', password: 'app-password', fetch: (u, i) => fetch(u, i) }).connect(), (err) => err.code === 'cal.error.notFound');
  web.close();
  await assert.rejects(new CalDav({ server: 'http://127.0.0.1:1/', username: 'a', password: 'b', fetch: (u, i) => fetch(u, i) }).connect(), (err) => err.code === 'cal.error.reach');
});
