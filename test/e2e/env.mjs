// Shared setup for the end-to-end tests: a local nostr relay (in-process), two local
// Blossom servers (one takes any file, one only images, like some public
// ones), a static server for apps/, and Chromium.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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

/** A port nothing listens on right now, so suites running side by side never collide. */
/**
 * Is nothing on the page matching `selector`? Assert with this, never with assert.equal(await page.$(…), null):
 * when that fails, node's assert inspects the element handle to a depth of 1000, walks Playwright's whole
 * connection and runs the machine out of memory instead of saying what failed.
 */
export const absent = async (page, selector) => (await page.$$(selector)).length === 0;

/**
 * "New list" or "New note" on the boards' start page: on a phone (the devices here are 420 px wide) the round
 * button's menu, on a wide screen the button in the head.
 */
export async function startBoard(page, kind = 'check') {
  const fab = await page.$('#newBoardFab');
  if (fab && (await fab.isVisible())) {
    await fab.click();
    await page.click(`.menu [data-act=new-${kind}]`);
  } else await page.click(`[data-new="${kind}"]`);
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * The servers a suite needs: a nostr relay (the hub's), a web server for `webRoot`, two
 * Blossom servers, a browser. `nostrPort` fixes the hub relay's port (a distribution built with the
 * relay's URL baked in); `publicPort` starts a second nostr relay, the public one, at that port.
 */
export async function setup(name, { webRoot = path.join(root, 'apps'), nostrPort = null, publicPort = null, extraRelays = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-e2e-`));
  const [webPort, freeNostr] = await Promise.all([freePort(), freePort()]);
  nostrPort = nostrPort || freeNostr;
  let nostrRuns = 0;
  let nostrDir = null;
  const startNostr = (dir = null) => startRelay({ port: nostrPort, dir: (nostrDir = dir || path.join(tmp, `nostr-${nostrRuns++}`)), name: 'e2e relay' });
  let nostr = await startNostr();
  const publicRelay = publicPort ? await startRelay({ port: publicPort, dir: path.join(tmp, 'nostr-public'), name: 'public relay' }) : null;
  // more relays by name (another hub's, a directory): extraRelays { name: port }
  const extra = {};
  for (const [n, port] of Object.entries(extraRelays)) extra[n] = await startRelay({ port, dir: path.join(tmp, `nostr-${n}`), name: `${n} relay` });
  const servers = [];
  const blossom = await startBlossom();
  const blossomStrict = await startBlossom({ accept: (type) => type.startsWith('image/') || 'only images here' });
  const web = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), webRoot, String(webPort)], { stdio: 'ignore' });
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  // mDNS-obfuscated ICE candidates don't resolve in containers; real browsers are fine.
  // A UTF-8 locale keeps non-ASCII download names (minimal containers default to C).
  const browser = await chromium.launch({ executablePath, args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env: { ...process.env, LANG: 'C.UTF-8' } });
  const env = {
    tmp,
    nostrUrl: nostr.url,
    /** the public relay's URL, when the suite asked for one */
    publicUrl: publicRelay?.url || null,
    /** the URLs of the extra relays, by name */
    extraUrls: Object.fromEntries(Object.entries(extra).map(([n, r]) => [n, r.url])),
    /** media servers: blobs are in .blobs (sha256 → { data, type, owner }) */
    blossom,
    blossomStrict,
    base: `http://localhost:${webPort}/`,
    browser,
    errors: [],
    /** The nostr relay loses all its data. */
    async wipeNostr() {
      await nostr.close();
      nostr = await startNostr();
    },
    /** The hub's relay goes away (the VPN is gone) and keeps its data for resumeNostr(). */
    async pauseNostr() {
      await nostr.close();
      nostr = null;
    },
    async resumeNostr() {
      if (!nostr) nostr = await startNostr(nostrDir);
    },
    /** Events on the nostr relay (`which`: 'hub' or 'public'), as a reader with no keys sees them. */
    async relayEvents(filters, which = 'hub') {
      const url = which === 'public' ? publicRelay.url : which === 'hub' ? nostr.url : extra[which].url;
      const client = await Relay.connect(url);
      const out = [];
      await new Promise((resolve) => client.subscribe(filters, { onevent: (e) => out.push(e), oneose: resolve }));
      client.close();
      return out;
    },
    /** Serve another site (a second hub) for the rest of the run; resolves with its base URL. */
    async serve(dir) {
      const port = await freePort();
      servers.push(spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), dir, String(port)], { stdio: 'ignore' }));
      const base = `http://localhost:${port}/`;
      await until(() => fetch(base).then(() => true), 'second web server');
      return base;
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
      web.kill();
      for (const s of servers) s.kill();
      await nostr?.close().catch(() => {});
      await publicRelay?.close().catch(() => {});
      for (const r of Object.values(extra)) await r.close().catch(() => {});
      await blossom.close();
      await blossomStrict.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  process.on('exit', () => {
    web.kill();
  });
  await until(() => fetch(env.base).then(() => true), 'web server');
  return env;
}

/** A fresh browser context ("device"); `init` runs before every page script; `options` go to newContext (e.g. locale). */
export async function device(env, name, init, arg, options = {}) {
  const ctx = await env.browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true, ...options });
  if (init) await ctx.addInitScript(init, arg);
  // WJS_DEBUG=1: the sync layer logs every publish and answer (shared/sync.js); run() prints them when a suite fails
  if (process.env.WJS_DEBUG) await ctx.addInitScript(() => localStorage.setItem('wjs.debug', '1'));
  // No directory relays unless a suite asks for the hub's own (env.keepDirectories): a distribution may name a
  // real directory (Armory names purplepag.es), and test keys must never be published there.
  if (!env.keepDirectories) await ctx.addInitScript(() => localStorage.setItem('wjs.directory', '[]'));
  const page = await ctx.newPage();
  page.deviceName = name;
  (env.pages ||= []).push(page);
  // the page's relay sockets, seen from outside the page (no change to its timing): opens, closes, what went over them
  page.wslog = [];
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  page.on('websocket', (ws) => {
    const short = ws.url().replace(/^ws:\/\/localhost:/, ':');
    page.wslog.push(`${stamp()} open ${short}`);
    ws.on('close', () => page.wslog.push(`${stamp()} close ${short}`));
    ws.on('socketerror', (e) => page.wslog.push(`${stamp()} error ${short} ${e}`));
    ws.on('framesent', (f) => {
      const m = /^\["(EVENT|REQ|CLOSE)",?\s*(?:\{"kind":(\d+)|"([^"]{0,12})")?/.exec(String(f.payload));
      if (m) page.wslog.push(`${stamp()} > ${m[1]}${m[2] ? ` ${m[2]}` : ''}${m[3] ? ` ${m[3]}` : ''}`);
    });
    ws.on('framereceived', (f) => {
      const text = String(f.payload);
      const m = /^\["(OK|EOSE|NOTICE|CLOSED)",\s*"?([^",]{0,12})/.exec(text);
      if (m) page.wslog.push(`${stamp()} < ${m[1]} ${m[2]}${m[1] === 'OK' ? text.slice(text.indexOf(',', 10), text.indexOf(',', 10) + 60) : ''}`);
      else if (text.startsWith('["EVENT"')) {
        const k = /"kind":(\d+)/.exec(text);
        page.wslog.push(`${stamp()} < EVENT ${k ? k[1] : '?'}`);
      }
    });
  });
  page.on('pageerror', (e) => env.errors.push(`${name}: ${e.stack || e.message}`));
  page.on('dialog', (d) => d.dismiss());
  page.ctx = ctx;
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() === 'log' || m.type() === 'debug' || m.type() === 'info' ? m.text() : `${m.type()}: ${m.text()}`));
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
    // what the pages said (the sync log under WJS_DEBUG, errors and warnings always) and where their network stands
    for (const page of env.pages || []) {
      const lines = (page.logs || []).filter((l) => l.startsWith('[sync]') || /error|warn|failed|refused|rejected/i.test(l)).slice(-25);
      if (lines.length) console.error(`console of ${page.deviceName}:\n  ${lines.join('\n  ')}`);
      const state = await page
        .evaluate(async () => {
          const k = window.kiwi;
          if (!k) return null;
          const relays = k.whole.pool.status().relays.map((r) => `${r.url} ${r.open ? 'open' : 'closed'}${r.error ? ` (${r.error})` : ''}${r.publishError ? ` publish: ${r.publishError}` : ''}`);
          const box = await k.whole.sync.outbox();
          return { url: location.href, online: navigator.onLine, relays, outbox: box };
        })
        .catch(() => null);
      if (state) console.error(`network of ${page.deviceName}: ${JSON.stringify(state)}`);
      // the addressable events this page holds (boards and settings), to compare versions with the relay's
      const held = await page
        .evaluate(async () => {
          const k = window.kiwi;
          if (!k) return null;
          const list = await k.whole.db.query([{ kinds: [30700, 30701, 30702, 30703] }]);
          return list.map((e) => `${e.kind}:${e.pubkey.slice(0, 8)}:${(e.tags.find((t) => t[0] === 'd') || [])[1] || ''}@${e.created_at}#${e.id.slice(0, 6)}`).sort();
        })
        .catch(() => null);
      if (held?.length) console.error(`boards held by ${page.deviceName}: ${held.join(' ')}`);
      if (page.wslog?.length) console.error(`sockets of ${page.deviceName}:\n  ${page.wslog.slice(-40).join('\n  ')}`);
    }
    if (env.relayEvents) {
      const onRelay = await env.relayEvents([{ kinds: [30700, 30701, 30702, 30703] }]).catch(() => []);
      console.error(`boards on the relay: ${onRelay.map((e) => `${e.kind}:${e.pubkey.slice(0, 8)}:${(e.tags.find((t) => t[0] === 'd') || [])[1] || ''}@${e.created_at}#${e.id.slice(0, 6)}`).sort().join(' ')}`);
    }
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
 * A hub with nothing but some of the framework's own apps, one mount per entry
 * (`apps`: [{ app: 'boards', name: 'Boards', icon: 'list-checks', network?: 'public', space?: 'jobs', id?: 'jobs' }]:
 * `id` mounts the app under another route, so one app can be mounted twice); `options` set the hub's
 * name, id, relays, publicRelays, directoryRelays, policy, spaces and caldav (as in distribution.js). Resolves
 * with the site's folder.
 */
export async function testHub(apps, { id = 'test-hub', name = 'Test hub', relays = [], publicRelays = [], directoryRelays = [], policy = {}, spaces = [], media = [], caldav = '' } = {}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-test-hub-'));
  const codes = [...new Map(apps.map((a) => [a.app, a])).values()]; // one app entry per app, however often it is mounted
  const config = {
    id,
    name,
    shortName: name,
    brandHtml: name,
    description: 'Framework apps on their own, for the browser suites.',
    homepage: './',
    repo: './',
    relays,
    publicRelays,
    directoryRelays,
    media,
    how: null,
    caldav,
    policy: { userMounts: false, ...policy },
    spaces,
    apps: codes.map((a) => ({ id: a.app, name: a.name, icon: a.icon, tags: [], framework: a.app })),
    mounts: apps.map((a, i) => ({
      id: a.id || a.app,
      app: a.app,
      name: a.name,
      featured: i === 0,
      ...(a.network ? { network: a.network } : {}),
      ...(a.space ? { space: a.space } : {}),
      ...(a.requireAccount ? { requireAccount: true } : {}),
      ...(a.sellers ? { sellers: a.sellers } : {}),
    })),
  };
  fs.writeFileSync(path.join(dist, 'distribution.js'), `export const DISTRIBUTION = ${JSON.stringify(config)};\n`);
  const { out } = await assemble({ distribution: dist, out: fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-test-site-')), legacy: false });
  return out;
}
