// Board links. Everything secret lives in the URL fragment, which browsers
// never send to a server:
//
//   #/b/<pub>?w=<secret>   can edit (the read key is derived from the secret)
//   #/b/<pub>?k=<key>      read only
//   #/b/<pub>              a board already in your wallet
//   …&r=<relay>            where the board's events are (up to three hints, shared/relaylists.js)
//
// <pub> is the board's nostr public key (its address on the relays), <secret>
// its signing key and <key> the symmetric key its content is encrypted with,
// all 64 hex characters.

import { hintQuery, readHints } from '../../../shared/relaylists.js';

const HEX64 = /^[0-9a-f]{64}$/;

export const isPub = (s) => typeof s === 'string' && HEX64.test(s);
export const isSecret = (s) => typeof s === 'string' && HEX64.test(s);

/** Parse a location hash (with or without the leading #) into a route. */
export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'b' && isPub(parts[1])) {
    const params = new URLSearchParams(query);
    const w = params.get('w');
    const k = params.get('k');
    return { name: 'board', pub: parts[1], w: isSecret(w) ? w : null, k: isSecret(k) ? k : null, relays: readHints(params) };
  }
  if (parts[0] === 'account') return { name: 'account' };
  if (parts.length === 0) return { name: 'home' };
  return { name: 'notfound' };
}

/** @typedef {{ name: 'board', pub: string, w: string|null, k: string|null, relays?: string[] }} BoardRoute */

/**
 * Accept a pasted link, a bare hash or a bare board address.
 * @param {string} text
 * @returns {BoardRoute | null}
 */
export function parseBoardInput(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (isPub(s)) return { name: 'board', pub: s, w: null, k: null, relays: [] };
  const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s.replace(/^\/?/, '/');
  const route = parseRoute(hash);
  return route.name === 'board' ? /** @type {BoardRoute} */ (route) : null;
}

/** @param {{ pub: string, w?: string|null, k?: string|null, relays?: string[] }} board */
export function boardHash({ pub, w = null, k = null, relays = [] }) {
  const parts = [w ? `w=${w}` : k ? `k=${k}` : '', hintQuery(relays)].filter(Boolean);
  return `#/b/${pub}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/**
 * Share link for a board.
 * @param {string} base  page URL without hash, e.g. https://x.github.io/armory/loadout/
 * @param {{pub: string, w?: string|null, k?: string|null}} board
 * @param {'edit'|'view'} role
 */
export function shareLink(base, board, role, relays = []) {
  if (role === 'edit') {
    if (!board.w) throw new Error('No edit key for this board');
    return base + boardHash({ pub: board.pub, w: board.w, relays });
  }
  if (!board.k) throw new Error('No read key for this board');
  return base + boardHash({ pub: board.pub, k: board.k, relays });
}
