// What the chat's screens share: the private-message inbox of the identity
// (data/dm.js) and this device's nickname for rooms.
import { createContext, useCallback, useContext } from 'react';
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

/** The route after '#': the list, one conversation, one room, or the settings. */
export function parseRoute(hash: string): { page: 'home' } | { page: 'dm'; pk: string } | { page: 'room'; secret: string } | { page: 'settings' } {
  const m = hash.match(/^#\/(dm|room)\/([^/?]+)/);
  if (m?.[1] === 'dm' && /^[0-9a-f]{64}$/i.test(m[2])) return { page: 'dm', pk: m[2].toLowerCase() };
  if (m?.[1] === 'room' && m[2].length >= 8) return { page: 'room', secret: decodeURIComponent(m[2]) };
  if (hash.startsWith('#/settings')) return { page: 'settings' };
  return { page: 'home' };
}

/** The secret in a pasted room link or code. */
export function parseRoomInput(text: string): string | null {
  const s = String(text || '').trim();
  const m = s.match(/#\/room\/([^/?\s]+)/);
  const secret = m ? decodeURIComponent(m[1]) : s;
  return /^[A-Za-z0-9_-]{8,}$/.test(secret) ? secret : null;
}
