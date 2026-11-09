// Entry for the vendored calendar bundle (shared/caldav-lib.mjs): tsdav for
// CalDAV, ical.js for iCalendar. Only what shared/caldav.js uses, bundled by
// `npm run vendor` with esbuild; only the calendar app loads it.
export { createAccount, fetchCalendars, fetchCalendarObjects, createCalendarObject, updateCalendarObject, deleteCalendarObject, getBasicAuthHeaders } from 'tsdav';
export { default as ICAL } from 'ical.js';
