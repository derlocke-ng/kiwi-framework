import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, parseBoardInput, shareLink, boardHash, isPub } from '../../apps/boards/data/links.js';

const PUB = 'a1'.repeat(32);
const KEY = 'b2'.repeat(32);
const PRIV = 'c3'.repeat(32);
const BASE = 'https://example.github.io/weaponized-js/loadout/';

test('recognises nostr public keys (64 hex characters)', () => {
  assert.ok(isPub(PUB));
  assert.ok(!isPub(PUB + 'a'));
  assert.ok(!isPub(PUB.toUpperCase()));
  assert.ok(!isPub('npub1' + PUB));
});

test('parses routes', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute('#/account'), { name: 'account' });
  assert.deepEqual(parseRoute('#/nope'), { name: 'notfound' });
  assert.deepEqual(parseRoute(`#/b/${PUB}`), { name: 'board', pub: PUB, w: null, k: null });
  assert.deepEqual(parseRoute(`#/b/${PUB}?k=${KEY}`), { name: 'board', pub: PUB, w: null, k: KEY });
  assert.deepEqual(parseRoute(`#/b/${PUB}?w=${PRIV}`), { name: 'board', pub: PUB, w: PRIV, k: null });
});

test('ignores malformed secrets', () => {
  assert.deepEqual(parseRoute(`#/b/${PUB}?k=short&w=${PRIV}x`), { name: 'board', pub: PUB, w: null, k: null });
  assert.equal(parseRoute('#/b/not-a-key').name, 'notfound');
});

test('parses pasted links and bare addresses', () => {
  assert.equal(parseBoardInput(`${BASE}#/b/${PUB}?w=${PRIV}`).w, PRIV);
  assert.equal(parseBoardInput(`/b/${PUB}`).pub, PUB);
  assert.equal(parseBoardInput(`b/${PUB}?k=${KEY}`).k, KEY);
  assert.equal(parseBoardInput(`  ${PUB} `).pub, PUB);
  assert.equal(parseBoardInput('https://example.com/'), null);
  assert.equal(parseBoardInput(''), null);
});

test('builds share links', () => {
  const board = { pub: PUB, w: PRIV, k: KEY };
  assert.equal(shareLink(BASE, board, 'edit'), `${BASE}#/b/${PUB}?w=${PRIV}`);
  assert.equal(shareLink(BASE, board, 'view'), `${BASE}#/b/${PUB}?k=${KEY}`);
  assert.throws(() => shareLink(BASE, { pub: PUB, k: KEY }, 'edit'), /edit key/);
  assert.throws(() => shareLink(BASE, { pub: PUB }, 'view'), /read key/);
  assert.deepEqual(parseRoute(boardHash(board)), { name: 'board', pub: PUB, w: PRIV, k: null });
});

test('the start page order: pinned first, then boards not sorted yet (newest first), then the sorted ones', async () => {
  const { Wallet } = await import('../../apps/boards/data/wallet.js');
  const published = [];
  const net = { db: null, pool: null, sync: { publish: async (ev) => published.push(ev), watch() {}, unwatch() {} } };
  const sk = '11'.repeat(32);
  const w = new Wallet({ sk, pk: 'aa'.repeat(32) }, net);
  const at = (pub, added, extra = {}) => w.entries.set(pub, { pub, added, ...extra });
  at('a', 1);
  at('b', 2);
  at('c', 3, { pinned: true });
  at('d', 4, { o: 1 });
  at('e', 5, { o: 0 });
  assert.deepEqual(w.list().map((e) => e.pub), ['c', 'b', 'a', 'e', 'd']);
  // the first move numbers the whole group as shown; later moves only touch the moved board
  await w.reorder(['b', 'e', 'a', 'd'], 'e');
  assert.deepEqual(w.list().map((e) => e.pub), ['c', 'b', 'e', 'a', 'd']);
  const before = published.length;
  await w.reorder(['b', 'a', 'e', 'd'], 'a');
  assert.equal(published.length, before + 1, 'one board, one event');
  assert.deepEqual(w.list().map((e) => e.pub), ['c', 'b', 'a', 'e', 'd']);
});
