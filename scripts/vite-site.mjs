// The Vite configuration for a hub: the framework's hub pages (React) built
// for one distribution, and the framework's own apps (apps/<name>, React)
// built for the routes a distribution mounts them at. Used by build-site.mjs
// (production) and dev.mjs (development). Plain JavaScript so a
// distribution's build needs no TypeScript step to load it.

import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export const framework = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const hub = path.join(framework, 'hub');
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** distribution.js in a distribution's repository, or the framework's own empty one. */
export function distributionFile(root) {
  const file = path.join(root, 'distribution.js');
  if (fs.existsSync(file)) return file;
  if (path.resolve(root) === framework) return path.join(framework, 'shared', 'distribution.js');
  throw new Error(`no distribution.js in ${root}: is this a distribution's repository?`);
}

/**
 * Swap the framework's shared/distribution.js for the distribution's, and fill
 * the {{name}} placeholders in the pages. In development the pages' strict
 * content security policy is dropped: Vite's client and React's refresh need
 * an inline script there; production builds have none.
 */
function kiwiDistribution(config, distribution, { dev = false } = {}) {
  const distFile = distributionFile(distribution);
  const own = path.join(framework, 'shared', 'distribution.js');
  return {
    name: 'kiwi-distribution',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const abs = path.resolve(path.dirname(importer.split('?')[0]), source);
      return abs === own ? distFile : null;
    },
    transformIndexHtml(html) {
      let out = html
        .replaceAll('{{name}}', esc(config.name))
        .replaceAll('{{description}}', esc(config.description))
        .replaceAll('{{repo}}', esc(config.repo || config.homepage || './'))
        .replaceAll('{{homepage}}', esc(config.homepage || './'));
      if (dev) out = out.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
      return out;
    },
  };
}

/**
 * @param {{ distribution: string, out?: string, config: object, dev?: boolean, gallery?: boolean }} o
 *   distribution: the distribution's root; config: its DISTRIBUTION; out: where the build goes;
 *   gallery: also build widgets.html, the widget gallery (tests; never in a deployed site)
 */
export function siteConfig({ distribution, out = path.join(distribution, '_site'), config, dev = false, gallery = false }) {
  return {
    configFile: false,
    envFile: false,
    root: hub,
    base: './',
    mode: dev ? 'development' : 'production',
    publicDir: false,
    cacheDir: path.join(distribution, 'node_modules', '.vite-kiwi'),
    logLevel: 'warn',
    plugins: [react(), kiwiDistribution(config, distribution, { dev })],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { fs: { allow: [framework, distribution] } },
    build: {
      outDir: out,
      emptyOutDir: false,
      target: 'es2022',
      modulePreload: { polyfill: false },
      sourcemap: false,
      rollupOptions: {
        input: {
          index: path.join(hub, 'index.html'),
          settings: path.join(hub, 'settings.html'),
          ...(gallery ? { widgets: path.join(hub, 'widgets.html') } : {}),
        },
      },
    },
  };
}

/** The framework's own apps: folders under apps/ with an index.html. */
export const frameworkApps = () =>
  fs.existsSync(path.join(framework, 'apps'))
    ? fs.readdirSync(path.join(framework, 'apps')).filter((d) => fs.existsSync(path.join(framework, 'apps', d, 'index.html')))
    : [];

/**
 * One of the framework's apps (apps/<app>) built for a distribution, into
 * `out` (the route it is mounted at). Assets are relative, so the same build
 * serves at every route the app is mounted at.
 * @param {{ distribution: string, config: object, app: string, out: string, dev?: boolean }} o
 */
export function appConfig({ distribution, config, app, out, dev = false }) {
  const root = path.join(framework, 'apps', app);
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`the framework has no app "${app}" (apps/${app}/index.html)`);
  return {
    configFile: false,
    envFile: false,
    root,
    base: './',
    mode: dev ? 'development' : 'production',
    publicDir: path.join(root, 'public'),
    cacheDir: path.join(distribution, 'node_modules', '.vite-kiwi'),
    logLevel: 'warn',
    plugins: [react(), kiwiDistribution(config, distribution, { dev })],
    resolve: { dedupe: ['react', 'react-dom'] },
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: { polyfill: false },
      sourcemap: false,
      // one bundle for an app that is cached for offline use: React, the nostr tools, markdown
      chunkSizeWarningLimit: 800,
      rollupOptions: { input: { index: path.join(root, 'index.html') } },
    },
  };
}
