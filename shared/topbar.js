// The top bar every page shares: the app switcher, the brand, and a slot on
// the right (status, account). One height, one look, on the hub and in apps.
//
//   mountTopbar(header, { base: '../', current: 'loadout', brand: { href: '#/', name: 'Loadout', mark: '<svg…>' }, right: '<a…>', hidden })

import { mountSwitcher } from './switcher.js';
import { t } from './i18n.js';

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ensureStyles(base) {
  if (document.querySelector('link[data-topbar]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${base}shared/topbar.css` });
  link.dataset.topbar = '';
  document.head.append(link);
}

/** The site's own mark, used when an app doesn't bring one. */
export const SITE_MARK = `<svg class="wjs-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8"/><circle class="wjs-mark-dot" cx="16" cy="16" r="2.5"/></svg>`;

/**
 * Render into `header` (which gets the class `wjs-top`) and wire the switcher.
 * `right` is trusted markup for the right-hand side; `brand.name` may contain a
 * `<span class="wjs-brand-ext">` suffix when `brand.html` is given instead.
 */
/**
 * The account button: the first letter of the alias in a circle when signed
 * in, a user icon otherwise. `label` is the signed-out title (default: the
 * device-key hint). Pure markup, the same in every top bar.
 */
export function accountLink({ href, identity, label = null, id = 'accountLink', sprite = 'icons.svg' }) {
  const alias = identity?.alias;
  const title = alias ? t('app.signedInAs', { alias }) : label || t('app.deviceKeyBadge');
  const body = alias ? `<span class="wjs-avatar" aria-hidden="true">${h(alias[0].toUpperCase())}</span>` : `<svg class="icon" aria-hidden="true"><use href="${h(sprite)}#user"></use></svg>`;
  return `<a class="icon-btn" href="${h(href)}" id="${h(id)}" title="${h(title)}" aria-label="${h(title)}">${body}</a>`;
}

export function mountTopbar(header, { base, current, brand, right = '', hidden, sprite = 'icons.svg' }) {
  ensureStyles(base);
  header.classList.add('wjs-top');
  header.innerHTML = `
    <button type="button" class="wjs-icon-btn wjs-switcher" id="switcher"><svg class="icon" aria-hidden="true"><use href="${sprite}#layout-grid"></use></svg></button>
    <a class="wjs-brand" href="${h(brand.href)}" aria-label="${h(brand.label || brand.name)}">${brand.mark || SITE_MARK}<span class="wjs-brand-name">${brand.html || h(brand.name)}</span></a>
    <span class="wjs-spacer"></span>
    <div class="wjs-right">${right}</div>`;
  mountSwitcher(header.querySelector('#switcher'), { base, current, hidden, sprite });
  header.querySelector('.wjs-switcher').title = t('switcher.open');
  return header;
}
