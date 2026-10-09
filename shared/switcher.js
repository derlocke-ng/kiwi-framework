// The app switcher: one button on every page opens a sheet with the apps,
// the start page and the settings. Feels like an app: large targets, slides
// up from the bottom on phones, the hardware back button closes it.
//
//   mountSwitcher(button, { base: '../', current: 'loadout', hidden: () => [...], order: () => [...] })

import { t } from './i18n.js';

import { orderedMounts } from './apps.js';

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let sheet = null;
let opts = null;

function ensureStyles(base) {
  if (document.querySelector('link[data-switcher]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${base}shared/switcher.css` });
  link.dataset.switcher = '';
  document.head.append(link);
}

function render() {
  const { base, current, hidden, order, sprite } = opts;
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="${sprite}#${name}"></use></svg>`;
  const skip = new Set(hidden?.() || []);
  const apps = orderedMounts(order?.()).filter((a) => !skip.has(a.id));
  sheet.innerHTML = `
    <div class="switcher-backdrop" data-close></div>
    <nav class="switcher-sheet" role="dialog" aria-modal="true" aria-label="${h(t('switcher.title'))}">
      <div class="switcher-grip" aria-hidden="true"></div>
      <div class="switcher-head"><h2>${h(t('switcher.title'))}</h2><button type="button" class="switcher-close" data-close aria-label="${h(t('common.close'))}">${icon('x')}</button></div>
      <ul class="switcher-apps">
        <li><a href="${base}" class="${current === 'hub' ? 'current' : ''}">${icon('radio-tower')}<span>${h(t('switcher.home'))}</span></a></li>
        ${apps.map((a) => `<li><a href="${base}${a.id}/" class="${current === a.id ? 'current' : ''}" ${current === a.id ? 'aria-current="page"' : ''}>${icon(a.icon)}<span>${h(a.name)}${a.legacy ? ` <small>${h(t('hub.legacy'))}</small>` : ''}</span></a></li>`).join('')}
        <li><a href="${base}settings.html" class="${current === 'settings' ? 'current' : ''}">${icon('settings')}<span>${h(t('hub.settings'))}</span></a></li>
      </ul>
    </nav>`;
}

export function openSwitcher() {
  if (!sheet || sheet.classList.contains('open')) return;
  render();
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  history.pushState({ switcher: true }, '');
  sheet.querySelector('.switcher-apps a.current, .switcher-apps a')?.focus();
}

export function closeSwitcher({ viaHistory = false } = {}) {
  if (!sheet || !sheet.classList.contains('open')) return;
  sheet.classList.remove('open');
  setTimeout(() => (sheet.hidden = true), 220);
  if (!viaHistory && history.state?.switcher) history.back();
}

/**
 * @param {HTMLElement} button the trigger
 * @param {{ base: string, current: string, hidden?: () => string[], order?: () => string[], sprite?: string }} options
 *   base: path to the site root from this page ('./' on the hub, '../' in an app); sprite: icon sprite URL
 */
export function mountSwitcher(button, options) {
  opts = { sprite: 'icons.svg', ...options };
  ensureStyles(opts.base);
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'switcher';
    sheet.hidden = true;
    document.body.append(sheet);
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeSwitcher();
      else if (e.target.closest('a')) closeSwitcher({ viaHistory: true });
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSwitcher());
    window.addEventListener('popstate', () => closeSwitcher({ viaHistory: true }));
  }
  button.addEventListener('click', (e) => {
    e.preventDefault();
    openSwitcher();
  });
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', t('switcher.open'));
  button.title = t('switcher.open');
}
