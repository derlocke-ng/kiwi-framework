// The calendar app against a CalDAV server laid out like Nextcloud (scripts/caldav-server.mjs) on another
// origin, answering CORS as kiwi's Nextcloud does for the fleet's hubs: connecting (a wrong password said as
// such), an event made with a reminder and read back from the server, one made elsewhere showing up, an edit,
// a weekly event in the month with one occurrence taken out, a reminder going off while the page is open,
// the login following the key to another device, a calendar hidden. Exported for a distribution's own run
// (Armory's calendar mount).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startCalDav } from '../../scripts/caldav-server.mjs';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { device, run, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const ics = (uid, summary, start, end) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextcloud//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
/** A UTC iCalendar time `days` from today at `hour`:00 UTC. */
const utc = (days, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10).replace(/-/g, '')}T${String(hour).padStart(2, '0')}0000Z`;
};

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, dav: any, offered?: string }} where  app: the calendar mount; dav: the CalDAV server
 *   (startCalDav); offered: the address the hub offers, when it names one
 */
export async function calendarSuite(env, { app, dav, offered = '' }) {
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const sk = bytesToHex(generateSecretKey());
  const identity = { sk, pk: getPublicKey(hexToBytes(sk)), alias: null, created: Date.now() };
  const dev = (name) => device(env, name, init, { relay: env.nostrUrl, identity });
  const server = `${dav.url}/`;
  const objects = () => [...dav.objects.values()].map((o) => o.data);
  const agendaTitles = (page) => texts(page, '#agenda .cal-event b');
  /** Today's and tomorrow's date and a time, as the page's own clock and zone have them. */
  const local = (page, minutes) =>
    page.evaluate((m) => {
      const d = new Date(Date.now() + m * 60_000);
      const p = (n) => String(n).padStart(2, '0');
      return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
    }, minutes);
  const compose = async (page, { title, day, start, end, endDay = day, reminder = null, repeat = null, location = '' }) => {
    await page.click('#newEvent');
    await page.waitForSelector('#eventForm');
    await page.fill('#eventForm [name=title]', title);
    await page.fill('#eventForm [name=startDay]', day);
    await page.fill('#eventForm [name=startTime]', start);
    await page.fill('#eventForm [name=endDay]', endDay);
    await page.fill('#eventForm [name=endTime]', end);
    if (reminder !== null) await page.selectOption('#eventForm [name=reminder]', reminder);
    if (repeat) await page.selectOption('#eventForm [name=repeat]', repeat);
    if (location) await page.fill('#eventForm [name=location]', location);
    await page.click('#eventForm [type=submit]');
    await page.waitForSelector('#eventForm', { state: 'detached', timeout: 15000 });
  };

  step('the first visit asks where the calendar is; a wrong password is said as such');
  const A = await dev('A');
  await A.goto(app);
  await A.waitForSelector('#loginForm');
  if (offered) assert.equal(await A.inputValue('#loginForm [name=server]'), offered, 'the hub’s own server is offered');
  await A.fill('#loginForm [name=server]', server);
  await A.fill('#loginForm [name=username]', 'alice');
  await A.fill('#loginForm [name=password]', 'wrong');
  await A.click('#connectBtn');
  await A.waitForSelector('#loginError', { timeout: 15000 });
  assert.match(await A.textContent('#loginError'), /app password|App-Passwort|Nextcloud/i);
  await A.fill('#loginForm [name=password]', 'app-password');
  await A.click('#connectBtn');
  await A.waitForSelector('#agenda', { timeout: 15000 });
  await A.waitForSelector('#agendaEmpty');

  step('an event made here is on the server, with its reminder and the device’s zone, and in the list');
  const tomorrow = await local(A, 24 * 60);
  await compose(A, { title: 'Dentist', day: tomorrow.day, start: '10:00', end: '11:00', reminder: '30', location: 'Main street 1' });
  await until(async () => (await agendaTitles(A)).includes('Dentist'), 'the event in the list', 15000);
  const made = objects().find((d) => d.includes('SUMMARY:Dentist'));
  assert.ok(made, 'the event is on the server');
  assert.match(made, /TRIGGER:-PT30M/, 'with its reminder');
  assert.match(made, /LOCATION:Main street 1/);
  assert.match(made, /DTSTART(;TZID=[^:]+)?:\d{8}T100000/, 'at ten, the device’s wall clock');

  step('an event made elsewhere (Nextcloud, a phone) shows up when the page comes back');
  dav.put('alice', 'personal', 'lunch.ics', ics('lunch', 'Team lunch', utc(2, 11), utc(2, 12)));
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await until(async () => (await agendaTitles(A)).includes('Team lunch'), 'the other event in the list', 15000);

  step('an event opens over the list; an edit goes to the server');
  await A.click('.cal-event[data-event="Dentist"]');
  await A.waitForSelector('#eventDetail');
  assert.equal(await A.textContent('#eventTitle'), 'Dentist');
  assert.equal(await A.textContent('#eventWhere'), 'Main street 1');
  await A.click('#eventDetail [data-act=edit]');
  await A.waitForSelector('#eventForm');
  await A.fill('#eventForm [name=title]', 'Dentist (check-up)');
  await A.click('#eventForm [type=submit]');
  await A.waitForSelector('#eventForm', { state: 'detached', timeout: 15000 });
  await until(async () => (await A.textContent('#eventTitle').catch(() => '')) === 'Dentist (check-up)', 'the panel shows the edit', 15000);
  assert.ok(
    objects().some((d) => d.includes('SUMMARY:Dentist (check-up)') && d.includes('TRIGGER:-PT30M')),
    'the server has the new title, the reminder kept',
  );
  await A.click('#panel [data-act=panel-back]');
  await A.waitForSelector('#panel', { state: 'detached' });

  step('a weekly event fills the month; one occurrence is taken out, the others stay');
  const today = await local(A, 0);
  await compose(A, { title: 'Standup', day: today.day, start: '08:00', end: '08:15', repeat: 'WEEKLY' });
  await A.check('input[name=view][value=month]', { force: true });
  await A.waitForSelector('#month');
  const standups = async () => (await A.$$eval('.cal-cell', (cells) => cells.filter((c) => !c.classList.contains('out') && c.querySelectorAll('.cal-dots i').length).length));
  await until(async () => (await A.$$('#dayList .cal-event[data-event="Standup"]')).length === 1, 'today’s standup below the month', 15000);
  await A.click(`.cal-cell[data-day="${today.day}"]`);
  await A.click('#dayList .cal-event[data-event="Standup"]');
  await A.waitForSelector('#eventDetail');
  assert.ok(await A.$('#eventRepeat'), 'it says it repeats');
  await A.click('#eventDetail [data-act=delete]');
  await A.click('[data-act=delete-one]');
  await A.waitForSelector('#panel', { state: 'detached', timeout: 15000 });
  await until(async () => objects().some((d) => d.includes('SUMMARY:Standup') && d.includes('EXDATE')), 'the occurrence taken out on the server', 15000);
  await until(async () => (await A.$$('#dayList .cal-event[data-event="Standup"]')).length === 0, 'not today any more', 15000);
  const next = await A.evaluate((day) => {
    const [y, m, d] = day.split('-').map(Number);
    const n = new Date(y, m - 1, d + 7);
    const p = (x) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  }, today.day);
  if (await A.$(`.cal-cell[data-day="${next}"]`)) {
    await A.click(`.cal-cell[data-day="${next}"]`);
    await until(async () => (await A.$$('#dayList .cal-event[data-event="Standup"]')).length === 1, 'next week’s standup still there', 15000);
  }
  assert.ok((await standups()) >= 1, 'the month shows the days that have something');
  await A.check('input[name=view][value=agenda]', { force: true });

  step('a reminder goes off while the page is open (one due a minute ago, as when the page was closed then)');
  const soon = await local(A, 4);
  const end = await local(A, 34);
  await compose(A, { title: 'Call the bank', day: soon.day, start: soon.time, end: end.time, endDay: end.day, reminder: '5' });
  await until(async () => (await texts(A, '.toast')).some((x) => x.includes('Call the bank')), 'the reminder shows', 20000);

  step('the login follows the key: another device has the calendar without asking');
  const B = await dev('B');
  await B.goto(app);
  await B.waitForSelector('#agenda', { timeout: 20000 });
  await until(async () => (await agendaTitles(B)).includes('Dentist (check-up)'), 'the events on the other device', 15000);

  step('a hidden calendar’s events leave the view; the calendar stays on the server');
  await B.goto(`${app}#/settings`);
  await B.waitForSelector('#calendarsCard');
  await B.uncheck('[data-calendar="Personal"]');
  await B.goto(`${app}#/`);
  await B.waitForSelector('#agenda');
  await until(async () => !(await agendaTitles(B)).includes('Dentist (check-up)'), 'hidden', 15000);
  assert.ok(objects().some((d) => d.includes('Dentist (check-up)')), 'still on the server');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const dav = await startCalDav({
    users: { alice: 'app-password' },
    calendars: [
      { id: 'personal', name: 'Personal', color: '#0082c9' },
      { id: 'work', name: 'Work', color: '#e9322d' },
    ],
  });
  const site = await testHub([{ app: 'calendar', name: 'Calendar', icon: 'calendar-days' }], { id: 'calendar-hub', name: 'Calendar hub', caldav: `${dav.url}/` });
  await run('calendar', (env) => calendarSuite(env, { app: `${env.base}calendar/`, dav, offered: `${dav.url}/` }), { webRoot: site }).finally(() => dav.close());
}
