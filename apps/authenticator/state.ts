// The authenticator's view of the vault: every entry that carries a 2FA
// secret, as a code to show. Entries of their own (type `totp`) and logins of
// the password manager with a code alike; the name and the login stand for
// the service and the account.
import { useMemo } from 'react';
import { useVault, type VaultItem } from '../../ui/vault/VaultProvider';

export interface Entry {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  item: VaultItem;
}

/** The vault's entries with a 2FA secret, in the vault's order (favourites first, then by name). */
export function useEntries(): Entry[] {
  const { items } = useVault();
  return useMemo(
    () => items.filter((i) => i.totp).map((i) => ({ id: i.id, issuer: i.name, account: i.username, ...(i.totp as NonNullable<VaultItem['totp']>), item: i })),
    [items],
  );
}
