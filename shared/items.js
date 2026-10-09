// Lists for every app (the boards app's checklists and inventories, a market's
// shopping list): parsing typed and pasted items, ordering and exporting. Pure,
// so it runs in node tests and under any UI.
// An item is { id, t: text, d: 0|1 done, q: quantity|null, o: order, c: created, u: updated }.

/** @typedef {{ id: string, t: string, d: number, q: number | null, o: number, c: number, u?: number }} Item */

const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TASK = /^\[( |x|X)\]\s+/;
const QTY_BEFORE = /^(\d{1,4})\s*[x×*]\s+(.+)$/i;
const QTY_AFTER = /^(.+?)\s+[x×*]\s*(\d{1,4})$/i;
const QTY_COLON = /^(.+?)\s*[:=]\s*(\d{1,4})$/;
export const MAX_TEXT = 2000;

export const isHeader = (text) => /^#{1,3}\s+\S/.test(text || '');
export const headerText = (text) => String(text || '').replace(/^#{1,3}\s+/, '');

/**
 * Turn one typed or pasted line into item fields.
 * "2x milk", "milk ×2", "- [x] eggs", "batteries: 12" (count lists) …
 */
export function parseItemText(/** @type {string} */ line, /** @type {'check' | 'count'} */ mode = 'check') {
  let t = String(line || '').trim();
  let d = 0;
  let q = null;
  if (!isHeader(t)) {
    t = t.replace(MARKER, '');
    const task = t.match(TASK);
    if (task) {
      d = task[1] === ' ' ? 0 : 1;
      t = t.slice(task[0].length);
    }
    const m = t.match(QTY_BEFORE) || t.match(QTY_AFTER);
    if (m) {
      const before = QTY_BEFORE.test(t);
      q = Number(before ? m[1] : m[2]);
      t = (before ? m[2] : m[1]).trim();
    } else if (mode === 'count') {
      const c = t.match(QTY_COLON);
      if (c) {
        q = Number(c[2]);
        t = c[1].trim();
      }
    }
  }
  t = t.slice(0, MAX_TEXT);
  if (mode === 'count' && q == null && !isHeader(t)) q = 1;
  return { t, d, q };
}

/** Split pasted text into item lines, dropping blanks and a leading list title. */
export function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Order value between two neighbours (null = list edge). Returns null when the gap is exhausted.
 * @param {number | null} before
 * @param {number | null} after
 * @returns {number | null}
 */
export function between(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - 1;
  if (after == null) return before + 1;
  const mid = (before + after) / 2;
  return mid > before && mid < after && after - before > 1e-9 ? mid : null;
}

/**
 * Order values for n new items appended after everything else, keeping their order.
 * @param {{ o: number }[]} items
 * @param {number} n
 * @returns {number[]}
 */
export function endOrders(items, n) {
  const max = items.length ? Math.max(...items.map((i) => i.o)) : -1;
  return Array.from({ length: n }, (_, i) => Math.floor(max) + 1 + i);
}

/**
 * Active items by order, done items most recently checked first.
 * @template {Item} T
 * @param {T[]} items
 * @returns {{ active: T[], done: T[] }}
 */
export function sortItems(items) {
  const active = items.filter((i) => !i.d).sort((a, b) => a.o - b.o || a.c - b.c);
  const done = items.filter((i) => i.d).sort((a, b) => (b.u || 0) - (a.u || 0));
  return { active, done };
}

/**
 * @param {{ t: string, d: number }[]} items
 * @returns {{ total: number, done: number }}
 */
export function stats(items) {
  const real = items.filter((i) => !isHeader(i.t));
  return { total: real.length, done: real.filter((i) => i.d).length };
}

export function formatQty(q) {
  return q == null || q === '' ? '' : `×${q}`;
}

/** Plain markdown for copying into a chat or exporting. */
export function listToMarkdown(title, items, mode = 'check', untitled = 'Untitled') {
  const { active, done } = sortItems(items);
  const line = (i) => {
    if (isHeader(i.t)) return `\n#${i.t}`; // one level below the title
    if (mode === 'count') return `- ${i.t}: ${i.q ?? 0}`;
    return `- [${i.d ? 'x' : ' '}] ${i.t}${i.q ? ` ${formatQty(i.q)}` : ''}`;
  };
  const body = [...active, ...done].map(line).join('\n').replace(/^\n/, '');
  return `# ${title || untitled}\n\n${body}\n`;
}
