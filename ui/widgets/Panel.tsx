// A window over the page: what a link opens from a list (an entry, a listing,
// a person) slides in over it, and the list stays where it was underneath.
// Back in the panel's head, Escape, a tap beside it or a swipe to the right
// close it. On a phone it takes the whole screen; on a wide screen it is a
// side panel beside the list. It is an app's way of showing one thing without
// leaving the list, as an installed app does, not a page load.
//
//   {route.page === 'entry' ? <Panel title={t('fd.entryTitle')} onClose={() => goBack()}><EntryPage … /></Panel> : null}
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components';
import { useT } from '../hooks';
import '../../shared/widgets.css';

export interface PanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  id?: string;
}

const SWIPE = 80; // px to the right that close the panel

export function Panel({ title, onClose, children, id = 'panel' }: PanelProps) {
  const t = useT();
  const ref = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('panel-open');
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close.current();
    };
    addEventListener('keydown', onKey);
    return () => {
      root.classList.remove('panel-open');
      removeEventListener('keydown', onKey);
    };
  }, []);
  // a swipe to the right, begun near the panel's left edge, closes it (as a phone's back gesture does)
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const left = ref.current?.getBoundingClientRect().left || 0;
    start.current = touch.clientX - left < 40 ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    start.current = null;
    const touch = e.changedTouches[0];
    if (s && touch.clientX - s.x > SWIPE && Math.abs(touch.clientY - s.y) < SWIPE) close.current();
  };
  return createPortal(
    <>
      <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        id={id}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <header className="panel-head">
          <button type="button" className="icon-btn" data-act="panel-back" aria-label={t('common.back')} onClick={onClose}>
            <Icon name="chevron-left" />
          </button>
          <h2>{title}</h2>
        </header>
        <div className="panel-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}
