// A CalDAV server for development and tests, laid out and answering like
// Nextcloud's (sabre/dav): /.well-known/caldav redirects to /remote.php/dav/,
// the principal and the calendar home below it, PROPFIND for the calendars,
// REPORT calendar-query and calendar-multiget, PUT with If-Match and
// If-None-Match, DELETE, Basic auth. Objects are kept in memory. `cors` answers
// the preflight and names the asking origin, as the nginx in front of kiwi's
// Nextcloud does for the fleet's hubs, so a hub on another origin can use it.
// Every object of a calendar is returned for a calendar-query (the client must
// not count on the server's time-range filter, and Nextcloud's includes every
// series that has an occurrence in range anyway).
//
//   const dav = await startCalDav({ users: { alice: 'app-password' } });  // dav.url, dav.objects, dav.close()
//   node scripts/caldav-server.mjs [port]
import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const ROOT = '/remote.php/dav/';
const NS =
  'xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns" xmlns:x1="http://apple.com/ns/ical/"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {{ port?: number, users?: Record<string, string>, calendars?: { id: string, name: string, color?: string, readOnly?: boolean }[], cors?: boolean }} [options]
 */
export function startCalDav({ port = 0, users = { alice: 'app-password' }, calendars = [{ id: 'personal', name: 'Personal', color: '#0082c9' }], cors = true } = {}) {
  /** path → { data, etag } */
  const objects = new Map();
  const ctags = new Map(); // calendar path → a number that changes with every write
  const log = [];
  const calPath = (user, id) => `${ROOT}calendars/${user}/${id}/`;
  const touch = (path) => ctags.set(path, (ctags.get(path) || 0) + 1);

  const corsHeaders = (req) =>
    cors
      ? {
          'Access-Control-Allow-Origin': req.headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, PROPFIND, REPORT, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match, Prefer',
          'Access-Control-Expose-Headers': 'ETag, DAV, Location',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : {};
  const send = (req, res, status, body = '', headers = {}) => {
    res.writeHead(status, { ...corsHeaders(req), ...headers });
    res.end(body);
  };
  const multistatus = (req, res, responses) =>
    send(req, res, 207, `<?xml version="1.0"?>\n<d:multistatus ${NS}>${responses.join('')}</d:multistatus>`, { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1, 3, calendar-access' });

  /** One resource's answer: the props asked for that it has (200), the others (404). */
  const response = (href, have, asked) => {
    const found = [];
    const missing = [];
    for (const name of asked.length ? asked : Object.keys(have)) {
      if (have[name] !== undefined) found.push(have[name]);
      else missing.push(`<d:${name}/>`);
    }
    return (
      `<d:response><d:href>${esc(href)}</d:href>` +
      (found.length ? `<d:propstat><d:prop>${found.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` : '') +
      (missing.length ? `<d:propstat><d:prop>${missing.join('')}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>` : '') +
      '</d:response>'
    );
  };
  const asked = (body) => {
    const prop = /<(?:\w+:)?prop\b[^>]*>([\s\S]*?)<\/(?:\w+:)?prop>/.exec(body);
    return prop ? [...prop[1].matchAll(/<(?:\w+:)?([a-zA-Z-]+)[\s/>]/g)].map((m) => m[1]).filter((n) => n !== 'prop' && n !== 'expand') : [];
  };

  const calendarProps = (user, c) => {
    const path = calPath(user, c.id);
    return {
      resourcetype: '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>',
      displayname: `<d:displayname>${esc(c.name)}</d:displayname>`,
      'calendar-color': c.color ? `<x1:calendar-color>${esc(c.color)}ff</x1:calendar-color>` : undefined,
      'supported-calendar-component-set': '<cal:supported-calendar-component-set><cal:comp name="VEVENT"/><cal:comp name="VTODO"/></cal:supported-calendar-component-set>',
      getctag: `<cs:getctag>${ctags.get(path) || 0}</cs:getctag>`,
      'sync-token': `<d:sync-token>http://sabre.io/ns/sync/${ctags.get(path) || 0}</d:sync-token>`,
      'calendar-description': '<cal:calendar-description/>',
      'calendar-timezone': undefined,
    };
  };
  const objectProps = (path, o, withData) => ({
    getetag: `<d:getetag>${esc(o.etag)}</d:getetag>`,
    'calendar-data': withData ? `<cal:calendar-data>${esc(o.data)}</cal:calendar-data>` : undefined,
    getcontenttype: '<d:getcontenttype>text/calendar; charset=utf-8; component=vevent</d:getcontenttype>',
    resourcetype: '<d:resourcetype/>',
  });

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname);
      log.push(`${req.method} ${path}`);
      if (req.method === 'OPTIONS') return send(req, res, cors ? 204 : 405, '', { DAV: '1, 3, calendar-access', Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT' });
      if (path === '/.well-known/caldav') return send(req, res, 301, '', { Location: ROOT });
      if (!path.startsWith(ROOT)) return send(req, res, 404, 'Not found');
      // Basic auth, as Nextcloud takes an app password
      const [scheme, token] = String(req.headers.authorization || '').split(' ');
      const [user, ...rest] = scheme === 'Basic' && token ? Buffer.from(token, 'base64').toString('utf8').split(':') : [];
      if (!user || users[user] === undefined || users[user] !== rest.join(':'))
        return send(req, res, 401, '<?xml version="1.0"?><d:error xmlns:d="DAV:"><s:message xmlns:s="http://sabredav.org/ns">No public access to this resource.</s:message></d:error>', {
          'WWW-Authenticate': 'Basic realm="Nextcloud", charset="UTF-8"',
          'Content-Type': 'application/xml; charset=utf-8',
        });
      const principal = `${ROOT}principals/users/${user}/`;
      const home = `${ROOT}calendars/${user}/`;
      const depth = String(req.headers.depth ?? '1');
      const props = asked(body);
      const own = calendars.map((c) => ({ ...c, path: calPath(user, c.id) }));
      const cal = own.find((c) => path === c.path || path.startsWith(c.path));

      if (req.method === 'PROPFIND') {
        if (path === ROOT || path === principal || path === `${ROOT}principals/`) {
          const have = {
            'current-user-principal': `<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`,
            'calendar-home-set': path === principal ? `<cal:calendar-home-set><d:href>${home}</d:href></cal:calendar-home-set>` : undefined,
            resourcetype: path === principal ? '<d:resourcetype><d:principal/></d:resourcetype>' : '<d:resourcetype><d:collection/></d:resourcetype>',
            displayname: path === principal ? `<d:displayname>${esc(user)}</d:displayname>` : undefined,
          };
          return multistatus(req, res, [response(path, have, props)]);
        }
        if (path === home) {
          const out = [response(home, { resourcetype: '<d:resourcetype><d:collection/></d:resourcetype>' }, props)];
          if (depth !== '0') for (const c of own) out.push(response(c.path, calendarProps(user, c), props));
          return multistatus(req, res, out);
        }
        if (cal && path === cal.path) {
          const out = [response(cal.path, calendarProps(user, cal), props)];
          if (depth !== '0') for (const [p, o] of objects) if (p.startsWith(cal.path)) out.push(response(p, objectProps(p, o, false), props));
          return multistatus(req, res, out);
        }
        const o = objects.get(path);
        return o ? multistatus(req, res, [response(path, objectProps(path, o, false), props)]) : send(req, res, 404, 'Not found');
      }

      if (req.method === 'REPORT' && cal && path === cal.path) {
        const withData = props.includes('calendar-data');
        if (/calendar-multiget/.test(body)) {
          const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g)].map((m) => decodeURIComponent(new URL(m[1].trim(), 'http://x').pathname));
          return multistatus(
            req,
            res,
            hrefs.map((h) => (objects.has(h) ? response(h, objectProps(h, objects.get(h), withData), props) : `<d:response><d:href>${esc(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`)),
          );
        }
        if (/calendar-query/.test(body)) {
          const out = [];
          for (const [p, o] of objects) if (p.startsWith(cal.path)) out.push(response(p, objectProps(p, o, withData), props));
          return multistatus(req, res, out);
        }
        return send(req, res, 415, 'Unsupported report');
      }

      if (!cal || path === cal.path) return send(req, res, 405, 'Method not allowed');
      const existing = objects.get(path);
      if (req.method === 'GET') return existing ? send(req, res, 200, existing.data, { 'Content-Type': 'text/calendar; charset=utf-8', ETag: existing.etag }) : send(req, res, 404, 'Not found');
      if (req.method === 'PUT') {
        if (cal.readOnly) return send(req, res, 403, 'Forbidden');
        if (req.headers['if-none-match'] === '*' && existing) return send(req, res, 412, 'Precondition failed');
        if (req.headers['if-match'] && req.headers['if-match'] !== existing?.etag) return send(req, res, 412, 'Precondition failed');
        if (!/BEGIN:VCALENDAR/.test(body) || !/BEGIN:VEVENT|BEGIN:VTODO/.test(body)) return send(req, res, 415, 'Not a calendar object');
        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
        objects.set(path, { data: body, etag });
        touch(cal.path);
        return send(req, res, existing ? 204 : 201, '', { ETag: etag });
      }
      if (req.method === 'DELETE') {
        if (cal.readOnly) return send(req, res, 403, 'Forbidden');
        if (!existing) return send(req, res, 404, 'Not found');
        if (req.headers['if-match'] && req.headers['if-match'] !== existing.etag) return send(req, res, 412, 'Precondition failed');
        objects.delete(path);
        touch(cal.path);
        return send(req, res, 204);
      }
      return send(req, res, 405, 'Method not allowed');
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        url: `http://localhost:${actual}`,
        port: actual,
        root: ROOT,
        objects,
        log,
        /** An object put straight into a calendar, as another device would. */
        put(user, calendar, name, data) {
          const p = `${calPath(user, calendar)}${name}`;
          objects.set(p, { data, etag: `"${crypto.createHash('md5').update(data).digest('hex')}"` });
          touch(calPath(user, calendar));
          return p;
        },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dav = await startCalDav({ port: Number(process.argv[2]) || 5232 });
  console.log(`CalDAV on ${dav.url}${ROOT} (user alice, password app-password)`);
}
