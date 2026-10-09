// A feed: newest first, more as you scroll (or with the button, which is
// always there for keyboards and slow phones), and a line when there is no
// more. Items are the caller's; useEvents() gives them from the relays.
import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../hooks';
import '../../shared/widgets.css';

export interface FeedProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  hasMore: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  /** Load the next page when the end of the feed scrolls into view. */
  autoLoad?: boolean;
  empty?: ReactNode;
}

export function Feed<T>({ items, keyOf, renderItem, hasMore, loading = false, onLoadMore, autoLoad = true, empty = null }: FeedProps<T>) {
  const t = useT();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const more = useRef(onLoadMore);
  more.current = onLoadMore;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items.length` re-arms the observer after each page
  useEffect(() => {
    const el = sentinel.current;
    if (!autoLoad || !el || !hasMore || loading || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more.current?.(), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [autoLoad, hasMore, loading, items.length]);
  return (
    <div className="feed">
      {items.length ? (
        <ul className="feed-list">
          {items.map((item) => (
            <li key={keyOf(item)} className="feed-item">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      ) : !loading ? (
        <div className="feed-empty">{empty ?? t('feed.empty')}</div>
      ) : null}
      <div ref={sentinel} className="feed-more">
        {hasMore ? (
          <button type="button" className="btn btn-sm" data-act="more" disabled={loading} onClick={() => onLoadMore?.()}>
            {loading ? t('common.loading') : t('feed.loadMore')}
          </button>
        ) : items.length ? (
          <p className="feed-end">{t('feed.end')}</p>
        ) : null}
      </div>
    </div>
  );
}
