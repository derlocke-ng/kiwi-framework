// What every page of the app reads: the person's wallet of boards and the
// app's own settings (starters), both bound to the identity.
import { createContext, useContext } from 'react';
import { useTick } from '../../ui/hooks';
import type { Wallet } from './data/wallet.js';

export interface BoardsState {
  wallet: Wallet;
  /** AccountSettings for the 'loadout' namespace (starters, showStarters) */
  settings: any;
}

export const BoardsContext = createContext<BoardsState | null>(null);

export function useBoards(): BoardsState {
  const b = useContext(BoardsContext);
  if (!b) throw new Error('useBoards outside the boards app');
  return b;
}

/** The wallet, re-rendering on every change to it. */
export function useWallet(): Wallet {
  const { wallet } = useBoards();
  useTick((fn) => wallet.onChange(fn));
  return wallet;
}

/** The app's settings, re-rendering on every change. */
export function useBoardsSettings(): any {
  const { settings } = useBoards();
  useTick((fn) => settings.onChange(fn));
  return settings;
}

/** Where a link to this app points: the page without the fragment. */
export const pageBase = () => location.href.split('#')[0];

export const go = (hash: string) => {
  if (location.hash !== hash) location.hash = hash;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
};
