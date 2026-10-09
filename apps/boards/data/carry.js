// Carrying boards over when the site's identity changed (signing in on the
// start page keeps the old device key aside for every app to migrate from).

import { previousIdentities, markCarried, wasCarried } from '../../../shared/account.js';
import { AccountSettings } from '../../../shared/settings.js';
import { Wallet } from './wallet.js';

/** Add boards to a wallet unless it already has them with at least the same keys. */
async function carryEntries(wallet, entries) {
  for (const entry of entries) {
    const have = wallet.get(entry.pub);
    if (have && (have.w || !entry.w) && (have.k || !entry.k)) continue;
    await wallet.upsert({ ...entry, ...have, w: have?.w || entry.w, k: have?.k || entry.k });
  }
}

/** The boards this device kept under its previous keys move to the current one. */
export async function carryOver({ identity, wallet, settings, net }) {
  for (const prev of previousIdentities()) {
    if (prev.pk === identity.pk || wasCarried('loadout', prev.pk)) continue;
    const old = new Wallet(prev, net);
    await old.start();
    const entries = old.list();
    old.stop();
    await carryEntries(wallet, entries);
    // Starter templates and the like follow too, unless the account already has its own.
    const oldSettings = new AccountSettings(prev, net, 'loadout');
    await oldSettings.start();
    oldSettings.stop();
    if (Object.keys(oldSettings.data).length > 1 && Object.keys(settings.data).length <= 1) await settings.set({ ...oldSettings.data });
    markCarried('loadout', prev.pk);
    old.forgetLocal();
    oldSettings.forgetLocal();
  }
}
