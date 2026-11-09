// What the market's screens share: the data (data/market.js), reports on the
// listings shown (shared/social.js), the app's settings in the account, and the
// hooks that list and open listings.
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { countryName } from '../../shared/countries.js';
import { fingerprint } from '../../shared/events.js';
import { currentLanguage } from '../../shared/i18n.js';
import type { Social } from '../../shared/social.js';
import { useIdentity, usePeople, useT, useTick } from '../../ui/hooks';
import { useEvents } from '../../ui/useEvents';
import { useOpened } from '../../ui/useOpened';
import type { MarketData } from './data/market.js';

export interface MarketState {
  data: MarketData;
  social: Social;
  prefs: any;
}

export const MarketContext = createContext<MarketState | null>(null);

export function useMarket(): MarketState {
  const state = useContext(MarketContext);
  if (!state) throw new Error('useMarket outside the market app');
  return state;
}

/** Reports on the listings shown: re-renders when one arrives. */
export function useSocial(): Social {
  const { social } = useMarket();
  useTick(useCallback((fn: () => void) => social.onChange(fn), [social]));
  return social;
}

/** The app's settings in the account (my country, a default contact, saved listings), re-rendering on every change. */
export function usePrefs(): any {
  const { prefs } = useMarket();
  useTick(useCallback((fn: () => void) => prefs.onChange(fn), [prefs]));
  return prefs;
}

/**
 * Listings from `filters`: opened, the unreadable, deleted and expired left out (my own expired ones stay,
 * to renew), newest first; their reports followed.
 */
export function useListings(filters: Record<string, unknown>[], pageSize = 24) {
  const { data, social } = useMarket();
  const me = useIdentity();
  const list = useEvents({ filters, pageSize, accept: (ev) => data.inSpace(ev) });
  const opened = useOpened(list.events, (ev) => data.openListing(ev));
  const listings: any[] = useMemo(
    () =>
      list.events
        .map((ev) => opened.get(ev.id))
        .filter((l: any) => l && !l.deleted && (!l.expired || l.pubkey === me.pk))
        .sort((a: any, b: any) => b.at - a.at),
    [list.events, opened, me.pk],
  );
  useEffect(() => {
    social.watch(listings.map((l: any) => l.address));
  }, [listings, social]);
  return { ...list, listings, opening: list.events.some((ev) => !opened.has(ev.id)) };
}

/** What to call a seller: me, a friend by the name they gave, else the name they wrote, else their key. */
export function useNameOf(): (pk: string, written?: string) => string {
  const t = useT();
  const me = useIdentity();
  const people = usePeople();
  return (pk: string, written = '') => {
    if (pk === me.pk) return me.alias ? `${me.alias} (${t('mk.you')})` : t('mk.you');
    if (people?.isFriend(pk)) return people.nameOf(pk);
    return written || fingerprint(pk);
  };
}

/** A destination's name: a country in the page's language, or the EU, or worldwide. */
export function usePlaceName(): (code: string) => string {
  const t = useT();
  const lang = currentLanguage();
  return (code: string) => (code === 'EU' ? t('mk.region.EU') : code === 'WW' ? t('mk.region.WW') : countryName(code, lang));
}
