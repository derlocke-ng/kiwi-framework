// A dropdown menu anchored to a button, closed by a tap outside or Escape.
// Plain DOM: it lives on <body>, outside React's tree.
import { h, icon } from '../../shared/ui.js';

/**
 * @param {HTMLElement} anchor
 * @param {({ label: string, icon?: string, danger?: boolean, run: () => void } | '-')[]} items
 */
export function openMenu(anchor, items) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it, i) => (it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${h(it.label)}</span></button>`))
    .join('');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right + window.scrollX - width, window.scrollX + document.documentElement.clientWidth - width - 8))}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeMenus();
    const it = items[Number(b.dataset.i)];
    if (it !== '-') it.run();
  });
  menu.querySelector('button')?.focus();
  const outside = (e) => !menu.contains(e.target) && closeMenus();
  const escape = (e) => e.key === 'Escape' && closeMenus();
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
  });
  menu._cleanup = () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
}

export function closeMenus() {
  for (const m of document.querySelectorAll('.menu')) {
    m._cleanup?.();
    m.remove();
  }
}

/** A file name from a title: letters, digits, dashes. */
export function safeFilename(name, ext) {
  const base = String(name || 'board').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'board';
  return `${base}.${ext}`;
}
