// One drawing per app: its icon from the sprite on a rounded square, written
// to apps/<id>/icon.svg in the distribution, plus PNGs where the app's own
// manifest lists them (rendered with the test browser). The hub card, the
// switcher and the top bar use the same symbol, so an app looks the same
// everywhere. Run from the distribution's repository:
//   node node_modules/kiwi-framework/scripts/app-icons.mjs            # every app
//   node node_modules/kiwi-framework/scripts/app-icons.mjs devboard   # one app
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathToFileURL as toUrl } from 'node:url';
const DIST_FILE = path.resolve(process.cwd(), 'distribution.js');
const { DISTRIBUTION } = await import(toUrl(DIST_FILE).href);
const APPS = DISTRIBUTION.apps;

const framework = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = process.cwd(); // the distribution
/** The framework's sprite, plus whatever the distribution's own icons.svg adds. */
const sprite = () => {
  let s = fs.readFileSync(path.join(framework, 'hub/icons.svg'), 'utf8');
  const extra = path.join(root, 'icons.svg');
  if (fs.existsSync(extra)) s += fs.readFileSync(extra, 'utf8');
  return s;
};

/** The favicon markup for an app: 64×64, the lucide symbol scaled onto a dark rounded square. */
export function iconSvg(app, symbols = sprite()) {
  const m = symbols.match(new RegExp(`<symbol id="${app.icon}"[^>]*>([\\s\\S]*?)</symbol>`));
  if (!m) throw new Error(`no symbol "${app.icon}" in the framework's hub/icons.svg or the distribution's icons.svg`);
  const inner = m[1].trim().replace(/\s+/g, ' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#151713"/>
  <g transform="translate(12 12) scale(1.6667)" fill="none" stroke="#a3e635" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
</svg>
`;
}

export const iconFile = (app) => path.join(root, 'apps', app.id, 'icon.svg');
export const appsWithIcons = () => APPS.filter((a) => !a.legacy && fs.existsSync(path.join(root, 'apps', a.id)));

async function renderPngs(app, svg) {
  const manifestFile = path.join(root, 'apps', app.id, 'manifest.webmanifest');
  if (!fs.existsSync(manifestFile)) return;
  const pngs = (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).icons || []).filter((i) => /\.png$/.test(i.src));
  if (!pngs.length) return;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const { chromium } = (await import('playwright-core')).default;
  const browser = await chromium.launch({ executablePath });
  try {
    for (const { src, sizes } of pngs) {
      const size = Number(String(sizes).split('x')[0]) || 512;
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      await page.screenshot({ path: path.join(root, 'apps', app.id, src), omitBackground: true });
      await page.close();
      console.log(`apps/${app.id}/${src}`);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  const symbols = sprite();
  for (const app of appsWithIcons()) {
    if (only && app.id !== only) continue;
    const svg = iconSvg(app, symbols);
    fs.writeFileSync(iconFile(app), svg);
    console.log(`apps/${app.id}/icon.svg`);
    await renderPngs(app, svg);
  }
}
