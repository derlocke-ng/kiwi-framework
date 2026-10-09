// Languages for every app: one small JSON catalog per language, loaded on
// demand (the active language plus English as the fallback), chosen from the
// browser's languages until the user picks one. Device-only: the choice never
// leaves this browser.
//
//   await initI18n({ dirs: ['../shared/locales/', 'locales/'] });
//   t('home.title')                       → 'Your boards'
//   t('list.added', { n: 3 })             → 'Added 3 items'   (plural forms per CLDR category)
//   tErr(err)                             → translated message for an error with a `code`

import { store } from './util.js';

/** Supported languages, each named in itself. Adding one = adding its JSON files. */
export const LANGUAGES = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
};
export const LANG_KEY = 'wjs.lang';

let lang = 'en';
let catalog = {};
let fallback = {};
let config = { dirs: [], base: null };
let plurals = new Intl.PluralRules('en');
let relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const listeners = new Set();

/** The best supported match for the browser's language preferences. */
export function pickLanguage(preferred = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []) {
  for (const tag of preferred || []) {
    const code = String(tag || '')
      .toLowerCase()
      .split('-')[0];
    if (LANGUAGES[code]) return code;
  }
  return 'en';
}

export function savedLanguage() {
  const v = store.get(LANG_KEY);
  return LANGUAGES[v] ? v : null;
}

export const saveLanguage = (code) => store.set(LANG_KEY, code);
export const currentLanguage = () => lang;

/** True when the browser prefers a supported non-English language and the user never chose: ask once. */
export const shouldAskLanguage = () => !savedLanguage() && pickLanguage() !== 'en';

async function loadCatalog(code) {
  const parts = await Promise.all(
    config.dirs.map((dir) =>
      fetch(new URL(`${dir}${code}.json`, config.base))
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ),
  );
  return Object.assign({}, ...parts);
}

/**
 * Load the catalogs. `dirs` are URL prefixes ending in '/', resolved against
 * `base`; later dirs win on duplicate keys. Resolves with the active language.
 */
export async function initI18n({ dirs, base = typeof document !== 'undefined' ? document.baseURI : undefined, lang: wanted = savedLanguage() || pickLanguage() } = {}) {
  config = { dirs, base };
  fallback = await loadCatalog('en');
  let next = wanted === 'en' ? fallback : await loadCatalog(wanted);
  if (!Object.keys(next).length) {
    next = fallback;
    wanted = 'en';
  }
  catalog = next;
  lang = wanted;
  plurals = new Intl.PluralRules(lang);
  relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
  return lang;
}

/** Remember a choice and switch to it. */
export async function setLanguage(code) {
  if (!LANGUAGES[code]) return lang;
  saveLanguage(code);
  return initI18n({ ...config, lang: code });
}

/** Use catalogs directly (tests, or apps that bundle their strings). */
export function useCatalogs({ lang: code = 'en', catalog: active = {}, fallback: en = active } = {}) {
  lang = code;
  catalog = active;
  fallback = en;
  plurals = new Intl.PluralRules(lang);
  relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
}

export const onLanguage = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const has = (key) => (catalog[key] ?? fallback[key]) != null;

/**
 * Translate. Values are strings with `{name}` placeholders, or objects of
 * plural forms ({ one, other, … }) chosen by `n` (or `count`). Unknown keys
 * come back as the key itself so a missing string is visible, not blank.
 */
export function t(key, params = {}) {
  let value = catalog[key] ?? fallback[key];
  if (value == null) return key;
  if (typeof value === 'object') {
    const n = Number(params.n ?? params.count ?? 0);
    value = value[plurals.select(n)] ?? value.other ?? '';
  }
  return String(value).replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
}

/** Message for an error: translated by its `code` when there is one. */
export function tErr(err) {
  if (err?.code && has(err.code)) return t(err.code, err.params || {});
  return err?.message || String(err);
}

export const fmtNumber = (n) => new Intl.NumberFormat(lang).format(n);
export const fmtDateTime = (ts) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);

const UNITS = [
  ['year', 31536e6],
  ['month', 2592e6],
  ['week', 6048e5],
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
];

/** "3 days ago", "in 2 hours", "just now" in the active language. */
export function relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = ts - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return t('time.justNow');
}
