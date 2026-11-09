// Who may sell on a market (shared/sellers.js): no rule, anyone; a moderator's approval (and taking it back); or
// posts in the feed space, each liked by enough other people (not the writer, not someone I blocked; posts to
// friends and deleted ones do not count). Deploy-time moderators from hub.local.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { Sellers, sellerRule, sellerTags } = await import('../../shared/sellers.js');
const { FeedData } = await import('../../apps/feed/data/feed.js');
const { audienceKey } = await import('../../shared/audiences.js');
const { KINDS, keyId, sign } = await import('../../shared/events.js');
const { resolveSpaces, spaceTag } = await import('../../shared/spaces.js');
const { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, matchFilters } = await import('../../shared/nostr.mjs');

const person = () => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)) };
};
const mod = person();
const [market, grow] = resolveSpaces({ id: 'hub', spaces: [{ id: 'trade', moderators: [mod.pk] }, { id: 'grow' }] });
const byId = (id) => [market, grow].find((s) => s.id === id) || null;

function net() {
  const events = [];
  const listeners = new Set();
  const db = {
    put: async (ev) => {
      events.push(ev);
      for (const fn of listeners) fn(ev, 'hub');
    },
    query: async (filters) => events.filter((e) => matchFilters(filters, e)),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  return { events, db, pool: { urls: ['wss://r.example'], subscribe: () => ({ close() {} }), fetch: async () => [] }, sync: { publish: async (ev) => db.put(ev) } };
}
const audiencesOf = (me) => ({
  current: async (audience) => {
    const k = audienceKey(me.sk, audience, 1);
    return { audience, epoch: 1, k, kid: keyId(k) };
  },
  key: () => null,
  audienceOf: () => null,
});
const decide = (who, pk, decision, at) =>
  sign({ kind: KINDS.LABEL, created_at: at, tags: [...sellerTags(pk, decision), spaceTag(market, null)], content: '' }, who.sk);
const settle = () => new Promise((r) => setTimeout(r, 5));

test('a rule: posts in a feed space and likes, or approval only; none at all lets anyone sell', () => {
  assert.equal(sellerRule(undefined, byId), null);
  assert.deepEqual(sellerRule({ space: 'grow', posts: 3, likes: 2 }, byId), { posts: 3, likes: 2, feed: grow });
  assert.deepEqual(sellerRule({ posts: 0 }, byId), { posts: 0, likes: 0, feed: null }, 'approval only');
  assert.deepEqual(sellerRule({ space: 'nowhere', posts: 3, likes: 2 }, byId), { posts: 0, likes: 0, feed: null }, 'an unknown space: approval only');
  const anyone = new Sellers({ market: net() }, mod, { space: market, rule: null });
  assert.equal(anyone.status(person().pk).ok, true);
});

test('a moderator approves a seller and takes it back; a label by anyone else counts for nothing', async () => {
  const n = net();
  const seller = person();
  const sellers = await new Sellers({ market: n }, person(), { space: market, rule: sellerRule({ posts: 0 }, byId) }).start();
  assert.equal(sellers.status(seller.pk).ok, false);
  await n.db.put(decide(person(), seller.pk, 'approved', 100));
  await settle();
  assert.equal(sellers.status(seller.pk).ok, false, 'not a moderator');
  await n.db.put(decide(mod, seller.pk, 'approved', 101));
  await settle();
  assert.deepEqual(sellers.status(seller.pk), { ok: true, approved: true, revoked: false, posts: null, need: 0, likes: 0 });
  await n.db.put(decide(mod, seller.pk, 'revoked', 102));
  await settle();
  assert.equal(sellers.status(seller.pk).ok, false);
  assert.equal(sellers.status(seller.pk).revoked, true);
  await n.db.put(decide(mod, seller.pk, 'approved', 99));
  await settle();
  assert.equal(sellers.status(seller.pk).ok, false, 'an older decision does not undo a newer one');
  sellers.stop();
});

test('posts in the feed space count when enough other people liked each; my own like, a blocked liker, posts to friends and deleted ones do not', async () => {
  const feedNet = net();
  const seller = person();
  const [ann, bob, cyd] = [person(), person(), person()];
  const feed = new FeedData(feedNet, seller, { space: grow, audiences: () => audiencesOf(seller) });
  const post = async (text, audience = 'space') => feed.openEntry(await feed.post({ text, audience }));
  const like = async (who, entry) => {
    const ev = sign({ kind: KINDS.REACTION, created_at: Math.floor(Date.now() / 1000), tags: [['a', entry.address], ['p', seller.pk], ['k', '30820']], content: '+' }, who.sk);
    await feedNet.db.put(ev);
  };
  const one = await post('week 1');
  const two = await post('week 2');
  const gone = await post('week 3');
  await feed.post({ text: 'only friends', audience: 'friends' });
  for (const who of [ann, bob]) await like(who, one);
  for (const who of [ann, cyd, seller]) await like(who, two);
  for (const who of [ann, bob, cyd]) await like(who, gone);
  await feed.remove(gone);
  const rule = sellerRule({ space: 'grow', posts: 2, likes: 2 }, byId);
  const sellers = await new Sellers({ market: net(), feed: feedNet }, person(), { space: market, rule }).start();
  assert.equal(sellers.status(seller.pk).ok, null, 'not known yet: being looked at');
  await sellers.check(seller.pk);
  assert.deepEqual(sellers.status(seller.pk), { ok: true, approved: false, revoked: false, posts: 2, need: 2, likes: 2 });
  const blocking = await new Sellers({ market: net(), feed: feedNet }, person(), { space: market, rule, isBlocked: (pk) => pk === bob.pk }).start();
  await blocking.check(seller.pk);
  assert.equal(blocking.status(seller.pk).posts, 1, 'bob’s likes do not count for someone who blocked him');
  assert.equal(blocking.status(seller.pk).ok, false);
});

test('moderators named where the hub runs (hub.local.json) moderate the spaces the hub defines', async () => {
  const { applyHubConfig } = await import('../../shared/hubconfig.js');
  const { SPACES } = await import('../../shared/spaces.js');
  const boss = person();
  const applied = applyHubConfig({ moderators: [boss.pk, 'not a key'] });
  assert.deepEqual(applied.moderators, [boss.pk]);
  for (const s of SPACES) assert.equal(s.moderators.includes(boss.pk), !s.owned);
});
