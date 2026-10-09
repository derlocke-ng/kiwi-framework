// Events for a feed, a market or a board, as React state: what this device
// already holds at once, then what the relays send, newest first. Replaceable
// and addressable events count once (the newest version). Blocked people's
// events are left out. loadMore() shows the next page and asks the relays for
// older events when the device has run out.
//
//   const feed = useEvents({ filters: [{ kinds: [1], '#t': ['seeds'] }], pageSize: 20 });
//   <Feed items={feed.events} hasMore={feed.hasMore} loading={feed.loading} onLoadMore={feed.loadMore} … />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addressOf, isEphemeralKind, supersedes } from '../shared/events.js';
import { matchFilters } from '../shared/nostr.mjs';
import { useBlocks, useKiwi } from './hooks';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}
export type Filter = Record<string, unknown>;

export interface EventsOptions {
  filters: Filter[];
  pageSize?: number;
  /** Drop events the app does not want (no proof of work, a tombstone, the wrong space). */
  accept?: (event: NostrEvent) => boolean;
  /** Leave blocked people's events out (default). */
  hideBlocked?: boolean;
}

export interface Events {
  events: NostrEvent[];
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
}

const FIRST_ANSWER = 4000; // stop showing "loading" when no relay answers by then

export function useEvents({ filters, pageSize = 20, accept, hideBlocked = true }: EventsOptions): Events {
  const { net } = useKiwi();
  const blocks = useBlocks();
  const key = JSON.stringify(filters);
  const store = useRef(new Map<string, NostrEvent>());
  const [version, setVersion] = useState(0);
  const [visible, setVisible] = useState(pageSize);
  const [loading, setLoading] = useState(true);
  const [reachedEnd, setReachedEnd] = useState(false);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  const add = useCallback((ev: NostrEvent) => {
    if (isEphemeralKind(ev.kind) || (acceptRef.current && !acceptRef.current(ev))) return false;
    const k = addressOf(ev) ?? ev.id;
    const cur = store.current.get(k);
    if (cur && (cur.id === ev.id || !supersedes(ev, cur))) return false;
    store.current.set(k, ev);
    return true;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `filters`
  useEffect(() => {
    store.current = new Map();
    setVersion((v) => v + 1);
    setVisible(pageSize);
    setLoading(true);
    setReachedEnd(false);
    let alive = true;
    let answered = false;
    const bump = () => alive && setVersion((v) => v + 1);
    // 1. what this device holds
    net.db.query(filters).then((list: NostrEvent[]) => {
      let changed = false;
      for (const ev of list) changed = add(ev) || changed;
      if (changed) bump();
    });
    // 2. everything stored from now on that matches: relay arrivals and this device's own posts
    const offStore = net.db.subscribe((ev: NostrEvent) => {
      if (matchFilters(filters, ev) && add(ev)) bump();
    });
    // 3. the relays: the newest page, then live
    const done = () => {
      if (answered || !alive) return;
      answered = true;
      setLoading(false);
      if (store.current.size < pageSize && net.pool.online) setReachedEnd(true);
    };
    const sub = net.pool.subscribe(
      filters.map((f) => ({ limit: pageSize, ...f })),
      { onevent: (ev: NostrEvent) => net.db.put(ev), oneose: () => setTimeout(done, 50) },
    );
    const timer = setTimeout(done, FIRST_ANSWER);
    return () => {
      alive = false;
      clearTimeout(timer);
      offStore();
      sub.close();
    };
  }, [key, net, pageSize, add]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `blocks` changes re-read the store
  const sorted = useMemo(() => {
    const list = [...store.current.values()].filter((ev) => !(hideBlocked && blocks?.isBlocked(ev.pubkey)));
    return list.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  }, [version, blocks, hideBlocked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `filters`
  const loadMore = useCallback(() => {
    const want = visible + pageSize;
    setVisible(want);
    if (sorted.length >= want || reachedEnd || !net.pool.online) return;
    const oldest = sorted.at(-1)?.created_at;
    // `until` is inclusive: the events already shown from that second come back too, so ask for that many more.
    const repeats = oldest ? sorted.filter((ev) => ev.created_at === oldest).length : 0;
    setLoading(true);
    net.pool
      .fetch(
        filters.map((f) => ({ ...f, limit: pageSize + repeats, ...(oldest ? { until: oldest } : {}) })),
        { ms: 6000 },
      )
      .then(async (list: NostrEvent[]) => {
        let fresh = 0;
        for (const ev of list) {
          const k = addressOf(ev) ?? ev.id;
          if (!store.current.has(k) || store.current.get(k)?.id !== ev.id) fresh++;
          await net.db.put(ev);
        }
        if (fresh === 0) setReachedEnd(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, pageSize, sorted, reachedEnd, net, key]);

  return { events: sorted.slice(0, visible), hasMore: sorted.length > visible || !reachedEnd, loading, loadMore };
}
