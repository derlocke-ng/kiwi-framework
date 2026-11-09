// What the feed's screens share: the data (data/feed.js), what people do with
// the entries (shared/social.js), the app's settings in the account; entries
// and comments open as their keys arrive with useOpened (ui/useOpened.ts).
import { createContext, useCallback, useContext } from 'react';
import { fingerprint } from '../../shared/events.js';
import { useIdentity, usePeople, useT, useTick } from '../../ui/hooks';

export { useOpened } from '../../ui/useOpened';

import type { Social } from '../../shared/social.js';
import type { FeedData } from './data/feed.js';

export interface FeedState {
  data: FeedData;
  social: Social;
  prefs: any;
}

export const FeedContext = createContext<FeedState | null>(null);

export function useFeed(): FeedState {
  const state = useContext(FeedContext);
  if (!state) throw new Error('useFeed outside the feed app');
  return state;
}

/** Likes, comments and reports: re-renders when any changes. */
export function useSocial(): Social {
  const { social } = useFeed();
  useTick(useCallback((fn: () => void) => social.onChange(fn), [social]));
  return social;
}

/** The app's settings in the account, re-rendering on every change. */
export function usePrefs(): any {
  const { prefs } = useFeed();
  useTick(useCallback((fn: () => void) => prefs.onChange(fn), [prefs]));
  return prefs;
}

/** What to call the author of something: me, a friend by the name they gave, else the name they wrote, else their key. */
export function useNameOf(): (pk: string, written?: string) => string {
  const t = useT();
  const me = useIdentity();
  const people = usePeople();
  return (pk: string, written = '') => {
    if (pk === me.pk) return me.alias ? `${me.alias} (${t('fd.you')})` : t('fd.you');
    if (people?.isFriend(pk)) return people.nameOf(pk);
    return written || fingerprint(pk);
  };
}

/** The label of an audience: everyone in the space, friends, a circle by name, only me, or "shared with you". */
export function useAudienceLabel(): (audience: string | null, spaceName?: string) => string {
  const t = useT();
  const people = usePeople();
  return (audience: string | null, spaceName = '') => {
    if (audience === 'space') return t('fd.aud.space', { space: spaceName });
    if (audience === 'friends') return t('fd.aud.friends');
    if (audience === 'me') return t('fd.aud.me');
    if (audience?.startsWith('c:')) {
      const c = people?.circles().find((x: any) => x.id === audience.slice(2));
      return c ? t('fd.aud.circle', { name: c.name }) : t('fd.aud.circleGone');
    }
    return t('fd.aud.shared');
  };
}

/** The audiences this person can post to on this mount: the space (when there is one), friends, each circle, only me. */
export function useAudienceChoices(hasSpace: boolean): string[] {
  const people = usePeople();
  return [...(hasSpace ? ['space'] : []), 'friends', ...(people?.circles() || []).map((c: any) => `c:${c.id}`), 'me'];
}
