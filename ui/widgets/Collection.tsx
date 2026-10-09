// A collection of things to switch between (boards, markets, chats): pinned
// ones first, the rest in the caller's order, an optional search. Each card
// is the caller's markup; the collection adds the pin button beside it.
import { type ReactNode, useState } from 'react';
import { Icon } from '../components';
import { useT } from '../hooks';
import '../../shared/widgets.css';

export interface CollectionProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** With both, every card gets a pin button and pinned cards come first. */
  isPinned?: (item: T) => boolean;
  onPin?: (item: T, pinned: boolean) => void;
  /** The text the search box matches; without it there is no search box. */
  textOf?: (item: T) => string;
  /** Order within the pinned and the other cards (stable otherwise). */
  compare?: (a: T, b: T) => number;
  /** Shown when there are no items at all. */
  empty?: ReactNode;
}

export function Collection<T>({ items, keyOf, renderItem, isPinned, onPin, textOf, compare, empty = null }: CollectionProps<T>) {
  const t = useT();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = items.filter((item) => !q || (textOf?.(item) ?? '').toLowerCase().includes(q));
  const sorted = compare ? [...shown].sort(compare) : shown;
  const pinned = isPinned ? sorted.filter(isPinned) : [];
  const rest = isPinned ? sorted.filter((item) => !isPinned(item)) : sorted;
  const list = (part: T[], which: string) => (
    <ul className="collection" data-part={which}>
      {part.map((item) => {
        const on = Boolean(isPinned?.(item));
        return (
          <li key={keyOf(item)} className={`collection-item${on ? ' is-pinned' : ''}`} data-key={keyOf(item)}>
            <div className="collection-body">{renderItem(item)}</div>
            {isPinned && onPin ? (
              <button
                type="button"
                className="icon-btn pin-btn"
                aria-pressed={on}
                aria-label={on ? t('collection.unpin') : t('collection.pin')}
                title={on ? t('collection.unpin') : t('collection.pin')}
                onClick={() => onPin(item, !on)}
              >
                <Icon name={on ? 'pin-off' : 'pin'} />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="collection-wrap">
      {textOf && items.length ? (
        <input
          type="search"
          className="collection-search"
          placeholder={t('collection.search')}
          aria-label={t('collection.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {!items.length ? (
        <div className="collection-empty">{empty}</div>
      ) : !sorted.length ? (
        <p className="collection-empty">{t('collection.noMatch', { q: query.trim() })}</p>
      ) : pinned.length && rest.length ? (
        <>
          <h3 className="collection-head">{t('collection.pinned')}</h3>
          {list(pinned, 'pinned')}
          <h3 className="collection-head">{t('collection.others')}</h3>
          {list(rest, 'others')}
        </>
      ) : (
        list([...pinned, ...rest], 'all')
      )}
    </div>
  );
}
