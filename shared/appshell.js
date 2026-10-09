// What an app needs to feel like part of the suite: the shared top bar with
// the switcher, the theme, the language, and the account's hidden apps.
//
//   const shell = await initAppShell({ current: 'payload', brand: { name: 'Payload', mark }, right: '…' });
//   shell.onLanguage(() => render());   // optional

import { initI18n, setLanguage, savedLanguage, currentLanguage, LANGUAGES } from './i18n.js';
import { applyTheme, setTheme, theme, watchDeviceSettings } from './theme.js';
import { loadIdentity } from './account.js';
import { AccountSettings } from './settings.js';
import { mountTopbar, accountLink } from './topbar.js';
import { appById, mountById, appMark } from './apps.js';
import { mountStatus } from './status.js';
import { BlockList } from './moderation.js';
import { People } from './people.js';
import { peopleNotices } from './people-ui.js';
import { setSprite } from './ui.js';

/**
 * @param {{ current: string, brand: object, right?: string, base?: string, header?: HTMLElement, dirs?: string[], sprite?: string, net?: object }} options
 *   base: path to the site root ('../' for an app); dirs: catalog dirs (shared + the app's own `locales/`)
 */
export async function initAppShell({ app = null, current = app, brand = {}, right = '', account = null, base = '../', header = '#top', dirs = [`${base}shared/locales/`, 'locales/'], sprite = `${base}icons.svg`, net = null }) {
  // `app` is the app's id. The mount it runs as comes from the page's folder, so one app mounted
  // twice (two markets on one hub) shows each mount's name and mark and highlights it in the switcher.
  const folder = typeof location !== 'undefined' ? location.pathname.replace(/[^/]*$/, '').split('/').filter(Boolean).pop() : null;
  const mounted = app && folder && folder !== app && mountById(folder)?.app === app ? folder : null;
  if (mounted && current === app) current = mounted;
  const entry = mounted ? mountById(mounted) : app ? mountById(app) || appById(app) : null;
  const brandOpts = { href: './', name: entry?.name || current, ...(entry ? { mark: appMark(entry, sprite) } : {}), ...brand };
  // The header is looked up on every draw: apps that re-render their shell get a fresh element.
  const headerEl = () => (typeof header === 'string' ? document.querySelector(header) : header);
  applyTheme();
  setSprite(sprite);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  await initI18n({ dirs });
  const identity = loadIdentity();
  // Hidden apps, language and theme chosen in the account: from the cache now, live when the app brings a connection.
  const suite = new AccountSettings(identity, net, 'suite');
  if (net) await suite.start();
  const listeners = new Set();
  let offStatus = null;
  const draw = () => {
    const el = headerEl();
    if (!el) return;
    const extra = account ? accountLink({ ...account, identity: loadIdentity(), sprite }) : '';
    mountTopbar(el, { base, current, brand: brandOpts, right: (typeof right === 'function' ? right() : right) + extra, hidden: () => suite.get('hiddenApps', []) || [], order: () => suite.get('appOrder', []) || [], sprite });
    // A connection pill in the bar (statusPill()) is kept live here, so apps need not remount it after a redraw.
    offStatus?.();
    const pill = net ? el.querySelector('.wjs-status') : null;
    offStatus = pill ? mountStatus(pill, net) : null;
  };
  draw();
  const languageChanged = () => {
    draw();
    for (const fn of listeners) fn(currentLanguage());
  };
  const applySuite = async () => {
    const lang = suite.get('lang');
    if (lang && LANGUAGES[lang] && lang !== currentLanguage()) {
      await setLanguage(lang);
      languageChanged();
    }
    const th = suite.get('theme');
    if (th && th !== theme()) setTheme(th);
    draw();
  };
  suite.onChange(applySuite);
  await applySuite();
  watchDeviceSettings({
    onTheme: applyTheme,
    onLanguage: async () => {
      const lang = savedLanguage();
      if (lang && lang !== currentLanguage()) {
        await setLanguage(lang);
        languageChanged();
      }
    },
  });
  // The account's block list and People (friends, circles, shares) for every app with a connection,
  // with notices about requests and shares; apps read shell.blocks / shell.people.
  let blocks = null;
  let people = null;
  if (net) {
    blocks = await new BlockList(identity, net).start();
    people = await new People(identity, net, { isBlocked: (pk) => blocks.isBlocked(pk) }).start();
    peopleNotices(people, { base, current });
  }
  return {
    suite,
    blocks,
    people,
    redraw: draw,
    onLanguage: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
