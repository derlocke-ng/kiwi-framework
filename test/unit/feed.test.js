// The feed's data (apps/feed/data): hashtags, what an entry may hold, routes, and an entry posted and
// opened: for the space with the space's key, for an audience with its key, unreadable without one,
// in this feed's space or not at all; comments with the entry's key; social counts and folding.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { cleanEntry, FeedData, hashtags, parseRoute } = await import('../../apps/feed/data/feed.js');
const { Social } = await import('../../shared/social.js');
const { audienceKey } = await import('../../shared/audiences.js');
const { KINDS, keyId, sign } = await import('../../shared/events.js');
const { resolveSpaces, spaceOf } = await import('../../shared/spaces.js');
const { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, matchFilters } = await import('../../shared/nostr.mjs');

const person = (alias = null) => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)), alias };
};
const [space, other] = resolveSpaces({ id: 'hub', spaces: [{ id: 'grow', name: 'Grow' }, { id: 'gems', name: 'Gems', moderators: [] }] });

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
  return { events, db, pool: { urls: ['wss://r.example'], subscribe: () => ({ close() {} }) }, sync: { publish: async (ev) => db.put(ev) } };
}

/** An audiences stand-in: my keys derived, others' from a map. */
const audiencesOf = (me, given = {}) => ({
  current: async (audience) => {
    const k = audienceKey(me.sk, audience, 1);
    return { audience, epoch: 1, k, kid: keyId(k) };
  },
  key: (author, kid) => {
    if (author === me.pk) for (const aud of ['me', 'friends']) if (keyId(audienceKey(me.sk, aud, 1)) === kid) return audienceKey(me.sk, aud, 1);
    return given[`${author}:${kid}`] || null;
  },
  audienceOf: (kid) => (['me', 'friends'].find((aud) => keyId(audienceKey(me.sk, aud, 1)) === kid) ?? null),
});

test('hashtags: words after #, lowercased, once, not in links or entities', () => {
  assert.deepEqual(hashtags('Week 3 #Grow #auto, flowering #grow\n#LST and a url https://x.example/#anchor &#39; x#y'), ['grow', 'auto', 'lst']);
  assert.deepEqual(hashtags('#a'), [], 'one letter is not a tag');
  assert.equal(hashtags(Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(' ')).length, 10);
});

test('an entry holds text or photos, cleaned; nothing else', () => {
  assert.equal(cleanEntry({ text: '  ' }), null);
  assert.equal(cleanEntry(null), null);
  const photo = { url: 'https://m.example/abc', sha256: 'a'.repeat(64), size: 10, mime: 'image/jpeg', key: 'b'.repeat(64), width: 100, height: 80, thumb: { url: 'https://m.example/t', sha256: 'c'.repeat(64) }, evil: 1 };
  const e = cleanEntry({ text: 'x'.repeat(6000), media: [photo, { url: 'nope' }], tags: ['A', 'b'], name: 'n'.repeat(99), at: 5 });
  assert.equal(e.text.length, 5000);
  assert.equal(e.media.length, 1, 'a photo without a hash is dropped');
  assert.equal(e.media[0].evil, undefined);
  assert.equal(e.media[0].key, 'b'.repeat(64));
  assert.deepEqual(e.tags, ['a', 'b']);
  assert.equal(e.name.length, 40);
  assert.equal(e.at, 5);
});

test('routes: the feed, an entry with its link’s query, a person, the settings', () => {
  const pk = 'a'.repeat(64);
  assert.deepEqual(parseRoute('#/'), { page: 'feed' });
  const r = parseRoute(`#/e/${pk}/abc%20d?s=34550%3Ax%3Agrow&r=relay.example`);
  assert.equal(r.page, 'entry');
  assert.equal(r.d, 'abc d');
  assert.equal(r.params.get('r'), 'relay.example');
  assert.deepEqual(parseRoute(`#/p/${pk}`), { page: 'person', pk });
  assert.deepEqual(parseRoute('#/settings'), { page: 'settings' });
  assert.deepEqual(parseRoute('#/e/nothex/x'), { page: 'feed' });
});

