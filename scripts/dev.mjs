#!/usr/bin/env node
// The hub with hot reload, for working on a distribution or on the framework.
// Run from the distribution's repository (or the framework's, for its empty hub):
//
//   node node_modules/kiwi-framework/scripts/dev.mjs [port=5173]
//
// Vite serves the React pages and reloads them on every save; this server
// adds what the build would assemble: the library at /shared/ with the
// distribution's config, the merged strings at /locales/, the merged icon
// sprite, the manifest, the distribution's public/ files and its apps under
// /<id>/ (as they are; apps with a build step are left out). The service
// worker is a no-op in development: it would cache what you are editing.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { appRoutes, loadDistribution, manifest, mergedLocales, spriteWith } from './build-site.mjs';
import { distributionFile, framework, siteConfig } from './vite-site.mjs';

const distribution = process.cwd();
const port = Number(process.argv[2] || process.env.PORT || 5173);
const config = await loadDistribution(distribution);
const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(body);
}

function sendFile(res, file) {
  if (!fs.existsSync(file)) return false;
  if (fs.statSync(file).isDirectory()) {
    const index = path.join(file, 'index.html');
    return fs.existsSync(index) ? sendFile(res, index) : false;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Inside `dir`, never above it. */
const within = (dir, rel) => {
  const abs = path.resolve(dir, `.${rel}`);
  return abs === dir || abs.startsWith(dir + path.sep) ? abs : null;
};

// every route an app is served at (its id and its mounts' ids); apps with a build step are left out
const built = (id) => fs.existsSync(path.join(distribution, 'apps', id, 'package.json'));
const apps = new Map([...appRoutes(config)].filter(([, app]) => !built(app)).map(([route, app]) => [route, path.join(distribution, 'apps', app)]));

const assembled = {
  name: 'kiwi-dev-assembled',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      // a worker that caches nothing, so pages that register one keep working while you edit
      if (url === '/sw.js') return send(res, 200, '// development: no service worker caching\n', TYPES['.js']);
      if (url === '/manifest.webmanifest') return send(res, 200, JSON.stringify(manifest(config), null, 2), TYPES['.webmanifest']);
      if (url === '/icons.svg') {
        const extra = path.join(distribution, 'icons.svg');
        const base = fs.readFileSync(path.join(framework, 'hub/icons.svg'), 'utf8');
        return send(res, 200, fs.existsSync(extra) ? spriteWith(base, fs.readFileSync(extra, 'utf8')).sprite : base, TYPES['.svg']);
      }
      const lang = url.match(/^\/locales\/([a-z]{2})\.json$/);
      if (lang) return send(res, 200, JSON.stringify(mergedLocales(distribution)[lang[1]] || {}), TYPES['.json']);
      if (url === '/shared/distribution.js') return sendFile(res, distributionFile(distribution)) || next();
      if (url.startsWith('/shared/')) {
        const file = within(path.join(framework, 'shared'), url.slice('/shared'.length));
        if (file && sendFile(res, file)) return;
      }
      const top = url.split('/')[1];
      if (apps.has(top)) {
        if (url === `/${top}`) {
          res.writeHead(301, { location: `/${top}/` });
          return res.end();
        }
        const file = within(apps.get(top), url.slice(top.length + 1) || '/');
        if (file && sendFile(res, file)) return;
      }
      const pub = within(path.join(distribution, 'public'), url);
      if (pub && url !== '/' && fs.existsSync(pub) && fs.statSync(pub).isFile() && sendFile(res, pub)) return;
      next();
    });
  },
};

const base = siteConfig({ distribution, config, dev: true });
const server = await createServer({ ...base, plugins: [...base.plugins, assembled], server: { ...base.server, port, strictPort: false } });
await server.listen();
server.printUrls();
console.log(`\n${config.name}: the hub with hot reload; apps under /<id>/ (${[...apps.keys()].join(', ') || 'none'}).`);
