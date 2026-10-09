// Toasts as a store: any code (a page, a hook, a notice) calls toast(), the
// <Toasts/> component renders them. Same classes as the design library's
// vanilla toasts, so the styles and the browser suites see no difference.
import { t, tErr } from '../shared/i18n.js';

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: string;
  action: ToastAction | null;
  leaving: boolean;
}

let items: ToastItem[] = [];
let next = 1;
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

export const toastStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get(): ToastItem[] {
    return items;
  },
};

export function dismiss(id: number): void {
  if (!items.some((x) => x.id === id && !x.leaving)) return;
  items = items.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  notify();
  setTimeout(() => {
    items = items.filter((x) => x.id !== id);
    notify();
  }, 250);
}

/** A toast; `action` is one thing to do about it. Returns its id. */
export function toast(message: string, kind = 'info', ms = 3200, action: ToastAction | null = null): number {
  const id = next++;
  items = [...items, { id, message, kind, action, leaving: false }];
  notify();
  setTimeout(() => dismiss(id), ms);
  return id;
}

/** An error as a toast, in words the person can read (the framework's errors are translated). */
export function toastError(err: unknown): number {
  return toast(tErr(err), 'error');
}

/** Put text on the clipboard and say so. */
export async function copyText(text: string, what: string = t('common.link')): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common.copied', { what }), 'success');
    return true;
  } catch {
    toast(t('common.copyFailed'), 'error');
    return false;
  }
}

/** Offer a text file to save. */
export function download(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
