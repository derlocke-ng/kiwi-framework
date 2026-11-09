// What the authenticator's screens share: the vault as it stands (its record
// in the account's settings, whether it is open here, its entries while it is),
// and what changes it. Plus the device's own choice of when it locks again.
import { createContext, useContext } from 'react';

export interface Entry {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
}

export interface VaultState {
  prefs: any;
  /** the vault's record in the account's settings, or null before one is made */
  record: any | null;
  /** the entries while the vault is open here, else [] */
  items: Entry[];
  open: boolean;
  unlock: (key: CryptoKey, items: any[]) => void;
  lock: () => void;
  /** the entries changed: sealed again with the open key and written to the account */
  save: (items: Entry[]) => Promise<void>;
  /** a vault made anew (a first passphrase, a new one): its record, key and entries */
  replace: (record: any, key: CryptoKey, items: Entry[]) => Promise<void>;
}

export const VaultContext = createContext<VaultState | null>(null);

export function useVault(): VaultState {
  const v = useContext(VaultContext);
  if (!v) throw new Error('useVault outside the authenticator');
  return v;
}

const LOCK_KEY = 'authenticator.lockAfter';
export const LOCK_CHOICES = [1, 5, 15, 60];

/** Minutes away after which the vault locks again on this device (5 unless the person chose otherwise). */
export function lockAfter(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(LOCK_KEY) || '5'));
    return LOCK_CHOICES.includes(v) ? v : 5;
  } catch {
    return 5;
  }
}

export function setLockAfter(minutes: number) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(minutes));
  } catch {
    /* storage blocked: the default holds */
  }
}
