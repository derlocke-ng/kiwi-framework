// Light, dark or follow the system: one choice for the whole site, kept on
// this device (`wjs.theme`). CSS does the rest via <html data-theme>.

import { store } from './util.js';

export const THEME_KEY = 'wjs.theme';
export const THEMES = ['system', 'light', 'dark'];

export function theme() {
  let t = store.get(THEME_KEY);
  if (!t) {
    // Loadout used to keep its own key; carry it over once.
    const old = store.get('loadout.theme');
    if (old) {
      store.set(THEME_KEY, old);
      store.remove('loadout.theme');
      t = old;
    }
  }
  return THEMES.includes(t) ? t : 'system';
}

export function setTheme(t) {
  store.set(THEME_KEY, THEMES.includes(t) ? t : 'system');
  applyTheme();
}

export function applyTheme() {
  const t = theme();
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/** Follow changes made on another page of the site (another tab, the hub, an app). */
export function watchDeviceSettings({ onTheme = applyTheme, onLanguage = null } = {}) {
  addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) onTheme();
    if (e.key === 'wjs.lang' && onLanguage) onLanguage();
  });
}
