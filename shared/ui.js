// DOM helpers every page shares: selectors, escaping, icons, toasts, dialogs,
// downloads. Templates escape every interpolated value with h() unless it is
// trusted markup (icons, sanitized HTML).

import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape text for use inside HTML (element content and quoted attributes). */
export const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let spriteUrl = 'icons.svg';
/** Where this page's icon sprite lives (default: icons.svg next to the page). */
export const setSprite = (url) => (spriteUrl = url);
export const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="${spriteUrl}#${name}"></use></svg>`;

/** A toast; `action` is { label, href?, onClick? } for one thing to do about it. */
export function toast(message, kind = 'info', ms = 3200, action = null) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  const leave = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  if (action) {
    const a = document.createElement(action.href ? 'a' : 'button');
    a.className = 'toast-action';
    if (action.href) a.href = action.href;
    else a.type = 'button';
    a.textContent = action.label;
    a.addEventListener('click', () => {
      action.onClick?.();
      leave();
    });
    el.append(a);
  }
  box.append(el);
  setTimeout(leave, ms);
  return el;
}

export async function copyText(text, what = t('common.link')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common.copied', { what }), 'success');
    return true;
  } catch {
    toast(t('common.copyFailed'), 'error');
    return false;
  }
}

/**
 * Show a modal. `body` is trusted markup; returns { el, close, done } where
 * `done` resolves with the value passed to close().
 */
export function modal({ title, body, wide = false, onOpen }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal${wide ? ' modal-wide' : ''}`;
  dlg.innerHTML = `
    <div class="modal-head">
      <h2>${h(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="${h(t('common.close'))}">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>`;
  document.body.append(dlg);
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const close = (value) => {
    if (!dlg.open) return;
    dlg.close();
    dlg.remove();
    resolve(value);
  };
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) close(undefined);
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(undefined);
  });
  dlg.showModal();
  onOpen?.(dlg, close);
  const first = dlg.querySelector('[autofocus], input:not([type=hidden]), textarea, select');
  first?.focus();
  return { el: dlg, close, done };
}

export function confirmDialog({ title, message, confirm = t('common.ok'), danger = false }) {
  const m = modal({
    title,
    body: `<p class="modal-text">${h(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>${h(t('common.cancel'))}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${h(confirm)}</button>
      </div>`,
    onOpen: (el, close) => {
      el.querySelector('[data-ok]').addEventListener('click', () => close(true));
      el.querySelector('[data-ok]').focus();
    },
  });
  return m.done.then(Boolean);
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFilename(name, ext, fallback = 'file') {
  const base = String(name || fallback).replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || fallback;
  return `${base}.${ext}`;
}
