// Links into a space (docs/architecture.md, "Links across hubs"): a link names
// the app, the space (`s=` its address) and the item, never the host. A hub
// that opens it looks for its own mount of that app on that space and goes
// there; without one it says whose space this is and offers the page the link
// came from (`h=`, the one host a link carries, as a way back, not an address).
import { mountById, mountFor } from '../shared/apps.js';
import { readSpaceParam, spaceQuery } from '../shared/spaces.js';
import type { Kiwi } from './kiwi';

export interface SpaceLink {
  /** the space the link names, or null for a link into no space */
  address: string | null;
  /** this hub serves the space on another mount of this app: open the link there */
  redirect?: string;
  /** no mount of this hub serves the space: the page the link came from (without its hash), when it says */
  foreign?: { address: string; from: string | null };
}

/**
 * Where a link's query (`s=`, `h=`) sends this page: nowhere when it names this mount's space (or none),
 * another mount of the same app on this hub when that one serves the space, or a note that the space is
 * not served here. `hash` is the page's fragment, kept on a redirect.
 */
export function resolveSpaceLink(kiwi: Kiwi, params: URLSearchParams, hash: string): SpaceLink {
  const address = readSpaceParam(params);
  const mine = kiwi.mountSpace?.address || null;
  if (!address || address === mine) return { address: mine };
  const app = mountById(kiwi.current)?.app;
  const other = app ? mountFor(app, address) : null;
  if (other) return { address, redirect: `${kiwi.base}${other.id}/${hash}` };
  const from = params.get('h');
  return { address, foreign: { address, from: from && /^https?:\/\//.test(from) ? from : null } };
}

/** The query a link into this page's space carries: the space, the page it came from, and where its events are. */
export function spaceLinkQuery(kiwi: Kiwi, also: string[] = []): string {
  const space = kiwi.space();
  const parts = [spaceQuery(space), ...(space ? [`h=${encodeURIComponent(location.href.split('#')[0])}`] : [])];
  const hints = kiwi.hints(also).map((u) => `r=${encodeURIComponent(u.replace(/^wss?:\/\//, ''))}`);
  return [...parts, ...hints].filter(Boolean).join('&');
}
