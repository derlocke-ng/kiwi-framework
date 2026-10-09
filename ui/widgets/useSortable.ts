// Reordering by dragging a handle, or with Alt+↑/↓ on a focused row. Used by
// the item list and the settings' app order; any list of rows can use it.
//
//   const sort = useSortable({ ids, onMove: (id, order) => save(order) });
//   <ul {...sort.listProps}>{sort.order.map((id) => (
//     <li key={id} data-id={id} ref={sort.rowRef(id)} style={sort.rowStyle(id)} className={sort.draggingId === id ? 'dragging' : ''}>
//       <button className="grip" {...sort.gripProps(id)} />…
//
// The list, which never moves, holds the pointer: rows are reordered under
// it, and an element that moves loses the capture (a drag then stops
// following the finger). Distances are in page coordinates, so autoscroll
// near the screen edges keeps the row under the finger; it keeps scrolling
// while the finger rests at the edge, and only towards the edge the finger
// moves to. While a row is held, html gets .wjs-dragging (no scroll
// anchoring, no text selection; widgets.css).
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

export interface Sortable {
  /** The ids in the order to show: the dragged order while dragging, the dropped one until `ids` changes. */
  order: string[];
  draggingId: string | null;
  rowStyle: (id: string) => CSSProperties | undefined;
  rowRef: (id: string) => (el: HTMLElement | null) => void;
  gripProps: (id: string) => { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  listProps: {
    ref: (el: HTMLElement | null) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

interface Drag {
  id: string;
  pointerId: number;
  startY: number;
  clientY: number;
  fromY: number;
  order: string[];
  origin: string[];
  frame: number;
}

const EDGE = 70;
/** The space between rows, which a swap has to cross too. */
const gapOf = (el: HTMLElement | null) => Number.parseFloat(el ? getComputedStyle(el).rowGap : '0') || 0;

export function useSortable({ ids, onMove, enabled = true }: { ids: string[]; onMove: (id: string, order: string[]) => unknown; enabled?: boolean }): Sortable {
  const [view, setView] = useState<{ id: string; order: string[]; offset: number } | null>(null);
  const [dropped, setDropped] = useState<string[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const list = useRef<HTMLElement | null>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const key = ids.join('\u0000');

  // A drop shows its order until the new order arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger
  useEffect(() => setDropped(null), [key]);

  const commit = useCallback((id: string, order: string[]) => {
    setDropped(order);
    Promise.resolve(move.current(id, order)).catch(() => setDropped(null));
  }, []);

  const place = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const y = d.clientY + window.scrollY;
    const g = gapOf(list.current);
    for (;;) {
      const i = d.order.indexOf(d.id);
      const dy = y - d.startY;
      const next = rows.current.get(d.order[i + 1]);
      const prev = rows.current.get(d.order[i - 1]);
      if (next && dy > (next.offsetHeight + g) / 2) {
        d.order = [...d.order];
        [d.order[i], d.order[i + 1]] = [d.order[i + 1], d.order[i]];
        d.startY += next.offsetHeight + g;
      } else if (prev && dy < -(prev.offsetHeight + g) / 2) {
        d.order = [...d.order];
        [d.order[i], d.order[i - 1]] = [d.order[i - 1], d.order[i]];
        d.startY -= prev.offsetHeight + g;
      } else break;
    }
    setView({ id: d.id, order: d.order, offset: y - d.startY });
  }, []);
  const tick = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const y = d.clientY;
    const up = y < EDGE && y < d.fromY - 8;
    const down = y > window.innerHeight - EDGE && y > d.fromY + 8;
    const speed = up ? -Math.ceil((EDGE - y) / 6) : down ? Math.ceil((y - (window.innerHeight - EDGE)) / 6) : 0;
    if (speed) {
      window.scrollBy(0, speed);
      place();
    }
    d.frame = requestAnimationFrame(tick);
  }, [place]);

  const shown = view?.order ?? dropped ?? ids;
  const start = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (!enabled || e.button > 0 || drag.current || !list.current) return;
    e.preventDefault();
    try {
      list.current.setPointerCapture(e.pointerId);
    } catch {}
    const order = shown.filter((x) => ids.includes(x));
    drag.current = { id, pointerId: e.pointerId, startY: e.clientY + window.scrollY, clientY: e.clientY, fromY: e.clientY, order, origin: order, frame: 0 };
    document.documentElement.classList.add('wjs-dragging');
    setView({ id, order, offset: 0 });
    drag.current.frame = requestAnimationFrame(tick);
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(d.frame);
    document.documentElement.classList.remove('wjs-dragging');
    try {
      list.current?.releasePointerCapture(d.pointerId);
    } catch {}
    setView(null);
    if (d.order.join() !== d.origin.join()) commit(d.id, d.order);
  };
  // Leaving the page mid-drag leaves nothing behind.
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
      document.documentElement.classList.remove('wjs-dragging');
    },
    [],
  );

  return {
    order: shown,
    draggingId: view?.id ?? null,
    rowStyle: (id) => (view?.id === id ? { transform: `translateY(${view.offset}px)` } : undefined),
    rowRef: (id) => (el) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    gripProps: (id) => ({ onPointerDown: (e) => start(e, id) }),
    listProps: {
      ref: (el) => {
        list.current = el;
      },
      onKeyDown: (e) => {
        if (!enabled || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
        const order = [...shown];
        const i = id ? order.indexOf(id) : -1;
        const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (!id || i < 0 || j < 0 || j >= order.length) return;
        e.preventDefault();
        [order[i], order[j]] = [order[j], order[i]];
        commit(id, order);
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;
        d.clientY = e.clientY;
        place();
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    },
  };
}