test('an entry for the space opens with the space key for anyone; the relay sees neither text nor photo key', async () => {
  const n = net();
  const ada = person('ada');
  const feed = new FeedData(n, ada, { space, audiences: () => audiencesOf(ada) });
  const ev = await feed.post({ text: 'Week 1 #grow', media: [], audience: 'space' });
  assert.equal(spaceOf(ev), space.address);
  assert.ok(ev.tags.some((t) => t[0] === 'a' && t[1] === space.address && t[2] === 'wss://r.example'));
  assert.ok(!ev.content.includes('Week'), 'sealed');
  const bea = person('bea');
  const reader = new FeedData(n, bea, { space, audiences: () => audiencesOf(bea) });
  const e = await reader.openEntry(ev);
  assert.equal(e.text, 'Week 1 #grow');
  assert.deepEqual(e.tags, ['grow']);
  assert.equal(e.name, 'ada');
  assert.equal(e.audience, 'space');
  const elsewhere = new FeedData(n, bea, { space: other, audiences: () => audiencesOf(bea) });
  assert.equal(await elsewhere.openEntry(ev), null, 'a feed on another space does not show it');
  const nowhere = new FeedData(n, bea, { audiences: () => audiencesOf(bea) });
  assert.equal(await nowhere.openEntry(ev), null, 'nor does a feed on no space');
});

test('an entry for friends opens only with their key; edits keep the first time; a deletion is a sealed tombstone', async () => {
  const n = net();
  const ada = person('ada');
  const bea = person('bea');
  const cid = person('cid');
  const feed = new FeedData(n, ada, { space, audiences: () => audiencesOf(ada) });
  const ev = await feed.post({ text: 'only friends', audience: 'friends' });
  const k = audienceKey(ada.sk, 'friends', 1);
  const friend = new FeedData(n, bea, { space, audiences: () => audiencesOf(bea, { [`${ada.pk}:${keyId(k)}`]: k }) });
  const stranger = new FeedData(n, cid, { space, audiences: () => audiencesOf(cid) });
  const seen = await friend.openEntry(ev);
  assert.equal(seen.text, 'only friends');
  assert.equal(seen.audience, 'shared');
  assert.equal(await stranger.openEntry(ev), null, 'no key, no entry');
  const mine = await feed.openEntry(ev);
  assert.equal(mine.audience, 'friends', 'my own entry says whom it is for');
  const edited = await feed.post({ text: 'only friends, edited', audience: 'friends', d: mine.d, at: mine.at });
  const again = await friend.openEntry(edited);
  assert.equal(again.text, 'only friends, edited');
  assert.equal(again.at, mine.at, 'it keeps its place in the feed');
  await feed.remove(again);
  const tomb = n.events.at(-1);
  assert.equal((await friend.openEntry(tomb)).deleted, true);
  assert.equal(await stranger.openEntry(tomb), null);
});

test('comments are sealed with the entry’s key; likes and reports are counted; a moderator’s report folds an entry', async () => {
  const n = net();
  const ada = person('ada');
  const bea = person('bea');
  const mod = person('mod');
  const [modded] = resolveSpaces({ id: 'hub', spaces: [{ id: 'grow', moderators: [mod.pk] }] });
  const feed = new FeedData(n, ada, { space: modded, audiences: () => audiencesOf(ada) });
  const ev = await feed.post({ text: 'hello', audience: 'space' });
  const reader = new FeedData(n, bea, { space: modded, audiences: () => audiencesOf(bea) });
  const entry = await reader.openEntry(ev);
  const social = new Social(n, bea, { space: modded }).start();
  social.watch([entry.address]);
  const c = await reader.comment(entry, '  nice  ');
  assert.ok(!c.content.includes('nice'), 'sealed');
  await reader.like(entry, true);
  await feed.like(entry, true);
  await reader.like(entry, false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(social.likeCount(entry.address), 1, 'ada’s like; bea took hers back');
  assert.equal(social.liked(entry.address), false);
  const comments = social.commentEvents(entry.address);
  assert.equal(comments.length, 1);
  const opened = await reader.openComment(entry, comments[0]);
  assert.equal(opened.text, 'nice');
  assert.equal(social.collapsed(entry), null);
  const report = sign({ kind: KINDS.REPORT, tags: [['p', ada.pk, 'spam'], ['a', entry.address], ['k', '30820']], content: '' }, mod.sk);
  await n.db.put(report);
  assert.equal(social.collapsed(entry), 'moderator', 'one report by a moderator is enough');
  social.stop();
});
