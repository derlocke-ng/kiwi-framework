// What a distribution.js must get right for the build to accept it: the
// shape of its networks and mounts. Pure, so the build and the unit tests
// share it. Returns the problems found, none for a sound distribution.
//
//   relays        the hub's own network; a private hub names relays inside its VPN
//   publicRelays  the public area's relays, for mounts with network: 'public'
//   policy.relays       'open' (default): a person may use their own relays; 'locked': the hub's are fixed
//   policy.requireHub   true: the hub's pages wait while no relay of the hub's network is reachable
//   mounts[].network    'hub' (default) or 'public'
//   spaces[]            id (a slug), owner (a hex pubkey, or none: the hub's own, with a derived key),
//                       name, relays (the space's own network, or none: the mount's)
//   mounts[].space      the id of one of the spaces
//   mounts[].requireAccount, policy.requireAccount   true or false: only people with an account use it

const RELAY = /^wss?:\/\/\S+$/;
const SPACE_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** A moderator as a distribution may name one: 64 hex characters or an npub (bech32: npub1 and 58 more). */
const KEY = /^([0-9a-f]{64}|npub1[02-9ac-hj-np-z]{58})$/;

/** @param {any} config @returns {string[]} problems, none when the distribution is sound */
export function checkDistribution(config) {
  const problems = [];
  const relays = config.relays || [];
  const publicRelays = config.publicRelays || [];
  if (!Array.isArray(relays) || relays.some((r) => !RELAY.test(String(r)))) problems.push('relays: a list of wss:// (or ws://) URLs');
  if (!Array.isArray(publicRelays) || publicRelays.some((r) => !RELAY.test(String(r)))) problems.push('publicRelays: a list of wss:// (or ws://) URLs');
  const directory = config.directoryRelays || [];
  if (!Array.isArray(directory) || directory.some((r) => !RELAY.test(String(r)))) problems.push('directoryRelays: a list of wss:// (or ws://) URLs');
  const policy = config.policy || {};
  if (policy.relays !== undefined && !['open', 'locked'].includes(policy.relays)) problems.push("policy.relays: 'open' or 'locked'");
  if (policy.requireHub !== undefined && typeof policy.requireHub !== 'boolean') problems.push('policy.requireHub: true or false');
  if (policy.requireAccount !== undefined && typeof policy.requireAccount !== 'boolean') problems.push('policy.requireAccount: true or false');
  for (const m of config.mounts || []) {
    if (m.network !== undefined && !['hub', 'public'].includes(m.network)) problems.push(`mount "${m.id}": network is 'hub' or 'public'`);
    if (m.network === 'public' && !publicRelays.length) problems.push(`mount "${m.id}" is on the public network, but the distribution names no publicRelays`);
    if (m.requireAccount !== undefined && typeof m.requireAccount !== 'boolean') problems.push(`mount "${m.id}": requireAccount is true or false`);
  }
  if (publicRelays.length && !(config.mounts || []).some((m) => m.network === 'public')) problems.push('publicRelays are named, but no mount is on the public network');
  if (config.moderators !== undefined && (!Array.isArray(config.moderators) || config.moderators.some((p) => !KEY.test(String(p)))))
    problems.push('moderators: a list of npubs or hex pubkeys');
  const spaces = config.spaces || [];
  if (!Array.isArray(spaces)) problems.push('spaces: a list');
  const ids = new Set();
  for (const s of Array.isArray(spaces) ? spaces : []) {
    const id = String(s?.id ?? '');
    if (!SPACE_ID.test(id)) problems.push(`space "${id}": the id is 2–40 lowercase letters, digits and hyphens`);
    if (ids.has(id)) problems.push(`space "${id}" is listed twice`);
    ids.add(id);
    if (s?.owner != null && !HEX64.test(String(s.owner))) problems.push(`space "${id}": owner is a 64-character hex pubkey, or left out`);
    if (s?.relays !== undefined && (!Array.isArray(s.relays) || s.relays.some((r) => !RELAY.test(String(r))))) problems.push(`space "${id}": relays is a list of wss:// (or ws://) URLs`);
    if (s?.moderators !== undefined && (!Array.isArray(s.moderators) || s.moderators.some((p) => !KEY.test(String(p))))) problems.push(`space "${id}": moderators is a list of npubs or hex pubkeys`);
  }
  for (const m of config.mounts || []) if (m.space != null && !ids.has(String(m.space))) problems.push(`mount "${m.id}" names a space "${m.space}" the distribution does not define`);
  return problems;
}
