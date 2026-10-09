// Checklists and inventories: add by typing or pasting ("2x milk",
// "# Section", "rice: 3"), tick off, count up and down, edit in place,
// delete with undo, drag or Alt+↑/↓ to reorder, a done section that
// remembers whether it is open. The list is the caller's: every change is
// a callback (local state, a board's events, anything).
import { useEffect, useRef, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { between, endOrders, formatQty, headerText, isHeader, parseItemText, sortItems, splitLines, stats } from '../../shared/items.js';
import { confirmDialog } from '../../shared/ui.js';
import { Icon } from '../components';
import { useT } from '../hooks';
import { toast } from '../toast';
import { MarkdownInline } from './Markdown';
import { useSortable } from './useSortable';
import '../../shared/widgets.css';

export interface ListItem {
  id: string;
  /** text; "# …" makes a section header */
  t: string;
  /** done: 0 or 1 */
  d: number;
  /** quantity (count lists) or null */
  q: number | null;
  /** order */
  o: number;
  /** created, ms */
  c: number;
  /** updated, ms */
  u?: number;
}
export type NewItem = Pick<ListItem, 't' | 'd' | 'q' | 'o'>;
type Result = Promise<unknown> | unknown;

export interface ItemListProps {
  items: ListItem[];
  mode?: 'check' | 'count';
  canEdit?: boolean;
  /** New items, already parsed and ordered after the rest. May resolve with their ids (the last one is scrolled into view). */
  onAdd?: (items: NewItem[]) => unknown;
  onUpdate?: (id: string, patch: Partial<ListItem>) => Result;
  onRemove?: (id: string) => Result;
  /** Puts a deleted item back (the toast's Undo); without it there is no Undo. */
  onRestore?: (item: ListItem) => Result;
  /** Whether the done section starts open, and where to keep the choice. */
  showDone?: boolean;
  onShowDone?: (open: boolean) => void;
}

const fail = (err: unknown) => toast(tErr(err), 'error');
const act = (p: Result) => Promise.resolve(p).catch(fail);

export function ItemList({ items, mode = 'check', canEdit = true, onAdd, onUpdate, onRemove, onRestore, showDone = true, onShowDone }: ItemListProps) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(showDone);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const scrollTo = useRef<string | null>(null);
  const byId = new Map(items.map((i) => [i.id, i]));

  useEffect(() => {
    const id = scrollTo.current;
    if (id && rows.current.get(id)) {
      rows.current.get(id)?.scrollIntoView({ block: 'nearest' });
      scrollTo.current = null;
    }
  });

  const sorted = mode === 'check' ? sortItems(items) : { active: [...items].sort((a, b) => a.o - b.o || a.c - b.c), done: [] as ListItem[] };
  // Reordering: the hook keeps the dragged and dropped order; the new position is saved between the neighbours.
  const sort = useSortable({ ids: sorted.active.map((i) => i.id), onMove: (id, order) => commitOrder(id, order), enabled: canEdit });
  const active = sort.order.map((id) => byId.get(id)).filter((i): i is ListItem => Boolean(i) && !i?.d);
  const done = sorted.done;
  const s = stats(items);
  const zero = items.filter((i) => !isHeader(i.t) && !i.q).length;
  const progress = !s.total
    ? ''
    : mode === 'check'
      ? t('list.progressCheck', { done: s.done, total: s.total })
      : `${t('list.progressCount', { n: s.total })}${zero ? ` · ${t('list.out', { n: zero })}` : ''}`;

  // ---- adding ----
  const addLines = async (lines: string[]) => {
    const parsed = lines.map((l) => parseItemText(l, mode)).filter((p) => p.t);
    if (!parsed.length || !onAdd) return;
    // Done items keep their place for when they're unchecked, so count them too.
    const orders = endOrders(items, parsed.length);
    try {
      const ids = await onAdd(parsed.map((p, i) => ({ t: p.t, d: p.d, q: p.q, o: orders[i] })));
      if (parsed.length > 1) toast(t('list.added', { n: parsed.length }), 'success');
      const last = Array.isArray(ids) ? (ids.at(-1) as string | undefined) : null;
      // The last new row comes into view: now if it is drawn already (the save took longer than the
      // redraw, as with relays), otherwise on the render that draws it. Never on some later render.
      const row = last ? rows.current.get(last) : null;
      if (row) row.scrollIntoView({ block: 'nearest' });
      else if (last) scrollTo.current = last;
    } catch (err) {
      fail(err);
    }
  };

  // ---- editing in place ----
  const editText = (item: ListItem) => (isHeader(item.t) ? item.t : mode === 'check' && item.q ? `${item.t} x${item.q}` : item.t);
  const finishEdit = async (id: string, value: string, save: boolean) => {
    setEditing(null);
    const cur = byId.get(id);
    const v = value.trim();
    if (!save || !cur || v === editText(cur)) return;
    if (!v) return act(onRemove?.(id));
    const p = parseItemText(v, mode);
    const explicit = parseItemText(v, 'check').q != null || (mode === 'count' && /[:=]\s*\d{1,4}$/.test(v));
    return act(onUpdate?.(id, { t: p.t, q: explicit || mode === 'check' ? p.q : cur.q }));
  };

  const remove = async (item: ListItem) => {
    try {
      await onRemove?.(item.id);
      const text = (isHeader(item.t) ? headerText(item.t) : item.t).slice(0, 40);
      toast(t('list.deleted', { text }), 'info', 5000, onRestore ? { label: t('common.undo'), onClick: () => void act(onRestore(item)) } : null);
    } catch (err) {
      fail(err);
    }
  };

  // ---- reordering ----
  const commitOrder = async (id: string, list: string[]) => {
    const i = list.indexOf(id);
    const o = between(byId.get(list[i - 1])?.o ?? null, byId.get(list[i + 1])?.o ?? null);
    try {
      if (o != null) await onUpdate?.(id, { o });
      else await Promise.all(list.map((x, n) => onUpdate?.(x, { o: n }))); // orders ran out of precision: renumber
    } catch (err) {
      fail(err);
      throw err;
    }
  };

  // ---- one row ----
  const row = (item: ListItem) => {
    const header = isHeader(item.t);
    const dragging = sort.draggingId === item.id;
    const cls = ['item', header && 'is-header', item.d && 'is-done', mode === 'count' && !header && !item.q && 'is-zero', dragging && 'dragging']
      .filter(Boolean)
      .join(' ');
    const text =
      editing === item.id ? (
        <input
          className="edit-input"
          defaultValue={editText(item)}
          maxLength={2000}
          aria-label={t('list.editItem')}
          // biome-ignore lint/a11y/noAutofocus: editing starts on the tapped row
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              e.currentTarget.dataset.cancel = '1';
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => void finishEdit(item.id, e.currentTarget.value, e.currentTarget.dataset.cancel !== '1')}
        />
      ) : (
        <div className="text" data-edit={canEdit ? '' : undefined} onClick={(e) => canEdit && !(e.target as HTMLElement).closest('a') && setEditing(item.id)}>
          <MarkdownInline source={header ? headerText(item.t) : item.t} />
        </div>
      );
    return (
      <li
        key={item.id}
        className={cls}
        data-id={item.id}
        ref={(el) => {
          if (el) rows.current.set(item.id, el);
          else rows.current.delete(item.id);
          sort.rowRef(item.id)(el);
        }}
        style={sort.rowStyle(item.id)}
      >
        {canEdit && !item.d ? (
          <button type="button" className="grip" aria-label={t('list.drag')} tabIndex={-1} {...sort.gripProps(item.id)}>
            <Icon name="grip-vertical" />
          </button>
        ) : null}
        {!header && mode === 'check' ? (
          <label className="check">
            <input
              key={item.d}
              type="checkbox"
              defaultChecked={!!item.d}
              disabled={!canEdit}
              aria-label={t('list.done')}
              onChange={(e) => void act(onUpdate?.(item.id, { d: e.target.checked ? 1 : 0 }))}
            />
            <span className="box">
              <Icon name="check" />
            </span>
          </label>
        ) : null}
        {text}
        {!header && mode === 'check' && item.q ? <span className="qty">{formatQty(item.q)}</span> : null}
        {!header && mode === 'count' ? (
          <div className="stepper">
            {canEdit ? (
              <button
                type="button"
                data-step="-1"
                aria-label={t('list.oneLess')}
                onClick={() => void act(onUpdate?.(item.id, { q: Math.max(0, (Number(item.q) || 0) - 1) }))}
              >
                <Icon name="minus" />
              </button>
            ) : null}
            <span className="count" title={t('list.count')}>
              {item.q ?? 0}
            </span>
            {canEdit ? (
              <button
                type="button"
                data-step="1"
                aria-label={t('list.oneMore')}
                onClick={() => void act(onUpdate?.(item.id, { q: (Number(item.q) || 0) + 1 }))}
              >
                <Icon name="plus" />
              </button>
            ) : null}
          </div>
        ) : null}
        {canEdit ? (
          <button type="button" className="icon-btn del" data-act="delete" aria-label={t('common.delete')} onClick={() => void remove(item)}>
            <Icon name="x" />
          </button>
        ) : null}
      </li>
    );
  };

  const doneAction = async (e: React.MouseEvent, which: 'uncheck' | 'clear') => {
    e.preventDefault(); // the buttons sit in the summary: don't fold the section
    if (
      which === 'clear' &&
      !(await confirmDialog({
        title: t('list.clearDialog.title'),
        message: t('list.clearDialog.text', { n: done.length }),
        confirm: t('list.clear'),
        danger: true,
      }))
    )
      return;
    await act(Promise.all(done.map((i) => (which === 'clear' ? onRemove?.(i.id) : onUpdate?.(i.id, { d: 0 })))));
  };

  return (
    <div className={`list ${mode === 'count' ? 'list-count' : 'list-check'}`}>
      {canEdit && onAdd ? (
        <form
          className="add-item"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const lines = splitLines(draft);
            setDraft('');
            void addLines(lines);
          }}
        >
          <input
            name="item"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData?.getData('text') || '';
              if (!text.includes('\n')) return;
              e.preventDefault();
              void addLines(splitLines(text));
            }}
            placeholder={mode === 'count' ? t('list.placeholderCount') : t('list.placeholderCheck')}
            aria-label={t('list.newItem')}
            enterKeyHint="send"
            maxLength={2000}
          />
          <button type="submit" className="btn btn-primary" aria-label={t('list.add')}>
            <Icon name="plus" />
          </button>
        </form>
      ) : null}
      <p className="list-meta">{progress}</p>
      <ul className="items" data-part="active" aria-label={t('list.items')} {...sort.listProps}>
        {active.map(row)}
      </ul>
      <p className="empty-list" hidden={items.length > 0}>
        {canEdit ? t('list.emptyEdit') : t('list.emptyView')}
      </p>
      <details
        className="done-box"
        hidden={done.length === 0}
        open={doneOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open === doneOpen) return;
          setDoneOpen(open);
          onShowDone?.(open);
        }}
      >
        <summary>
          <span>
            {t('list.done')} <span className="done-count">({done.length})</span>
          </span>
          {canEdit ? (
            <span className="done-actions">
              <button type="button" className="btn btn-sm btn-ghost" data-act="uncheck" onClick={(e) => void doneAction(e, 'uncheck')}>
                {t('list.uncheckAll')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" data-act="clear" onClick={(e) => void doneAction(e, 'clear')}>
                {t('list.clear')}
              </button>
            </span>
          ) : null}
        </summary>
        <ul className="items" data-part="done" aria-label={t('list.doneItems')}>
          {done.map(row)}
        </ul>
      </details>
    </div>
  );
}
