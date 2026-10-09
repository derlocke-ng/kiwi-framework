// Markdown views. Everything rendered goes through DOMPurify (shared/markdown.js):
// notes come from other people, and this origin holds private keys.
import { useEffect, useMemo, useRef } from 'react';
import { renderInline, renderMarkdown } from '../../shared/markdown.js';
import { toggleTask } from '../../shared/mdtasks.js';
import '../../shared/widgets.css';

export interface MarkdownProps {
  source: string;
  /** Makes task-list checkboxes clickable; gets the source with that task flipped. */
  onChange?: (next: string) => void;
  /** Shown instead when the source is blank. */
  empty?: React.ReactNode;
  className?: string;
  id?: string;
}

/** A block of markdown: headings, lists, task lists, quotes, tables, code. */
export function Markdown({ source, onChange, empty = null, className = 'md', id }: MarkdownProps) {
  const ref = useRef<HTMLElement | null>(null);
  const html = useMemo(() => renderMarkdown(source), [source]);
  const latest = useRef({ source, onChange });
  latest.current = { source, onChange };
  const blank = !source.trim();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `html` is new checkboxes to wire
  useEffect(() => {
    const el = ref.current;
    if (!el || blank) return;
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    boxes.forEach((cb, i) => {
      cb.disabled = !onChange;
      cb.dataset.task = String(i);
    });
    // A native listener: the checkboxes are not React elements (they come from the rendered HTML).
    const handle = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const n = target.dataset?.task;
      const { source: src, onChange: change } = latest.current;
      if (n == null || !change) return;
      change(toggleTask(src, Number(n), target.checked));
    };
    el.addEventListener('change', handle);
    return () => el.removeEventListener('change', handle);
  }, [html, onChange, blank]);
  if (blank && empty != null)
    return (
      <article className={className} id={id}>
        {empty}
      </article>
    );
  return <article ref={ref} className={className} id={id} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** One line of inline markdown (bold, italic, code, links): list items, titles. */
export function MarkdownInline({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderInline(source), [source]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
