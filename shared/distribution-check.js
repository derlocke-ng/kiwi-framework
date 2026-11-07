// What a distribution.js must get right for the build to accept it: the
// shape of its networks and mounts. Pure, so the build and the unit tests
// share it. Returns the problems found, none for a sound distribution.
//
//   relays        the hub's own network; a private hub names relays inside its VPN
//   publicRelays  the public area's relays, for mounts with network: 'public'
//   policy.relays       'open' (default): a person may use their own relays; 'locked': the hub's are fixed
//   policy.requireHub   true: the hub's pages wait while no relay of the hub's network is reachable
//   mounts[].network    'hub' (default) or 'public'

const RELAY = /^wss?:\/\/\S+$/;

/** @param {any} config @returns {string[]} problems, none when the distribution is sound */
export function checkDistribution(config) {
  const problems = [];
  const relays = config.relays || [];
  const publicRelays = config.publicRelays || [];
  if (!Array.isArray(relays) || relays.some((r) => !RELAY.test(String(r)))) problems.push('relays: a list of wss:// (or ws://) URLs');
  if (!Array.isArray(publicRelays) || publicRelays.some((r) => !RELAY.test(String(r)))) problems.push('publicRelays: a list of wss:// (or ws://) URLs');
  const policy = config.policy || {};
  if (policy.relays !== undefined && !['open', 'locked'].includes(policy.relays)) problems.push("policy.relays: 'open' or 'locked'");
  if (policy.requireHub !== undefined && typeof policy.requireHub !== 'boolean') problems.push('policy.requireHub: true or false');
  for (const m of config.mounts || []) {
    if (m.network !== undefined && !['hub', 'public'].includes(m.network)) problems.push(`mount "${m.id}": network is 'hub' or 'public'`);
    if (m.network === 'public' && !publicRelays.length) problems.push(`mount "${m.id}" is on the public network, but the distribution names no publicRelays`);
  }
  if (publicRelays.length && !(config.mounts || []).some((m) => m.network === 'public')) problems.push('publicRelays are named, but no mount is on the public network');
  return problems;
}
