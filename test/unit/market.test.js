// The market's data (apps/market/data): what a listing holds, the words it is found by and a buyer's
// search, a listing posted and opened with keyed search labels and no plain word on the relay, expiry,
// status, a listing for friends without labels, routes; the countries it uses.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { cleanListing, MarketData, parseRoute, searchWords, wordsOf } = await import('../../apps/market/data/market.js');
const { destinationsFor, isDestination } = await import('../../shared/countries.js');
const { audienceKey } = await import('../../shared/audiences.js');
const { KINDS, keyId, makeAddressable, seal } = await import('../../shared/events.js');
const { blindLabel } = await import('../../shared/sealed.js');
const { resolveSpaces, spaceReadKey } = await import('../../shared/spaces.js');
const { bytesToHex, generateSecretKey, getPublicKey, hexToBytes, matchFilters } = await import('../../shared/nostr.mjs');

const person = (alias = null) => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)), alias };
};
const [space] = resolveSpaces({ id: 'armory', spaces: [{ id: 'tradingpost', name: 'Trading Post' }] });
const net = () => {
  const events = [];
  return {
    events,
    db: { put: async (ev) => events.push(ev), query: async (f) => events.filter((e) => matchFilters(f, e)), subscribe: () => () => {} },
    pool: { urls: ['wss://r.example'], subscribe: () => ({ close() {} }) },
    sync: { publish: async (ev) => events.push(ev) },
  };
};
const audiencesOf = (me) => ({
  current: async (audience) => {
    const k = audienceKey(me.sk, audience, 1);
    return { audience, epoch: 1, k, kid: keyId(k) };
  },
  key: (author, kid) => (author === me.pk && kid === keyId(audienceKey(me.sk, 'friends', 1)) ? audienceKey(me.sk, 'friends', 1) : null),
  audienceOf: (kid) => (kid === keyId(audienceKey(me.sk, 'friends', 1)) ? 'friends' : null),
});
const seeds = { title: 'Five autoflower seeds', category: 'seeds', price: '€25', text: 'Mixed pack.', from: 'DE', ships: ['DE', 'EU'], contact: 'signal: seller.01' };

test('countries: destinations for a buyer, regions as destinations', () => {
  assert.deepEqual(destinationsFor('AT'), ['AT', 'EU', 'WW']);
  assert.deepEqual(destinationsFor('CH'), ['CH', 'WW'], 'Switzerland is not in the EU');
  assert.deepEqual(destinationsFor('XX'), []);
  assert.ok(isDestination('EU') && isDestination('WW') && isDestination('PL') && !isDestination('EUR'));
});

test('a listing needs a title, a category and a country; the rest is cleaned', () => {
  assert.equal(cleanListing({ ...seeds, title: ' ' }), null);
  assert.equal(cleanListing({ ...seeds, category: 'weapons' }), null);
  assert.equal(cleanListing({ ...seeds, from: 'Germany' }), null);
  const l = cleanListing({ ...seeds, ships: ['DE', 'EU', 'Mars', 'DE'], status: 'gone', title: 'x'.repeat(300) });
  assert.deepEqual(l.ships, ['DE', 'EU'], 'only real destinations, once');
  assert.equal(l.status, 'open');
  assert.equal(l.title.length, 100);
  assert.equal(l.pickup, false);
  assert.equal(cleanListing({ ...seeds, ships: [] }).pickup, true, 'shipping nowhere is pickup only');
});

test('the words a listing is found by meet a buyer’s search where they should', () => {
  const words = wordsOf(cleanListing(seeds));
  const finds = (search) => (searchWords(search) || []).some((w) => words.includes(w));
  assert.ok(finds({ category: 'seeds', country: 'AT' }), 'seeds for Austria: it ships to the EU');
  assert.ok(finds({ country: 'DE' }), 'anything for Germany');
  assert.ok(!finds({ category: 'seeds', country: 'US' }), 'not to the US');
  assert.ok(!finds({ category: 'cuttings', country: 'DE' }), 'not cuttings');
  assert.ok(!finds({ country: 'DE', pickup: true }), 'no pickup offered');
  assert.ok(wordsOf(cleanListing({ ...seeds, ships: [] })).includes('pickup:DE'));
  assert.equal(searchWords({}), null, 'no filter: everything in the space');
  assert.deepEqual(searchWords({ category: 'gear' }), ['cat:gear']);
});

