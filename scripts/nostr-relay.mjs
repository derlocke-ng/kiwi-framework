// A small NIP-01 relay for development and tests, with a NIP-11 information
// document. Events are kept in memory and, with a directory given, appended
// to events.jsonl so a restart keeps them; start with an empty directory to
// simulate a relay that lost everything. Production uses strfry.
//
//   node scripts/nostr-relay.mjs [port] [dir]
//
// Environment: RELAY_NAME, RELAY_COUNTRY (NIP-11 fields shown by the apps).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { isAddressableKind, isReplaceableKind, isEphemeralKind } from 'nostr-tools/kinds';

const MAX_FUTURE = 15 * 60; // seconds a created_at may lie ahead
const MAX_MESSAGE = 256 * 1024;

export const addressOf = (event) => {
  if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}:`;
  if (isAddressableKind(event.kind)) return `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
  return null;
};

/** NIP-01 ordering for replaceable events: newest wins, lowest id breaks ties. */
export const supersedes = (a, b) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

export class EventStore {
  constructor(file = null) {
    this.events = new Map();
    this.byAddress = new Map();
    this.file = file;
    if (file && fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          this.add(JSON.parse(line), { persist: false });
        } catch {
          /* skip a damaged line */
        }
      }
    }
  }

  /** @returns {{ ok: boolean, reason: string, stored: boolean }} */
  add(event, { persist = true } = {}) {
    if (this.events.has(event.id)) return { ok: true, reason: 'duplicate: already have this event', stored: false };
    if (isEphemeralKind(event.kind)) return { ok: true, reason: '', stored: false };
    const address = addressOf(event);
    if (address) {
      const current = this.byAddress.get(address);
      if (current && !supersedes(event, current)) return { ok: true, reason: 'duplicate: replaced by a newer event', stored: false };
      if (current) this.events.delete(current.id);
      this.byAddress.set(address, event);
    }
    this.events.set(event.id, event);
    if (persist && this.file) fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    return { ok: true, reason: '', stored: true };
  }

  /** Matching events, newest first, honouring the largest limit among the filters. */
  query(filters) {
    const out = [];
    for (const event of this.events.values()) if (matchFilters(filters, event)) out.push(event);
    out.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    const limits = filters.map((f) => f.limit).filter((l) => Number.isInteger(l) && l >= 0);
    const limit = limits.length === filters.length ? Math.max(...limits) : Infinity;
    return out.slice(0, limit);
  }

  get size() {
    return this.events.size;
  }
}

export function startRelay({ port = 0, dir = null, name = 'dev relay', country = 'DE' } = {}) {
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const store = new EventStore(dir ? path.join(dir, 'events.jsonl') : null);
  const info = {
    name,
    description: 'kiwi-framework development relay',
    supported_nips: [1, 11],
    software: 'https://github.com/derlocke-ng/kiwi-framework',
    version: 'dev',
    relay_countries: [country],
    limitation: { max_message_length: MAX_MESSAGE, max_subscriptions: 64, auth_required: false, payment_required: false },
  };
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if ((req.headers.accept || '').includes('application/nostr+json')) {
      res.writeHead(200, { 'content-type': 'application/nostr+json' });
      return res.end(JSON.stringify(info));
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`${name}: a nostr relay. Connect with a nostr client.\n`);
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE });
  const clients = new Set(); // { ws, subs: Map<id, filters[]> }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (event) => {
    for (const c of clients) for (const [id, filters] of c.subs) if (matchFilters(filters, event)) send(c.ws, ['EVENT', id, event]);
  };

  wss.on('connection', (ws) => {
    const client = { ws, subs: new Map() };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
        if (!Array.isArray(msg)) throw new Error('not an array');
      } catch {
        return send(ws, ['NOTICE', 'invalid: could not parse message']);
      }
      const [type, ...rest] = msg;
      if (type === 'EVENT') {
        const event = rest[0];
        if (!event || typeof event !== 'object') return send(ws, ['NOTICE', 'invalid: missing event']);
        if (!verifyEvent(event)) return send(ws, ['OK', event.id || '', false, 'invalid: bad signature or id']);
        if (event.created_at > Math.floor(Date.now() / 1000) + MAX_FUTURE) return send(ws, ['OK', event.id, false, 'invalid: created_at is too far in the future']);
        const result = store.add(event);
        send(ws, ['OK', event.id, result.ok, result.reason]);
        if (result.stored || isEphemeralKind(event.kind)) broadcast(event);
      } else if (type === 'REQ') {
        const [id, ...filters] = rest;
        if (typeof id !== 'string' || !filters.length) return send(ws, ['NOTICE', 'invalid: REQ needs an id and filters']);
        if (client.subs.size >= info.limitation.max_subscriptions && !client.subs.has(id)) return send(ws, ['CLOSED', id, 'error: too many subscriptions']);
        client.subs.set(id, filters);
        for (const event of store.query(filters).reverse()) send(ws, ['EVENT', id, event]);
        send(ws, ['EOSE', id]);
      } else if (type === 'CLOSE') {
        client.subs.delete(rest[0]);
      } else {
        send(ws, ['NOTICE', `error: unknown message type ${String(type).slice(0, 20)}`]);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const { port: p } = server.address();
      resolve({
        port: p,
        url: `ws://localhost:${p}`,
        store,
        close: () =>
          new Promise((done) => {
            for (const c of clients) c.ws.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const port = Number(process.argv[2] || process.env.PORT || 7777);
  const dir = process.argv[3] || process.env.RELAY_DIR || null;
  startRelay({ port, dir, name: process.env.RELAY_NAME || 'dev relay', country: process.env.RELAY_COUNTRY || 'DE' }).then((r) => {
    console.log(`nostr relay on ${r.url}${dir ? ` (data in ${dir})` : ' (in memory)'}`);
  });
}
