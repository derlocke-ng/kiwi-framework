// Scaffold an app that plugs into the suite: a React app on the framework's
// React layer (kiwi-framework/ui) with the app shell, a settings page and
// strings in every language, its registry entry and mount, the hub card text
// and the favicon. The build compiles it with Vite for every route it is
// mounted at, like the framework's own apps. Then write the app.
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'self'; manifest-src 'self'">
  <meta name="referrer" content="no-referrer">
  <meta name="description" content="${name}: part of ${DISTRIBUTION.name}.">
  <meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0e0f0d" media="(prefers-color-scheme: dark)">
  <title>${name}</title>
  <link rel="icon" href="icon.svg" type="image/svg+xml" vite-ignore>
  <link rel="manifest" href="manifest.webmanifest" vite-ignore>
  <script type="module" src="./main.tsx"></script>
</head>
<body>
  <div id="root"></div>
  <noscript><p class="noscript">${name} needs JavaScript: everything is signed and verified in your browser.</p></noscript>
</body>
</html>
`,
);

write(
  'main.tsx',
  `// ${name}'s page. The mount it runs as is the folder it is served from, so one
// build serves every route the hub mounts it at.
import { mountApp } from 'kiwi-framework/ui';
import { App } from './App';
import './${id}.css';

await mountApp(App, { id: '${id}' });
`,
);

write(
  'App.tsx',
  `// ${name}. Routes: #/ the app, #/settings its settings.
//
// Everything comes from the framework's React layer, kiwi-framework/ui: the
// shell (AppShell, AppSettings), the strings (useT, from locales/), the account
// (useIdentity) and this app's settings in it (useAppSettings), friends and
// circles (usePeople, pickPeople), the block list (useBlocks), nostr events
// (useEvents), dialogs, toasts and the widgets (ItemList, MarkdownEditor,
// Collection, Feed, ImageUpload, …).
import { AppSettings, AppShell, Icon, toastError, useAppSettings, useHash, useMount, useT } from 'kiwi-framework/ui';

/** "How it works": a line of its own, then the framework's topics it is built from (HOW in kiwi-framework/ui has a list per kind of app). */
const HOW = ['${id}.how.1', 'encrypted', 'relays', 'offline'];

function Settings({ settings }: { settings: any }) {
  const t = useT();
  const mount = useMount();
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('${id}.back')} how={HOW}>
      <div className="card">
        <h2>
          <Icon name="settings" />
          {t('${id}.settings.example')}
        </h2>
        <label className="check-row">
          <input
            type="checkbox"
            id="exampleToggle"
            checked={Boolean(settings?.get('example'))}
            disabled={!settings}
            onChange={(e) => settings.set({ example: e.target.checked }).catch(toastError)}
          />
          <span>{t('${id}.settings.exampleToggle')}</span>
        </label>
      </div>
    </AppSettings>
  );
}

export function App() {
  const t = useT();
  // this app's settings, encrypted in the account (kind 30791, d = '${id}'): they follow it to every device
  const settings = useAppSettings('${id}');
  const page = useHash().startsWith('#/settings') ? 'settings' : 'home';
  return (
    <AppShell footer={t('${id}.footer')}>
      {page === 'settings' ? (
        <Settings settings={settings} />
      ) : (
        <section className="card">
          <h1>{t('${id}.title')}</h1>
          <p>{t('${id}.lead')}</p>
        </section>
      )}
    </AppShell>
  );
}
`,
);

write(
  `${id}.css`,
  `/* ${name}: tokens and components come from the framework's design library;
   this file holds what is ${name}'s own. */
@import 'kiwi-framework/shared/ui.css';

body {
  display: flex;
  flex-direction: column;
}

#root {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.view {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 1.25rem var(--gutter) 3rem;
  flex: 1;
  outline: none;
}

.foot {
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
  padding: 1.5rem var(--gutter) max(1.5rem, env(safe-area-inset-bottom));
}

.foot a {
  color: inherit;
}
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
${name} is in: npm run dev serves it at /${id}/ and rebuilds it on save; it shows on the start page and in the switcher.
Still yours:
  · write the app in apps/${id}/App.tsx (React on kiwi-framework/ui; the page in App, settings cards in Settings)
  · translate apps/${id}/locales/*.json and hub.${id}.text in locales/*.json (English for now)
  · a browser test in test/e2e/${id}.mjs (copy an existing one), added to "test:e2e" in package.json
  · a row in README.md
`);
