// Light, dark or follow the system, and an accent palette: one choice each
// for the whole site, kept on this device (`wjs.theme`, `wjs.accent`). CSS
// does the rest via <html data-theme> and <html data-accent> (ui.css).

import { store } from './util.js';

export const THEME_KEY = 'wjs.theme';
export const THEMES = ['system', 'light', 'dark'];
export const ACCENT_KEY = 'wjs.accent';
/** The palettes in ui.css; the first is the default, the brand's lime. */
export const ACCENTS = ['lime', 'forest', 'sky', 'violet', 'amber', 'rose', 'graphite'];

export function accent() {
  const a = store.get(ACCENT_KEY);
  return ACCENTS.includes(a) ? a : ACCENTS[0];
}

export function setAccent(a) {
  store.set(ACCENT_KEY, ACCENTS.includes(a) ? a : ACCENTS[0]);
  applyTheme();
}

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
  const a = accent();
  if (a === ACCENTS[0]) delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = a;
}

/**
 * Follow changes made on another page of the site (another tab, the hub, an app).
 * @param {{ onTheme?: () => void, onLanguage?: (() => void) | null }} [handlers]
 */
export function watchDeviceSettings({ onTheme = applyTheme, onLanguage = null } = {}) {
  addEventListener('storage', (e) => {
    if (e.key === THEME_KEY || e.key === ACCENT_KEY) onTheme();
    if (e.key === 'wjs.lang' && onLanguage) onLanguage();
  });
}
