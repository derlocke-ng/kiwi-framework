// A hub's configuration at deploy time. The build writes `hub.json` from
// distribution.js: the hub as built (name, versions, relays, policy, mounts
// and their networks), for tools and catalogs to read. A host may serve
// `hub.local.json` beside it with what the deployment decides: its own
// relays (inside a VPN), the public area's relays, the policy, which mounts
// are public, a space's relays. The page reads it before it connects, so one
// built site (one container image) serves many networks;
// container/entrypoint.sh writes it from the container's environment.
// Anything malformed is ignored.
import { MOUNTS } from './apps.js';
import { DISTRIBUTION } from './distribution.js';
import { resolveSpaces, SPACES, setSpaceRelays } from './spaces.js';

export const LOCAL_CONFIG = 'hub.local.json';
const RELAY = /^wss?:\/\/\S+$/;
const relayList = (v) => (Array.isArray(v) && v.every((r) => RELAY.test(String(r))) ? v.map(String) : null);

/**
 * Apply a deployment's overrides to the distribution in memory. Returns what was applied.
 * @param {any} local  the parsed hub.local.json
 */
export function applyHubConfig(local) {
  const applied = {};
  if (!local || typeof local !== 'object') return applied;
  const relays = relayList(local.relays);
  if (relays) applied.relays = DISTRIBUTION.relays = relays;
  const publicRelays = relayList(local.publicRelays);
  if (publicRelays) applied.publicRelays = DISTRIBUTION.publicRelays = publicRelays;
  const directoryRelays = relayList(local.directoryRelays);
  if (directoryRelays) applied.directoryRelays = DISTRIBUTION.directoryRelays = directoryRelays;
  if (local.policy && typeof local.policy === 'object') {
    const policy = { ...(DISTRIBUTION.policy || {}) };
    if (['open', 'locked'].includes(local.policy.relays)) policy.relays = local.policy.relays;
    if (typeof local.policy.requireHub === 'boolean') policy.requireHub = local.policy.requireHub;
    if (typeof local.policy.userMounts === 'boolean') policy.userMounts = local.policy.userMounts;
    applied.policy = DISTRIBUTION.policy = policy;
  }
  if (Array.isArray(local.publicMounts) && local.publicMounts.every((m) => typeof m === 'string')) {
    for (const m of MOUNTS) m.network = local.publicMounts.includes(m.id) ? 'public' : 'hub';
    for (const m of DISTRIBUTION.mounts || []) m.network = local.publicMounts.includes(m.id) ? 'public' : 'hub';
    applied.publicMounts = [...local.publicMounts];
  }
  // a public mount without public relays has nowhere to go: it stays on the hub's network
  if (!DISTRIBUTION.publicRelays?.length) {
    for (const m of MOUNTS) m.network = 'hub';
    for (const m of DISTRIBUTION.mounts || []) m.network = 'hub';
  }
  // a space's relays: `spaces: { <id>: { relays: [...] } }`; an empty list puts the space on its mount's network
  if (local.spaces && typeof local.spaces === 'object' && !Array.isArray(local.spaces)) {
    const spaces = {};
    for (const [id, v] of Object.entries(local.spaces)) {
      const space = SPACES.find((s) => s.id === id);
      const relays = v && typeof v === 'object' ? relayList(v.relays) : null;
      if (!space || !relays) continue;
      setSpaceRelays(space, relays); // normalized there
      const configured = (DISTRIBUTION.spaces || []).find((s) => s.id === id);
      if (configured) configured.relays = [...space.relays];
      spaces[id] = { relays: [...space.relays] };
    }
    if (Object.keys(spaces).length) applied.spaces = spaces;
  }
  return applied;
}

/** Fetch the host's hub.local.json, when it serves one, and apply it. Resolves with what was applied, or null. */
export async function loadHubConfig(base = './') {
  try {
    const res = await fetch(new URL(LOCAL_CONFIG, new URL(base, location.href)), { cache: 'no-cache', credentials: 'same-origin' });
    if (!res.ok) return null;
    const applied = applyHubConfig(await res.json());
    return Object.keys(applied).length ? applied : null;
  } catch {
    return null;
  }
}

/** The hub as built, for `hub.json`: what a catalog, a module or a person can read without running the page. */
export function describeHub(config, { version = '', framework = '' } = {}) {
  return {
    id: config.id,
    name: config.name,
    description: config.description || '',
    homepage: config.homepage || '',
    repo: config.repo || '',
    version,
    framework,
    relays: [...(config.relays || [])],
    publicRelays: [...(config.publicRelays || [])],
    directoryRelays: [...(config.directoryRelays || [])],
    policy: { userMounts: false, relays: 'open', requireHub: false, ...(config.policy || {}) },
    // the spaces as built: their addresses are what another hub names to serve the same space
    spaces: resolveSpaces(config).map((s) => ({ id: s.id, address: s.address, owner: s.owner, owned: s.owned, name: s.name, description: s.description, relays: [...s.relays], moderators: [...s.moderators], adult: s.adult })),
    mounts: (config.mounts || []).map((m) => ({ id: m.id, app: m.app, name: m.name || null, network: m.network === 'public' ? 'public' : 'hub', space: m.space || null })),
  };
}
