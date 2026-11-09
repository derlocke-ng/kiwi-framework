// The feed: the space's entries ("Everyone"), friends' (and mine, whoever they
// are for), or mine alone; newest first, more as you scroll; a search over
// text, hashtags and names. What this device holds no key for is not shown.
import { useEffect, useMemo, useState } from 'react';
import { KINDS } from '../../../shared/events.js';
import { store } from '../../../shared/util.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, usePeople, useSpace, useT } from '../../../ui/hooks';
import { useEvents } from '../../../ui/useEvents';
import { Feed } from '../../../ui/widgets/Feed';
import { useFeed, useOpened, useSocial } from '../state';
import { Compose } from './Compose';
import { EntryCard } from './EntryCard';

type Tab = 'space' | 'friends' | 'mine';

/** Entries matching a search: in the text, a hashtag (with or without #), or the writer's name. */
export const matches = (entry: any, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const tag = s.replace(/^#/, '');
  return entry.text.toLowerCase().includes(s) || entry.tags.includes(tag) || entry.name.toLowerCase().includes(s);
};

/** A list of entries from `filters`: opened, the unreadable and deleted left out, their likes and comments followed. */
export function useEntries(filters: Record<string, unknown>[], only: (entry: any) => boolean = () => true) {
  const { data, social } = useFeed();
  const feed = useEvents({ filters, pageSize: 20, accept: (ev) => data.inSpace(ev) });
  const opened = useOpened(feed.events, (ev) => data.openEntry(ev));
  const entries: any[] = useMemo(
    () =>
      feed.events
        .map((ev) => opened.get(ev.id))
        .filter((e: any) => e && !e.deleted && only(e))
        .sort((a: any, b: any) => b.at - a.at),
    [feed.events, opened, only],
  );
  useEffect(() => {
    social.watch(entries.map((e: any) => e.address));
  }, [entries, social]);
  return { ...feed, entries, opening: feed.events.some((ev) => !opened.has(ev.id)) };
}

const isSpace = (e: any) => e.audience === 'space';
const anyEntry = () => true;

export function FeedView() {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const space = useSpace();
  useSocial();
  const tabs: Tab[] = space ? ['space', 'friends', 'mine'] : ['friends', 'mine'];
  const tabKey = `feed.tab.${kiwi.current}`;
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = store.get(tabKey) as Tab;
    return tabs.includes(saved) ? saved : tabs[0];
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    store.set(tabKey, next);
  };
  const [query, setQuery] = useState('');
  const [compose, setCompose] = useState<{ existing: any } | null>(null);
  const inSpace = space ? { '#a': [space.address] } : {};
  const friends = (people?.friends() || []).map((f: any) => f.pk);
  const filters =
    tab === 'space'
      ? [{ kinds: [KINDS.FEED_ENTRY], ...inSpace }]
      : tab === 'friends'
        ? [{ kinds: [KINDS.FEED_ENTRY], authors: [id.pk, ...friends], ...inSpace }]
        : [{ kinds: [KINDS.FEED_ENTRY], authors: [id.pk], ...inSpace }];
  const list = useEntries(filters, tab === 'space' ? isSpace : anyEntry);
  const shown = list.entries.filter((e: any) => matches(e, query));
  const empty = query
    ? t('fd.noMatch')
    : t(tab === 'space' ? 'fd.emptySpace' : tab === 'friends' ? (friends.length ? 'fd.emptyFriends' : 'fd.noFriends') : 'fd.emptyMine');
  return (
    <div className="feed-page">
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label={t('fd.show')} id="feedTabs">
          {tabs.map((x) => (
            <label key={x}>
              <input type="radio" name="tab" value={x} checked={tab === x} onChange={() => setTab(x)} />
              <span>{t(`fd.tab.${x}`, { space: space?.name || '' })}</span>
            </label>
          ))}
        </div>
        <input
          className="search"
          id="search"
          type="search"
          placeholder={t('fd.search')}
          aria-label={t('fd.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn-primary fab" id="newEntry" onClick={() => setCompose({ existing: null })}>
          <Icon name="plus" />
          <span>{t('fd.new')}</span>
        </button>
      </div>
      <Feed
        items={shown}
        keyOf={(e: any) => e.address}
        renderItem={(e: any) => <EntryCard entry={e} onEdit={(entry) => setCompose({ existing: entry })} onTag={(tag) => setQuery(`#${tag}`)} />}
        hasMore={list.hasMore}
        loading={list.loading || list.opening}
        onLoadMore={list.loadMore}
        empty={<p className="empty">{empty}</p>}
      />
      {compose ? (
        <Compose
          existing={compose.existing}
          onClose={() => setCompose(null)}
          // an entry for friends, a circle or only me is not in "Everyone": show the writer where it went
          onPosted={(audience) => tab === 'space' && audience !== 'space' && setTab('mine')}
        />
      ) : null}
    </div>
  );
}
