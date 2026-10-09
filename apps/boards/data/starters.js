// The starters on the start page: a grocery list, a to-do list, a pantry and
// a note, each with a template. Their titles and templates come from the
// catalog unless the person changed them in the app's settings.
import { parseItemText, splitLines, endOrders } from '../../../shared/items.js';
import { Board } from './boards.js';

export const STARTER_KEYS = [
  { kind: 'check', key: 'groceries' },
  { kind: 'check', key: 'todo' },
  { kind: 'count', key: 'pantry' },
  { kind: 'note', key: 'notes' },
];

/** Board kinds: a checklist, an inventory (counts) or a note. */
export const KINDS = {
  check: { icon: 'list-checks' },
  count: { icon: 'package' },
  note: { icon: 'notebook-pen' },
};
export const kindOf = (b) => (b.type === 'note' ? 'note' : b.mode === 'count' ? 'count' : 'check');

/**
 * The starters with their titles and template content: defaults from the catalog, overridden by the person's settings.
 * @param {any} settings
 * @param {(key: string) => string} t
 */
export function starters(settings, t) {
  const custom = settings?.get('starters', {}) || {};
  return STARTER_KEYS.map((s) => {
    const o = custom[s.key] || {};
    return { ...s, title: o.title ?? t(`home.starter.${s.key}`), text: o.text ?? t(`home.template.${s.key}`), hint: t(`home.starter.${s.key}Text`) };
  });
}

/**
 * Fill a fresh board with a starter's template.
 * @param {{ pub: string, w?: string|null, k?: string|null }} entry
 * @param {'check'|'count'|'note'} kind
 * @param {string} text
 * @param {any} net
 */
export async function fillBoard(entry, kind, text, net) {
  if (!text?.trim()) return;
  const board = new Board(entry, net);
  if (kind === 'note') return board.setDoc(text);
  const mode = kind === 'count' ? 'count' : 'check';
  const parsed = splitLines(text)
    .map((l) => parseItemText(l, mode))
    .filter((p) => p.t);
  const orders = endOrders([], parsed.length);
  await Promise.all(parsed.map((p, i) => board.addItem({ ...p, o: orders[i] })));
}
