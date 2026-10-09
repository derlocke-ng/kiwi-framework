#!/usr/bin/env node
// Check media (Blossom) servers from a terminal: what each one does with an
// upload from a fresh, throwaway key, and whether web pages may use it.
// Each check uploads a tiny file and deletes it again.
//
//   node node_modules/kiwi-framework/scripts/blossom-probe.mjs                 the distribution's media list
//   node node_modules/kiwi-framework/scripts/blossom-probe.mjs nostr.download  these servers
//
// Behind a proxy, Node 22 needs NODE_USE_ENV_PROXY=1 (Node 24 reads the
// usual HTTPS_PROXY by itself). The hub's settings have the same check
// (Network, Media servers), run from the browser with your own key.
import { probe } from '../shared/blossom.js';
import { bytesToHex, generateSecretKey } from '../shared/nostr.mjs';
import { loadDistribution } from './build-site.mjs';

/** Public servers worth trying when nothing else is given (checked by hand; see blossomservers.com for more). */
export const KNOWN = ['https://blossom.primal.net', 'https://blossom.band', 'https://nostr.download', 'https://24242.io', 'https://blossom.yakihonne.com', 'https://nostrcheck.me/media'];

const LABEL = {
  encrypted: 'takes any file, so encrypted ones too',
  imagesOnly: 'photos only (unencrypted)',
  paid: 'asks for payment',
  denied: 'refuses',
  unreachable: 'unreachable',
};

/** Would a browser be allowed to upload from another site? (the CORS preflight a PUT with a signature needs) */
async function browsersMayUpload(server) {
  try {
    const res = await fetch(`${server}/upload`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });
    const origin = res.headers.get('access-control-allow-origin');
    const headers = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
    return Boolean(origin) && (headers === '*' || headers.includes('authorization'));
  } catch {
    return null;
  }
}

async function servers() {
  if (process.argv.length > 2) return process.argv.slice(2);
  try {
    const media = (await loadDistribution(process.cwd())).media || [];
    if (media.length) return media;
  } catch {}
  return KNOWN;
}

const sk = bytesToHex(generateSecretKey());
const list = await servers();
console.log(`Checking ${list.length} media server(s) with a throwaway key…\n`);
const rows = await Promise.all(
  list.map(async (server) => {
    const r = await probe(server, { sk });
    const web = r.result === 'unreachable' ? null : await browsersMayUpload(r.server);
    return { ...r, web };
  }),
);
const width = Math.max(...rows.map((r) => r.server.length));
for (const r of rows) {
  const web = r.web === null ? '' : r.web ? ' · web pages may upload' : ' · BLOCKS web pages (no CORS)';
  const why = r.reason && r.result !== 'encrypted' ? ` (${r.reason})` : '';
  console.log(`${r.server.padEnd(width)}  ${LABEL[r.result] || r.result}${why}${web}`);
}
const usable = rows.filter((r) => (r.result === 'encrypted' || r.result === 'imagesOnly') && r.web !== false);
console.log(`\n${usable.length} of ${rows.length} usable from the hub; encrypted photos need one that takes any file.`);
