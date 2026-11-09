// What the chat's screens share: the private-message inbox of the identity
// (data/dm.js) and this device's nickname for rooms.

import { createContext, useCallback, useContext } from 'react';
import { parseGroupLink } from '../../shared/groups.js';
import { hintQuery, readHints } from '../../shared/relaylists.js';
import { store } from '../../shared/util.js';
import { useTick } from '../../ui/hooks';

export const DmContext = createContext<any>(null);

/** The inbox (data/dm.js). */
export function useDm(): any {
  const dm = useContext(DmContext);
  if (!dm) throw new Error('useDm outside the chat app');
  return dm;
}

/** A number that grows on every message, read mark or forgotten conversation: a dependency for reading the store again. */
export function useDmVersion(dm: any): number {
  return useTick(useCallback((fn: () => void) => dm.onChange(fn), [dm]));
}

const NICK_KEY = 'chat.nick';
export const savedNick = (): string => String(store.get(NICK_KEY, '') || '');
export const saveNick = (nick: string): void => {
  store.set(NICK_KEY, nick.trim().slice(0, 24));
};

export type Route =
  | { page: 'home'; tab: 'messages' | 'groups' }
  | { page: 'dm'; pk: string; draft: string }
  | { page: 'room'; secret: string; relays: string[] }
  | { page: 'group'; pub: string; host: string; invite: string; name: string; relays: string[] }
  | { page: 'settings' };

/** The route after '#': the lists (messages or groups), one conversation, one room, one group, or the settings. */
export function parseRoute(hash: string): Route {
  const g = parseGroupLink(hash);
  if (hash.startsWith('#/group/') && g) return { page: 'group', ...g };
  const m = hash.match(/^#\/(dm|room)\/([^/?]+)/);
  if (m?.[1] === 'dm' && /^[0-9a-f]{64}$/i.test(m[2]))
    return { page: 'dm', pk: m[2].toLowerCase(), draft: String(new URLSearchParams(hash.split('?')[1] || '').get('text') || '').slice(0, 2000) };
  if (m?.[1] === 'room' && m[2].length >= 8)
    return { page: 'room', secret: decodeURIComponent(m[2]), relays: readHints(new URLSearchParams(hash.split('?')[1] || '')) };
  if (hash.startsWith('#/settings')) return { page: 'settings' };
  if (hash.startsWith('#/groups')) return { page: 'home', tab: 'groups' };
  return { page: 'home', tab: 'messages' };
}

/** What a pasted link or code opens: a room, a group, or nothing. */
export function parseJoinInput(text: string): string | null {
  const s = String(text || '').trim();
  const g = parseGroupLink(s);
  if (g) return `#/group/${g.pub}/${g.host}/${g.invite}/${encodeURIComponent(g.name)}${g.relays.length ? `?${hintQuery(g.relays)}` : ''}`;
  const m = s.match(/#\/room\/([^/?\s]+)/);
  const secret = m ? decodeURIComponent(m[1]) : s;
  const relays = m ? readHints(new URLSearchParams(s.split('?')[1] || '')) : [];
  return /^[A-Za-z0-9_-]{8,}$/.test(secret) ? `#/room/${encodeURIComponent(secret)}${relays.length ? `?${hintQuery(relays)}` : ''}` : null;
}
