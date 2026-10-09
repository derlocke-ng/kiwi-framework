import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appRoutes, spriteWith, mergedLocales, precacheList, manifest } from '../../scripts/build-site.mjs';

test('an app is served at its own folder and at every mount of it', () => {
  const config = { apps: [{ id: 'market' }, { id: 'boards' }], mounts: [{ id: 'seedbank', app: 'market' }, { id: 'gemstore', app: 'market' }, { id: 'boards', app: 'boards' }] };
  assert.deepEqual([...appRoutes(config)].sort(), [
    ['boards', 'boards'],
    ['gemstore', 'market'],
    ['market', 'market'],
    ['seedbank', 'market'],
  ]);
});

test('the precache list has every route of an app without a worker of its own, and none of one with', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-precache-'));
  try {
    for (const f of ['index.html', 'assets/hub-1.js', 'market/index.html', 'seedbank/index.html', 'own/index.html', 'own/sw.js', 'old/index.html']) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.writeFileSync(path.join(out, f), '');
    }
    const config = { apps: [{ id: 'market' }, { id: 'own' }, { id: 'old', legacy: true }], mounts: [{ id: 'seedbank', app: 'market' }, { id: 'own', app: 'own' }] };
    const list = precacheList(out, config);
    for (const f of ['./', 'index.html', 'assets/hub-1.js', 'market/', 'market/index.html', 'seedbank/', 'seedbank/index.html']) assert.ok(list.includes(f), `${f} is precached`);
    assert.ok(!list.some((f) => f.startsWith('own/')), 'an app with its own worker caches itself');
    assert.ok(!list.some((f) => f.startsWith('old/')), 'legacy apps are not precached');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a distribution adds icons to the sprite without replacing the framework’s', () => {
  const base = '<svg><symbol id="a" viewBox="0 0 24 24"><path d="M1"/></symbol></svg>';
  const extra = '<svg><symbol id="a" viewBox="0 0 24 24"><path d="M9"/></symbol><symbol id="b" viewBox="0 0 24 24"><path d="M2"/></symbol></svg>';
  const { sprite, added } = spriteWith(base, extra);
  assert.equal(added, 1);
  assert.match(sprite, /id="b"/);
  assert.match(sprite, /M1/, 'the framework’s symbol wins on a clash');
  assert.doesNotMatch(sprite, /M9/);
});

test('strings: the framework’s shared and hub catalogs, the distribution’s on top', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-locales-'));
  try {
    fs.mkdirSync(path.join(dist, 'locales'));
    fs.writeFileSync(path.join(dist, 'locales', 'en.json'), JSON.stringify({ 'hub.title': 'Our hub', 'hub.x.text': 'X' }));
    const all = mergedLocales(dist);
    assert.equal(all.en['hub.title'], 'Our hub', 'the distribution wins');
    assert.equal(all.en['hub.x.text'], 'X');
    assert.ok(all.en['common.cancel'], 'shared strings are in');
    assert.ok(all.en['settings.title'], 'hub strings are in');
    assert.ok(all.de['settings.title'], 'every language the framework ships');
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('the web app manifest carries the distribution’s name', () => {
  const m = manifest({ name: 'Armory', shortName: 'Armory', description: 'd' });
  assert.equal(m.name, 'Armory');
  assert.equal(m.start_url, './');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});
