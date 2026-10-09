#!/usr/bin/env node
// Assemble a distribution's site from the framework and the distribution's
// own files. Run from the distribution's repository:
//
//   node node_modules/kiwi-framework/scripts/build-site.mjs [out=_site] [--no-legacy]
//
// The hub pages (React, built with Vite), the library (shared/, served as
// plain files for the apps that still import it) and the icon sprite come
// from the framework; distribution.js, the strings in locales/, the apps and
// anything in public/ come from the distribution. The site service worker's
// precache list and version are computed from the result, so every deploy
// busts the cache by itself. `import { assemble }` does the same for tests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { framework, distributionFile, siteConfig } from './vite-site.mjs';

export { framework, distributionFile };
const PRECACHE = /\.(m?js|css|html|svg|webmanifest|png)$/;

function walk(dir, filter) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : walk(abs, filter);
      return filter(abs) ? [abs] : [];
    });
}
const rel = (base, f) => path.relative(base, f).split(path.sep).join('/');

/** The distribution's config, read fresh. */
export async function loadDistribution(root) {
  return (await import(`${pathToFileURL(distributionFile(root)).href}?t=${Date.now()}`)).DISTRIBUTION;
}

/** The web app manifest for a distribution's hub. */
export const manifest = (c) => ({
  id: './',
  name: c.name,
  short_name: c.shortName || c.name,
  description: c.description || '',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0e0f0d',
  theme_color: '#0e0f0d',
  icons: [
    { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

/** The sprite `base` with the symbols of `extra` it lacks appended. */
export function spriteWith(base, extra) {
  const have = new Set([...base.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  const add = [...extra.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)].filter((m) => !have.has(m[1])).map((m) => m[0]);
  return { sprite: add.length ? base.replace('</svg>', `${add.join('\n')}\n</svg>`) : base, added: add.length };
}

/** Symbols of `extra` that `target` lacks are appended to it. */
export function mergeSprite(target, extra) {
  const { sprite, added } = spriteWith(fs.readFileSync(target, 'utf8'), fs.readFileSync(extra, 'utf8'));
  fs.writeFileSync(target, sprite);
  return added;
}

/**
 * One catalog per language for the hub: the framework's shared strings, its
 * hub strings, then the distribution's own on top. Returns { lang: catalog }.
 */
export function mergedLocales(distribution) {
  const dirs = [path.join(framework, 'shared/locales'), path.join(framework, 'hub/locales'), path.join(distribution, 'locales')].filter((d) => fs.existsSync(d));
  const out = {};
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const lang = file.slice(0, -5);
      out[lang] = { ...(out[lang] || {}), ...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) };
    }
  }
  return out;
}

/** The hub's files, every app that has no worker of its own and is not built elsewhere, and shared/. */
export function precacheList(out, config) {
  const skip = new Set(config.apps.filter((a) => a.legacy || fs.existsSync(path.join(out, a.id, 'sw.js'))).map((a) => a.id));
  const take = (f) => PRECACHE.test(f) || /(^|\/)locales\/en\.json$/.test(f);
  const list = ['./'];
  for (const f of walk(out, take)) {
    const r = rel(out, f);
    if (r === 'sw.js' || skip.has(r.split('/')[0])) continue;
    list.push(r);
  }
  for (const a of config.apps) if (!skip.has(a.id) && fs.existsSync(path.join(out, a.id))) list.push(`${a.id}/`);
  return [...new Set(list)].sort();
}

export async function assemble({ distribution = process.cwd(), out = path.join(distribution, '_site'), legacy = true, log = () => {} } = {}) {
  distribution = path.resolve(distribution);
  const config = await loadDistribution(distribution);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // 1. the hub's static files and the manifest, named after the distribution
  for (const f of ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icons.svg']) fs.copyFileSync(path.join(framework, 'hub', f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), `${JSON.stringify(manifest(config), null, 2)}\n`);

  // 2. the library as plain files, with the distribution's config in place of the framework's (for the apps that import /shared/)
  fs.cpSync(path.join(framework, 'shared'), path.join(out, 'shared'), { recursive: true });
  fs.copyFileSync(distributionFile(distribution), path.join(out, 'shared', 'distribution.js'));

  // 3. icons the distribution adds to the sprite
  const extra = path.join(distribution, 'icons.svg');
  if (fs.existsSync(extra)) mergeSprite(path.join(out, 'icons.svg'), extra);

  // 4. strings: one file per language for the hub (shared + hub + the distribution's)
  fs.mkdirSync(path.join(out, 'locales'), { recursive: true });
  for (const [lang, cat] of Object.entries(mergedLocales(distribution))) fs.writeFileSync(path.join(out, 'locales', `${lang}.json`), `${JSON.stringify(cat, null, 2)}\n`);

  // 5. the apps: copied as they are, or built when they have a build step
  for (const app of config.apps) {
    const src = path.join(distribution, 'apps', app.id);
    if (!fs.existsSync(src)) throw new Error(`distribution.js lists the app "${app.id}" but apps/${app.id} is missing`);
    const pkg = path.join(src, 'package.json');
    const builds = fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts?.build;
    if (builds) {
      if (!legacy) {
        log(`skipping ${app.id}: a built app`);
        continue;
      }
      log(`building ${app.id}`);
      execSync('npm ci --no-audit --no-fund && npm run build', { cwd: src, stdio: 'inherit' });
      fs.cpSync(path.join(src, 'dist'), path.join(out, app.id), { recursive: true });
    } else {
      log(`copying ${app.id}`);
      fs.cpSync(src, path.join(out, app.id), { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p) });
    }
  }

  // 6. the distribution's own files over everything: favicon, CNAME, …
  const pub = path.join(distribution, 'public');
  if (fs.existsSync(pub)) fs.cpSync(pub, out, { recursive: true });

  // 7. the hub pages: React, built by Vite into index.html, settings.html and assets/
  log('building the hub');
  await build(siteConfig({ distribution, out, config }));

  // 8. the site service worker: what to precache, versioned by its contents
  const shell = precacheList(out, config);
  const hash = crypto.createHash('sha256');
  for (const f of shell) if (!f.endsWith('/')) hash.update(fs.readFileSync(path.join(out, f)));
  const sw = fs
    .readFileSync(path.join(framework, 'hub/sw.js'), 'utf8')
    .replace('__VERSION__', `${config.id}-${hash.digest('hex').slice(0, 10)}`)
    .replace('__SHELL__', JSON.stringify(shell, null, 2).replace(/"/g, "'"));
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return { out, config, shell };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const legacy = !args.includes('--no-legacy');
  const outArg = args.find((a) => !a.startsWith('--'));
  const { out, shell } = await assemble({ out: outArg ? path.resolve(outArg) : undefined, legacy, log: console.log });
  console.log(`site ready in ${out} (${shell.length} files precached)`);
}
