// Scaffold an app that plugs into the suite: a folder with a page, a script
// on the shared core and app shell, a settings view, strings in every
// language, the registry entry, the hub card text, the favicon and the
// service worker list. Then write the app.
//   npm run new-app -- outpost "Outpost" sprout        (in the distribution's repository)
//   (the icon is a lucide symbol id from the framework's sprite, or from the distribution's icons.svg)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL as toUrl } from 'node:url';
const DIST_FILE = path.resolve(process.cwd(), 'distribution.js');
const { DISTRIBUTION } = await import(toUrl(DIST_FILE).href);
const APPS = DISTRIBUTION.apps;
import { LANGUAGES } from '../shared/i18n.js';

const framework = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = process.cwd(); // the distribution
const [id, name, icon] = process.argv.slice(2);
if (!id || !name || !icon) {
  console.error('usage: npm run new-app -- <id> "<Name>" <icon>');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('the id is the folder and URL path: lowercase letters, digits, dashes');
if (APPS.some((a) => a.id === id) || fs.existsSync(path.join(root, 'apps', id))) throw new Error(`"${id}" exists already`);
const sprites = [path.join(framework, 'hub/icons.svg'), path.join(root, 'icons.svg')].filter((f) => fs.existsSync(f));
if (!sprites.some((f) => fs.readFileSync(f, 'utf8').includes(`<symbol id="${icon}"`))) throw new Error(`no symbol "${icon}" in the framework's sprite or the distribution's icons.svg; add the lucide icon to icons.svg first`);

const dir = path.join(root, 'apps', id);
fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
const write = (file, text) => {
  fs.writeFileSync(path.join(dir, file), text);
  console.log(`apps/${id}/${file}`);
};

write(
  'index.html',
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'self'">
  <meta name="referrer" content="no-referrer">
  <meta name="description" content="${name} — part of ${DISTRIBUTION.name}.">
  <meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0e0f0d" media="(prefers-color-scheme: dark)">
  <title>${name}</title>
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="manifest" href="../manifest.webmanifest">
  <link rel="stylesheet" href="${id}.css">
  <script type="module" src="${id}.js"></script>
</head>
<body>
  <header id="top"></header>
  <main id="main" class="main">
    <noscript><p class="empty">${name} needs JavaScript: everything is signed and verified in your browser.</p></noscript>
  </main>
  <footer class="foot"><a href="../">${DISTRIBUTION.name}</a> · <span id="footNote"></span></footer>
  <div id="toasts" class="toasts" aria-live="polite"></div>
</body>
</html>
`,
);

write(
  `${id}.css`,
  `/* ${name} — tokens and components from the shared design library; this file
   holds what is ${name}'s own. */
@import url('../shared/ui.css');

body {
  display: flex;
  flex-direction: column;
}

.main {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 1rem var(--gutter) 3rem;
  flex: 1;
}

.wjs-top {
  padding-left: max(var(--gutter), calc((100% - 760px) / 2));
  padding-right: max(var(--gutter), calc((100% - 760px) / 2));
}

.foot a {
  color: var(--muted);
}
`,
);

write(
  `${id}.js`,
  `// ${name}: the shared core (relays, store, sync, account), the app shell (top
// bar with switcher, account button and connection pill; theme; language) and
// the settings view every app has. Strings live in locales/<lang>.json.
import { LocalStore } from '../shared/store.js';
import { RelayPool, savedRelays } from '../shared/relays.js';
import { Sync } from '../shared/sync.js';
import { loadIdentity } from '../shared/account.js';
import { AccountSettings } from '../shared/settings.js';
import { initAppShell } from '../shared/appshell.js';
import { statusPill } from '../shared/status.js';
import { settingsView } from '../shared/settingsview.js';
import { howLines } from '../shared/how.js';
import { t, tErr } from '../shared/i18n.js';
import { $, h, icon, toast } from '../shared/ui.js';

const net = { db: null, pool: null, sync: null };
let identity;
let prefs; // this app's settings, encrypted in the account (kind 30791, d = '${id}')
let shell;

function render() {
  const main = $('#main');
  if (location.hash.startsWith('#/settings')) {
    main.innerHTML = settingsView({
      identity,
      title: t('app.settings.title', { app: '${name}' }),
      backLabel: t('${id}.back'),
      cards: [
        \`<div class="card"><h2>\${icon('settings')}\${h(t('${id}.settings.example'))}</h2>
          <label class="check-row"><input type="checkbox" id="exampleToggle" \${prefs.get('example') ? 'checked' : ''}><span>\${h(t('${id}.settings.exampleToggle'))}</span></label></div>\`,
      ],
      // the framework's topics (shared/how.js: HOW has a list per kind of app) and lines of its own
      how: howLines(['${id}.how.1', 'encrypted', 'relays', 'offline']),
    });
    return;
  }
  main.innerHTML = \`<section class="card"><h2>\${h(t('${id}.title'))}</h2><p>\${h(t('${id}.lead'))}</p></section>\`;
  $('#footNote').textContent = t('${id}.footer');
}

async function boot() {
  net.db = await LocalStore.open('wjs');
  net.pool = new RelayPool(savedRelays());
  net.sync = new Sync(net.pool, net.db);
  identity = loadIdentity();
  shell = await initAppShell({ app: '${id}', net, brand: { href: '#/' }, right: () => statusPill({ href: '../settings.html#relays' }), account: { href: '#/settings' } });
  // shell.people (friends, circles, sharing: shared/people.js, pickPeople in people-ui.js) and shell.blocks are ready to use.
  shell.onLanguage(render);
  prefs = await new AccountSettings(identity, net, '${id}').start();
  prefs.onChange(render);
  net.sync.watch([identity.pk]);
  window.addEventListener('hashchange', render);
  $('#main').addEventListener('change', (e) => {
    if (e.target.id === 'exampleToggle') prefs.set({ example: e.target.checked }).catch((err) => toast(tErr(err), 'error'));
  });
  render();
}

boot().catch((err) => {
  console.error(err);
  toast(err.message, 'error');
});
`,
);

const strings = {
  [`${id}.title`]: name,
  [`${id}.lead`]: `${name} is new here. Replace this with what it does.`,
  [`${id}.footer`]: 'signed events on nostr relays',
  [`${id}.back`]: `Back to ${name}`,
  [`${id}.settings.example`]: 'Example',
  [`${id}.settings.exampleToggle`]: 'An example setting, kept in your account',
  [`${id}.how.1`]: `${name} runs entirely in your browser; relays only pass signed events along.`,
};
for (const lang of Object.keys(LANGUAGES)) write(`locales/${lang}.json`, JSON.stringify(strings, null, 2) + '\n');
write('README.md', `# ${name}\n\nPart of [${DISTRIBUTION.name}](../../README.md). Say what it does here.\n`);
write(
  'kiwi.manifest',
  `# kiwi.manifest: this app's entry for the Kiwi Network web catalog
NAME=${id}
DESCRIPTION=${name}: say in one sentence what it does
VERSION=0.1.0
CATEGORY=App
COMPONENTS=web
FRAMEWORK=kiwi-framework
ICON=icon.svg
# the nostr event kinds it reads and writes, once it has them
KINDS=
TAGS=nostr
HOMEPAGE=${DISTRIBUTION.homepage || ''}${id}/
LICENSE=GPL-3.0-or-later
`,
);

// the distribution: the app's code entry and a mount of it
function insertInto(src, key, line) {
  const start = src.indexOf(`${key}: [`);
  if (start < 0) throw new Error(`distribution.js has no "${key}" list`);
  let depth = 0;
  let i = start + key.length + 3; // just past the opening bracket
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      if (depth === 0) break;
      depth--;
    }
  }
  const inner = src.slice(start + key.length + 3, i);
  const body = inner.trim() ? `${inner.replace(/\s*$/, '')}\n    ${line}\n  ` : `\n    ${line}\n  `;
  return `${src.slice(0, start + key.length + 3)}${body}${src.slice(i)}`;
}
let distSrc = fs.readFileSync(DIST_FILE, 'utf8');
distSrc = insertInto(distSrc, 'apps', `{ id: '${id}', name: ${JSON.stringify(name)}, icon: '${icon}', tags: ['nostr'] },`);
distSrc = insertInto(distSrc, 'mounts', `{ id: '${id}', app: '${id}', space: null, isNew: true },`);
fs.writeFileSync(DIST_FILE, distSrc);
console.log('distribution.js: app registered and mounted');

// the hub card's text, in every language (English until translated)
fs.mkdirSync(path.join(root, 'locales'), { recursive: true });
for (const lang of Object.keys(LANGUAGES)) {
  const file = path.join(root, 'locales', `${lang}.json`);
  const cat = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cat[`hub.${id}.text`] = `${name}: say in one sentence what it does and what it runs on.`;
  fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n');
}
console.log('locales/*.json: hub card text added');

execFileSync(process.execPath, [path.join(framework, 'scripts/app-icons.mjs'), id], { stdio: 'inherit', cwd: root });

console.log(`
${name} is in: open apps/${id}/ on the dev server, it shows on the start page and in the switcher.
Still yours:
  · write the app in apps/${id}/${id}.js (the board goes in render(), settings cards in settingsView)
  · translate apps/${id}/locales/*.json and hub.${id}.text in locales/*.json (English for now)
  · a browser test in test/e2e/${id}.mjs (copy an existing one), added to "test:e2e" in package.json
  · a row in README.md
`);
