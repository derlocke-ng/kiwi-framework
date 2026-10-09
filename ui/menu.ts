// A dropdown menu anchored to a button, closed by a choice, a tap outside or
// Escape. Plain DOM on <body>, so a React page opens it from any handler:
//
//   openMenu(button, [{ label: t('db.edit'), icon: 'pencil', run: edit }, '-', { label, icon, danger: true, run }]);
import { h, icon } from '../shared/ui.js';

export type MenuItem = { label: string; icon?: string; danger?: boolean; run: () => unknown } | '-';

let cleanup: (() => void) | null = null;

export function closeMenus(): void {
  cleanup?.();
  cleanup = null;
  for (const m of document.querySelectorAll('.menu')) m.remove();
}

export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it, i) =>
      it === '-'
        ? '<hr>'
        : `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${h(it.label)}</span></button>`,
    )
    .join('');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right + window.scrollX - width, window.scrollX + document.documentElement.clientWidth - width - 8))}px`;
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenus();
    if (it !== '-') it.run();
  });
  menu.querySelector<HTMLButtonElement>('button')?.focus();
  const outside = (e: Event) => !menu.contains(e.target as Node) && closeMenus();
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenus();
  const timer = setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
  cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
