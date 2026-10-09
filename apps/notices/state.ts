// The app's settings (kind 30791, d = 'devboard'): saved notes, defaults for
// new notes and whether collapsed notes show opened. They follow the account.
import { createContext, useCallback, useContext } from 'react';
import { useTick } from '../../ui/hooks';
import { DURATIONS, LIMITS } from './data/notices.js';

export const PrefsContext = createContext<any>(null);

export function usePrefs(): any {
  const prefs = useContext(PrefsContext);
  if (!prefs) throw new Error('usePrefs outside the notices app');
  useTick(useCallback((fn: () => void) => prefs.onChange(fn), [prefs]));
  return prefs;
}

/** What the settings prefill and how the board behaves. */
export const defaults = (prefs: any) => ({
  type: prefs?.get('type') === 'available' ? 'available' : 'hiring',
  contact: String(prefs?.get('contact') || '').slice(0, LIMITS.contact),
  days: DURATIONS.includes(Number(prefs?.get('days'))) ? Number(prefs.get('days')) : 7,
  showCollapsed: Boolean(prefs?.get('showCollapsed')),
});
