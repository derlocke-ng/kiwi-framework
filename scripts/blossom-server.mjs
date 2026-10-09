// A Blossom server for development and tests (BUD-01 get, BUD-02 upload,
// delete and list, BUD-06 upload preflight), blobs kept in memory, CORS
// open like a public server. `accept(type)` is the server's policy: true,
// or the reason it refuses (a public server that takes only images).
// `silentRefusal` hangs up instead of answering a refused upload, which is
// what a page sees when a server's refusals carry no CORS headers.
//
//   const blossom = await startBlossom({ port: 0 });            // blossom.url, blossom.blobs, blossom.close()
//   const strict = await startBlossom({ accept: (t) => t.startsWith('image/') || 'only images' });
//   node scripts/blossom-server.mjs [port]
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256, X-Content-Length, X-Content-Type',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Reason',
};
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export function startBlossom({ port = 0, accept = () => true, maxSize = 20 * 1024 * 1024, tamper = false, silentRefusal = false } = {}) {
  /** sha256 → { data, type, owner, uploaded } */
  const blobs = new Map();
  let base = '';
  const send = (res, status, body = '', headers = {}) => {
    res.writeHead(status, { ...CORS, ...headers });
    res.end(body);
  };
  const refuse = (res, status, reason) => send(res, status, '', { 'X-Reason': reason });
  const descriptor = (sha, b) => ({ url: `${base}/${sha}${EXT[b.type] || ''}`, sha256: sha, size: b.data.length, type: b.type, uploaded: b.uploaded });

  /** The signed authorization for `verb` (and blob `sha`), or the reason it is not one. */
  const authorize = (req, verb, sha) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Nostr ')) return 'missing authorization';
    let ev;
    try {
      ev = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'));
    } catch {
      return 'unreadable authorization';
    }
    if (ev?.kind !== 24242 || !verifyEvent(ev)) return 'invalid authorization';
    const tag = (n) => ev.tags.find((t) => t[0] === n)?.[1];
    const now = Date.now() / 1000;
    if (tag('t') !== verb) return `authorization is not for ${verb}`;
    if (!(Number(tag('expiration')) > now)) return 'authorization expired';
    if (ev.created_at > now + 60) return 'authorization from the future';
    if (sha && !ev.tags.some((t) => t[0] === 'x' && t[1] === sha)) return 'authorization is for another blob';
    return { pubkey: ev.pubkey };
  };
  const policy = (type, size) => {
    if (size > maxSize) return [413, 'file too large'];
    const ok = accept(type || 'application/octet-stream');
    return ok === true ? null : [415, typeof ok === 'string' ? ok : 'type not accepted'];
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (req.method === 'OPTIONS') return send(res, 204);
    if (path === '/upload' && req.method === 'HEAD') {
      const sha = String(req.headers['x-sha-256'] || '');
      const auth = authorize(req, 'upload', sha);
      if (typeof auth === 'string') return refuse(res, 401, auth);
      const no = policy(req.headers['x-content-type'], Number(req.headers['x-content-length'] || 0));
      return no ? refuse(res, ...no) : send(res, 200);
    }
    if (path === '/upload' && req.method === 'PUT') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= maxSize + 1) chunks.push(c);
      });
      req.on('end', () => {
        const data = Buffer.concat(chunks);
        const sha = crypto.createHash('sha256').update(data).digest('hex');
        const auth = authorize(req, 'upload', sha);
        if (typeof auth === 'string') return refuse(res, 401, auth);
        const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
        const no = policy(type, size);
        if (no && silentRefusal) return req.socket.destroy();
        if (no) return refuse(res, ...no);
        const blob = blobs.get(sha) || { data, type, owner: auth.pubkey, uploaded: Math.floor(Date.now() / 1000) };
        blobs.set(sha, blob);
        send(res, 200, JSON.stringify(descriptor(sha, blob)), { 'Content-Type': 'application/json' });
      });
      return;
    }
    const m = path.match(/^\/([0-9a-f]{64})(\.[a-z0-9]+)?$/);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      const blob = blobs.get(m[1]);
      if (!blob) return refuse(res, 404, 'not found');
      const data = tamper ? Buffer.from('not the file you asked for') : blob.data;
      return send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': blob.type, 'Content-Length': String(data.length) });
    }
    if (m && req.method === 'DELETE') {
      const auth = authorize(req, 'delete', m[1]);
      if (typeof auth === 'string') return refuse(res, 401, auth);
      const blob = blobs.get(m[1]);
      if (!blob) return refuse(res, 404, 'not found');
      if (blob.owner !== auth.pubkey) return refuse(res, 403, 'not yours');
      blobs.delete(m[1]);
      return send(res, 200);
    }
    const list = path.match(/^\/list\/([0-9a-f]{64})$/);
    if (list && req.method === 'GET') {
      const mine = [...blobs].filter(([, b]) => b.owner === list[1]).map(([sha, b]) => descriptor(sha, b));
      return send(res, 200, JSON.stringify(mine), { 'Content-Type': 'application/json' });
    }
    refuse(res, 404, 'not found');
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      base = `http://localhost:${server.address().port}`;
      const close = () =>
        new Promise((r) => {
          server.close(() => r());
          server.closeAllConnections();
        });
      resolve({ url: base, blobs, close });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startBlossom({ port: Number(process.argv[2] || 3300) });
  console.log(`Blossom server for development on ${url} (blobs in memory)`);
}
