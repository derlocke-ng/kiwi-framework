// Shared setup for the end-to-end tests: a local nostr relay (in-process), a
// local gun relay (Payload and pong, until they move to nostr), two local
// Blossom servers (one takes any file, one only images, like some public
// ones), a static server for apps/, and Chromium.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { WebSocket } from 'ws';
import { startBlossom } from '../../scripts/blossom-server.mjs';
import { startRelay } from '../../scripts/nostr-relay.mjs';
import { assemble } from '../../scripts/build-site.mjs';

useWebSocketImplementation(WebSocket);

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${last})`);
}

export async function setup(name, { webRoot = path.join(root, 'apps') } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-e2e-`));
  const gunPort = 20000 + Math.floor(Math.random() * 20000);
  const webPort = gunPort + 1;
  const nostrPort = gunPort + 2;
  let runs = 0;
  const startGun = () =>
    spawn(process.execPath, [path.join(root, 'scripts/relay.cjs'), String(gunPort)], { env: { ...process.env, RADATA: path.join(tmp, `radata-${runs++}`) }, stdio: 'ignore' });
  let gun = startGun();
  let nostrRuns = 0;
  const startNostr = () => startRelay({ port: nostrPort, dir: path.join(tmp, `nostr-${nostrRuns++}`), name: 'e2e relay' });
  let nostr = await startNostr();
  const blossom = await startBlossom();
  const blossomStrict = await startBlossom({ accept: (type) => type.startsWith('image/') || 'only images here' });
  const web = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), webRoot, String(webPort)], { stdio: 'ignore' });
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  // mDNS-obfuscated ICE candidates don't resolve in containers; real browsers are fine.
  // A UTF-8 locale keeps non-ASCII download names (minimal containers default to C).
  const browser = await chromium.launch({ executablePath, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'], env: { ...process.env, LANG: 'C.UTF-8' } });
  const env = {
    tmp,
    relayUrl: `http://localhost:${gunPort}/gun`,
    nostrUrl: nostr.url,
    /** media servers: blobs are in .blobs (sha256 → { data, type, owner }) */
    blossom,
    blossomStrict,
    base: `http://localhost:${webPort}/`,
    browser,
    errors: [],
    /** The gun relay loses all its data. */
    async wipeRelay() {
      const old = gun;
      await new Promise((r) => {
        old.once('exit', r);
        old.kill();
      });
      gun = startGun();
      await until(() => fetch(`http://localhost:${gunPort}/`).then(() => true), 'gun relay restart');
    },
    /** The nostr relay loses all its data. */
    async wipeNostr() {
      await nostr.close();
      nostr = await startNostr();
    },
    /** Events on the nostr relay, as a reader with no keys sees them. */
    async relayEvents(filters) {
      const client = await Relay.connect(nostr.url);
      const out = [];
      await new Promise((resolve) => client.subscribe(filters, { onevent: (e) => out.push(e), oneose: resolve }));
      client.close();
      return out;
    },
    /** Publish an event straight to the nostr relay; resolves with the relay's answer. */
    async relayPublish(event) {
      const client = await Relay.connect(nostr.url);
      try {
        return await client.publish(event);
      } finally {
        client.close();
      }
    },
    async close() {
      await browser.close().catch(() => {});
      gun.kill();
      web.kill();
      await nostr.close().catch(() => {});
      await blossom.close();
      await blossomStrict.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  process.on('exit', () => {
    gun.kill();
    web.kill();
  });
  await until(() => fetch(env.base).then(() => true), 'web server');
  await until(() => fetch(`http://localhost:${gunPort}/`).then(() => true), 'gun relay');
  return env;
}

/** A fresh browser context ("device"); `init` runs before every page script; `options` go to newContext (e.g. locale). */
export async function device(env, name, init, arg, options = {}) {
  const ctx = await env.browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true, ...options });
  if (init) await ctx.addInitScript(init, arg);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => env.errors.push(`${name}: ${e.stack || e.message}`));
  page.on('dialog', (d) => d.dismiss());
  page.ctx = ctx;
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.text()));
  return page;
}

export async function run(name, body, options) {
  const env = await setup(name, options);
  let failed = false;
  try {
    await body(env);
    if (env.errors.length) throw new Error(`page errors:\n  ${env.errors.join('\n  ')}`);
    console.log(`\nall ${name} checks passed`);
  } catch (err) {
    failed = true;
    console.error(`\n${name} FAILED:`, err.message);
    if (env.errors.length) console.error('page errors:\n  ' + env.errors.join('\n  '));
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Where the top bar puts its parts on `url` at a desktop width: the switcher, the brand
 * (mark, name, its type) and the right edge. Every page of a hub should give the same.
 */
export async function topBar(env, url) {
  const page = await device(env, 'bar', null, null, { viewport: { width: 1600, height: 900 } });
  try {
    await page.goto(url);
    await page.waitForSelector('.wjs-top .wjs-brand-name');
    return await page.evaluate(() => {
      const box = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
      };
      const name = document.querySelector('.wjs-brand-name');
      return {
        bar: box('.wjs-top')[3],
        switcher: box('.wjs-switcher'),
        mark: box('.wjs-brand > :first-child'),
        name: [...box('.wjs-brand-name').slice(0, 2), box('.wjs-brand-name')[3], getComputedStyle(name).font],
        right: Math.round(document.querySelector('.wjs-right').getBoundingClientRect().right),
      };
    });
  } finally {
    await page.ctx.close();
  }
}

/**
 * A hub with nothing but some of the framework's own apps, each mounted at its own name
 * (`apps`: [{ app: 'boards', name: 'Boards', icon: 'list-checks' }]); resolves with the site's folder.
 */
export async function testHub(apps) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-test-hub-'));
  const config = {
    id: 'test-hub',
    name: 'Test hub',
    shortName: 'Test',
    brandHtml: 'Test hub',
    description: 'Framework apps on their own, for the browser suites.',
    homepage: './',
    repo: './',
    relays: [],
    media: [],
    how: null,
    policy: { userMounts: false },
    apps: apps.map((a) => ({ id: a.app, name: a.name, icon: a.icon, tags: [], framework: a.app })),
    mounts: apps.map((a, i) => ({ id: a.app, app: a.app, featured: i === 0 })),
  };
  fs.writeFileSync(path.join(dist, 'distribution.js'), `export const DISTRIBUTION = ${JSON.stringify(config)};\n`);
  const { out } = await assemble({ distribution: dist, out: fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-test-site-')), legacy: false });
  return out;
}