test('a listing to the space: sealed, keyed labels, no plain word on the relay, an expiry; a buyer’s search matches its labels', async () => {
  const n = net();
  const seller = person('sel');
  const market = new MarketData(n, seller, { space, audiences: () => audiencesOf(seller) });
  const ev = await market.post(seeds, { days: 30 });
  const raw = JSON.stringify(ev);
  for (const word of ['Five', 'seeds', '"DE"', 'signal', '€25', 'EU']) assert.ok(!raw.includes(word), `no ${word} in clear`);
  assert.ok(ev.tags.some((t) => t[0] === 'L' && t[1] === 'wjs/label'));
  const labels = ev.tags.filter((t) => t[0] === 'l').map((t) => t[1]);
  assert.ok(labels.length >= 6 && labels.every((l) => /^[0-9a-f]{16}$/.test(l)));
  assert.ok(labels.includes(blindLabel(spaceReadKey(space).k, 'cat:seeds|to:EU')));
  const exp = Number(ev.tags.find((t) => t[0] === 'expiration')[1]);
  assert.ok(Math.abs(exp - (Math.floor(Date.now() / 1000) + 30 * 86_400)) < 5);
  const buyer = new MarketData(n, person('buy'), { space, audiences: () => audiencesOf(person()) });
  const at = buyer.labelsFor({ category: 'seeds', country: 'AT' });
  assert.ok(matchFilters([{ kinds: [KINDS.MARKET_LISTING], '#l': at }], ev), 'the relay-side filter of a buyer in Austria matches');
  assert.ok(!matchFilters([{ kinds: [KINDS.MARKET_LISTING], '#l': buyer.labelsFor({ category: 'seeds', country: 'US' }) }], ev), 'one in the US does not');
  const l = await buyer.openListing(ev);
  assert.equal(l.title, 'Five autoflower seeds');
  assert.equal(l.audience, 'space');
  assert.equal(l.expired, false);
});

test('status and deletion keep the listing’s address; a listing for friends has no labels; an expired one says so', async () => {
  const n = net();
  const seller = person('sel');
  const market = new MarketData(n, seller, { space, audiences: () => audiencesOf(seller) });
  const first = await market.openListing(await market.post(seeds));
  const reserved = await market.openListing(await market.setStatus(first, 'reserved'));
  assert.equal(reserved.status, 'reserved');
  assert.equal(reserved.address, first.address);
  assert.ok(reserved.expires >= first.expires - 86_400, 'it keeps when it expires');
  await market.remove(reserved);
  assert.equal((await market.openListing(n.events.at(-1))).deleted, true);
  const friendsOnly = await market.post(seeds, { audience: 'friends' });
  assert.ok(!friendsOnly.tags.some((t) => t[0] === 'l'), 'found by its seller, not by what it is');
  assert.equal((await market.openListing(friendsOnly)).audience, 'friends');
  const stranger = new MarketData(n, person(), { space, audiences: () => audiencesOf(person()) });
  assert.equal(await stranger.openListing(friendsOnly), null);
  const { k, kid } = spaceReadKey(space);
  const old = makeAddressable(KINDS.MARKET_LISTING, 'old', await seal(k, { v: 1, ...cleanListing(seeds) }), seller.sk, [
    ['a', space.address],
    ['key', kid],
    ['expiration', String(Math.floor(Date.now() / 1000) - 60)],
  ]);
  assert.equal((await stranger.openListing(old)).expired, true);
});

test('routes: the listings, a listing with its link’s query, a seller, the settings', () => {
  const pk = 'b'.repeat(64);
  assert.deepEqual(parseRoute('#/'), { page: 'home' });
  const r = parseRoute(`#/l/${pk}/abc?s=34550%3Ax%3Atp`);
  assert.equal(r.page, 'listing');
  assert.equal(r.d, 'abc');
  assert.deepEqual(parseRoute(`#/s/${pk}`), { page: 'seller', pk });
  assert.deepEqual(parseRoute('#/settings'), { page: 'settings' });
});
