// Healing: relays forget data, devices don't. Every event this device holds
// for your account and your boards is re-published to a relay when it
// (re)connects (shared/sync.js does that for watched authors). Opening a
// board also pushes its events out again, at most once a minute.

import { KINDS } from '../../../shared/events.js';

const MIN_GAP = 60_000;
const lastHeal = new Map();

export async function healBoard(pub, { sync }) {
  if (Date.now() - (lastHeal.get(pub) || 0) < MIN_GAP) return false;
  lastHeal.set(pub, Date.now());
  await sync.healAuthor(pub);
  return true;
}

/** Everything of yours that relays should keep: your key, your account event, your boards. */
let boardsSub = null;
let subscribed = '';

/** Stop watching (the identity changed, or the app is leaving). */
export function unwatchAll() {
  boardsSub?.close();
  boardsSub = null;
  subscribed = '';
}

/**
 * Everything that is ours is watched: it is healed onto relays that come
 * back, and every board in the wallet is kept on this device in full (not
 * only the ones opened here), so backups and healing carry all of it.
 */
export function watchAll(identity, wallet, { sync, pool, db }) {
  const pubs = wallet.pubs();
  sync.watch([identity.pk, ...(identity.accountPk ? [identity.accountPk] : []), ...pubs]);
  const key = [...pubs].sort().join(',');
  if (key === subscribed) return;
  subscribed = key;
  boardsSub?.close();
  boardsSub = pubs.length ? pool.subscribe([{ kinds: [KINDS.LOADOUT_INFO, KINDS.LOADOUT_ITEM, KINDS.LOADOUT_DOC], authors: pubs }], { onevent: (ev) => db.put(ev) }) : null;
}
