# calendar

A person's calendars from a CalDAV server: Nextcloud first, and any other that speaks CalDAV (Radicale,
Baïkal, a mail provider's). On a phone it opens on the coming days; a month shows the chosen day's events
below the grid. Events can be made, changed and deleted, repeat daily, weekly, monthly or yearly (a rule set
elsewhere is kept), and carry a reminder, which goes off while a page of the calendar is open on a device.

- **The server holds the calendar.** Nothing of it goes on nostr; the page reads the range it shows
  (`shared/caldav.js`: tsdav and ical.js, vendored in `shared/caldav-lib.mjs`).
- **Where the server is**: a hub's container can forward `/remote.php/dav/` to a Nextcloud beside it
  (`HUB_CALDAV`, `container/entrypoint.sh`), so the page asks its own origin; that address is then offered.
  Any other server must allow the hub's origin (CORS).
- **The login** (server, username, app password) is kept in the app's settings in the account
  (`shared/settings.js`, sealed to the person's key), so each device they sign in on has it.
- **Times** are written in the device's zone, with a VTIMEZONE made from the browser's rules; a whole-day
  event as dates.

Routes: `#/` the view, `#/e/<day>/<occurrence>` one event over it, `#/settings`. Strings: `cal.*` in
`locales/`. Tests: `test/unit/caldav.test.js` (the client against `scripts/caldav-server.mjs`, laid out like
Nextcloud), `test/e2e/calendar.mjs` (the app in a browser).
