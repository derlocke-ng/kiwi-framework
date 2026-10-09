// Service worker for the whole site (scope: the site root). The hub, every
// app without a worker of its own and shared/ are precached so the installed
// app opens offline; other same-site responses are cached as they are
// fetched. Network first, so an update shows up on the next load. An app with
// its own worker (narrower scope) takes precedence for its pages. This file
// is a template: scripts/build-site.mjs fills VERSION and SHELL.
const VERSION = '__VERSION__'; // set by scripts/build-site.mjs from the precached files
const SHELL = __SHELL__; // set by scripts/build-site.mjs

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wjs-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope).pathname;
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(scope)) return;
  // Revalidate with the server (ETag) rather than trusting the browser's HTTP cache: GitHub Pages
  // caches for ten minutes, and a page must never run with a script or catalog from the previous deploy.
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', headers: { accept: req.headers.get('accept') || '*/*' } })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          // A directory URL may be cached under its index.html, and anything else falls back to the hub.
          return (await caches.match(new URL('index.html', req.url).href)) || (await caches.match(new URL('index.html', self.registration.scope).href)) || Response.error();
        }
        return Response.error();
      }),
  );
});
