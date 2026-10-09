// A distribution's own app as `npm run new-app` makes it, built by Vite
// against the framework's React layer: it starts in a browser (one React for
// the app and the framework), shows the mount's name, keeps its settings in
// the account, serves a second mount under that mount's name, and its top bar
// sits exactly where the hub's does.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assemble } from '../../scripts/build-site.mjs';
import { device, root, run, topBar } from './env.mjs';

const step = (s) => console.log(`• ${s}`);

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-scaffold-'));
fs.copyFileSync(path.join(root, 'shared/distribution.js'), path.join(dist, 'distribution.js'));
fs.mkdirSync(path.join(dist, 'apps'));
execFileSync(process.execPath, [path.join(root, 'scripts/new-app.mjs'), 'demo', 'Demo', 'shield'], { cwd: dist, stdio: 'ignore' });
const file = path.join(dist, 'distribution.js');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(\{ id: 'demo', app: 'demo'[^}]*\},)/, "$1\n    { id: 'demo-two', app: 'demo', name: 'Demo Two' },"));
const { out } = await assemble({ distribution: dist, out: path.join(dist, '_site') });

await run(
  'scaffold',
  async (env) => {
    const init = (relay) => localStorage.setItem('wjs.relays', JSON.stringify([relay]));

    step('the scaffolded app starts, in its mount’s name, with the suite’s top bar');
    const A = await device(env, 'A', init, env.nostrUrl);
    await A.goto(`${env.base}demo/`);
    await A.waitForSelector('.view h1');
    assert.equal(await A.textContent('.view h1'), 'Demo');
    assert.equal(await A.textContent('.wjs-brand-name'), 'Demo');
    assert.ok(await A.$('.wjs-top .wjs-switcher'), 'the switcher is in the top bar');
    assert.ok(await A.$('#accountLink'), 'the account button leads to the app’s settings');

    step('its settings page: identity, its own card, how it works; a setting is kept in the account');
    await A.click('#accountLink');
    await A.waitForSelector('#exampleToggle:not([disabled])');
    assert.equal(await A.textContent('.wjs-settings h1'), 'Demo settings');
    assert.ok(await A.$('.wjs-settings #how li[data-how="relays"]'), 'how it works lists the framework’s topics');
    await A.check('#exampleToggle');
    await A.reload();
    await A.waitForSelector('#exampleToggle:not([disabled])');
    assert.ok(await A.isChecked('#exampleToggle'), 'the setting survives a reload');

    step('a second mount of it shows its own name and shares the app’s settings');
    await A.goto(`${env.base}demo-two/#/settings`);
    await A.waitForSelector('#exampleToggle:not([disabled])');
    assert.equal(await A.textContent('.wjs-brand-name'), 'Demo Two');
    assert.equal(await A.textContent('.wjs-settings h1'), 'Demo Two settings');
    assert.ok(await A.isChecked('#exampleToggle'));
    assert.match(fs.readFileSync(path.join(out, 'demo-two/manifest.webmanifest'), 'utf8'), /"name": "Demo Two"/);

    step('on a wide screen the top bar is the same on the hub and in the app');
    const hub = await topBar(env, env.base);
    assert.deepEqual(await topBar(env, `${env.base}demo/`), hub, 'switcher, brand and account button in the same place, in the same type');
    assert.ok(hub.switcher[0] > 200, 'the bar is centred, not full width');
  },
  { webRoot: out },
);
