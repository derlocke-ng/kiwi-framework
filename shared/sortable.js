// Drag to reorder, for plain pages; the React widgets have useSortable with
// the same rules. The list, which never moves, holds the pointer: rows are
// reordered under it, and a moved element would lose the capture (the drag
// then stopped following the finger). The neighbours move, never the dragged
// row. Distances are in page coordinates, so autoscroll near the screen edges
// keeps the row under the finger; it keeps scrolling while the finger rests
// at an edge, and only towards the edge the finger moves to. While a row is
// dragged, scroll anchoring and text selection are off (html.wjs-dragging in
// widgets.css). Alt+↑ / Alt+↓ move the focused row.
//
//   const sorter = sortable(ul, {
//     onDrop: ({ id, before, after, moved }) => …,   // data-id of the row and its new neighbours (null at an end)
//   });
//   sorter.dragging()   // true while a row is held: redraw after onDrop, not during
//   sorter.destroy()
//
// Rows are the list's children with a data-id; a drag starts on `grip` inside one.

const EDGE = 70;

/**
 * @param {HTMLElement} list
 * @param {{ grip?: string, enabled?: () => boolean, onDrop: (move: { id: string, before: string | null, after: string | null, moved: boolean, el: HTMLElement }) => unknown }} options
 */
export function sortable(list, { grip = '.grip', enabled = () => true, onDrop }) {
  let drag = null;
  const rowOf = (node) => {
    let el = node instanceof Element ? node : null;
    while (el && el.parentElement !== list) el = el.parentElement;
    return el?.dataset.id ? el : null;
  };
  const idOf = (el) => el?.dataset.id ?? null;
  const finish = (el, moved) => onDrop({ id: el.dataset.id, before: idOf(el.previousElementSibling), after: idOf(el.nextElementSibling), moved, el });

  function down(e) {
    const handle = e.target.closest?.(grip);
    const li = handle && rowOf(handle);
    if (!li || e.button > 0 || drag || !enabled()) return;
    e.preventDefault();
    try {
      list.setPointerCapture(e.pointerId);
    } catch {}
    drag = { li, pointerId: e.pointerId, startPrev: li.previousElementSibling, startY: e.clientY + scrollY, clientY: e.clientY, fromY: e.clientY, gap: parseFloat(getComputedStyle(list).rowGap) || 0, frame: 0 };
    li.classList.add('dragging');
    document.documentElement.classList.add('wjs-dragging');
    drag.frame = requestAnimationFrame(tick);
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.clientY = e.clientY;
    place();
  }

  function up(e) {
    if (drag && e.pointerId === drag.pointerId) drop();
  }

  /** Move the row to where the pointer is, swapping it past every neighbour it has crossed half of. */
  function place() {
    const { li, gap } = drag;
    const y = drag.clientY + scrollY;
    for (;;) {
      const next = li.nextElementSibling;
      const prev = li.previousElementSibling;
      const dy = y - drag.startY;
      if (next && dy > (next.offsetHeight + gap) / 2) {
        list.insertBefore(next, li);
        drag.startY += next.offsetHeight + gap;
      } else if (prev && dy < -(prev.offsetHeight + gap) / 2) {
        list.insertBefore(prev, li.nextElementSibling);
        drag.startY -= prev.offsetHeight + gap;
      } else break;
    }
    li.style.transform = `translateY(${y - drag.startY}px)`;
  }

  function tick() {
    if (!drag) return;
    const y = drag.clientY;
    const toTop = y < EDGE && y < drag.fromY - 8;
    const toBottom = y > innerHeight - EDGE && y > drag.fromY + 8;
    const speed = toTop ? -Math.ceil((EDGE - y) / 6) : toBottom ? Math.ceil((y - (innerHeight - EDGE)) / 6) : 0;
    if (speed) {
      scrollBy(0, speed);
      place();
    }
    drag.frame = requestAnimationFrame(tick);
  }

  function release() {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.frame);
    document.documentElement.classList.remove('wjs-dragging');
    try {
      list.releasePointerCapture(d.pointerId);
    } catch {}
    d.li.style.transform = '';
    d.li.classList.remove('dragging');
    return d;
  }

  function drop() {
    const d = release();
    finish(d.li, d.li.previousElementSibling !== d.startPrev);
  }

  function key(e) {
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || drag || !enabled()) return;
    const li = rowOf(e.target);
    const sib = e.key === 'ArrowUp' ? li?.previousElementSibling : li?.nextElementSibling;
    if (!sib) return;
    e.preventDefault();
    const focused = document.activeElement;
    list.insertBefore(li, e.key === 'ArrowUp' ? sib : sib.nextElementSibling);
    if (focused instanceof HTMLElement && li.contains(focused) && document.activeElement !== focused) focused.focus();
    finish(li, true);
  }

  const events = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['lostpointercapture', up],
    ['keydown', key],
  ];
  for (const [type, fn] of events) list.addEventListener(type, fn);
  return {
    dragging: () => drag !== null,
    destroy() {
      for (const [type, fn] of events) list.removeEventListener(type, fn);
      if (drag) release();
    },
  };
}
