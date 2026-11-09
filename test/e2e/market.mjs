// The market app in Chromium: a hub mounts it on a space, for people with an account, beside the chat. A
// seller lists seeds with a photo: on the relay the listing is ciphertext with keyed search labels and no
// plain word. A buyer in Austria finds it (it ships to the EU), one filtering for the US or for cuttings does
// not; the listing opens in a panel over the grid with where it is and where it goes, the contact on
// request; "Message seller" opens the chat with a message about it drafted, which reaches the seller. Saved,
// reserved, folded by a moderator's report, deleted. A key alone gets the account gate.
//
// A distribution runs it against its own site:
//   import { marketSuite } from 'kiwi-framework/test/e2e/market.mjs';
//   await run('tradingpost', (env) => marketSuite(env, { app: `${env.base}tradingpost/`, chat: `${env.base}uplink/`, settings: …, space: <address> }), { webRoot: site });
// Run directly, it builds a test hub with the market and the chat.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { spaceAddress, spaceKey } from '../../shared/spaces.js';
import { absent, device, run, sleep, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const keypair = () => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)) };
};

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, chat: string, settings: string, space: string, moderator?: { sk: string, pk: string } | null }} where
 *   app: the market's mount (asking for an account); chat: the chat's mount; space: the market's space address
 */
export async function marketSuite(env, { app, chat, settings, space, moderator = null }) {
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  // people with an account (the market asks for one): the gate looks at the identity's account entry
  const withAccount = (alias, keys = keypair()) => ({ ...keys, alias, accountPk: bytesToHex(generateSecretKey()), accountVersion: 2, created: Date.now() });
  const dev = (name, identity) => device(env, name, init, { relay: env.nostrUrl, identity });
  const titles = (page) => texts(page, '#listings .listing-title');
  // the grid says nothing reaches here; when it does not, what it shows instead is what the failure reports
  const emptyHere = async (page) => {
    const text = (await page.textContent('.market-page')) || '';
    if (/Nothing here reaches/.test(text)) return true;
    throw new Error(`the grid shows: ${(await page.$$eval('#listings .listing-title', (els) => els.map((e) => e.textContent))).join(' | ') || text.replace(/\s+/g, ' ').slice(-160)}`);
  };
  const cardOf = (page, title) => page.locator('.listing-card', { has: page.locator('.listing-title', { hasText: title }) });

  async function open(page, url = app) {
    await page.goto(url);
    await page.waitForSelector('#newListing');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  }
  async function country(page, code) {
    await page.goto(`${app}#/settings`);
    await page.waitForSelector('#marketPrefs select[name=country]');
    await page.selectOption('#marketPrefs select[name=country]', code);
    await page.waitForSelector('.toast-success');
  }
  async function menu(page, label) {
    await page.click('#panel [data-act=menu]');
    await page.waitForSelector('.menu [data-i]');
    const items = await texts(page, '.menu [data-i]');
    const i = items.indexOf(label);
    assert.ok(i >= 0, `menu has "${label}": ${items.join(', ')}`);
    await page.click(`.menu [data-i="${i}"]`);
  }

  step('the seller sets a media server and their country, and lists seeds with a photo that ship to Germany and the EU');
  const S = await dev('S', withAccount('sel'));
  await S.goto(`${settings}#media`);
  await S.waitForSelector('#mediaForm', { state: 'attached' });
  if (!(await S.$eval('#media details', (d) => d.open))) await S.click('#media details summary');
  await S.fill('#mediaForm textarea', env.blossom.url);
  await S.click('#mediaForm [type=submit]');
  await S.waitForSelector(`#mediaList li[data-server="${env.blossom.url}"]`);
  await country(S, 'DE');
  await open(S);
  await S.click('#newListing');
  // a market with a rule for sellers: someone new is told what it takes, and a moderator approves them
  await S.waitForSelector('#listingForm, #sellerGate');
  if (await S.$('#sellerGate')) {
    assert.ok(moderator, 'this market asks for approved sellers: the suite needs one of its moderators');
    step('the market asks for approved sellers: the seller is told what it takes, a moderator approves them, the form opens');
    assert.match(await S.textContent('#sellerGate'), /moderator/);
    assert.ok(await S.$('#askModerator'), 'a message to a moderator, one tap away');
    const pkS = await S.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
    const M0 = await dev('M0', withAccount('mod', moderator));
    await M0.goto(`${app}#/s/${pkS}`);
    await M0.waitForSelector('#seller [data-act=approve-seller]');
    assert.match(await M0.textContent('#sellerStatus'), /Not a seller here yet|Posts in/);
    await M0.click('#seller [data-act=approve-seller]');
    await M0.waitForSelector('.toast-success');
    await until(async () => /Approved as a seller/.test(await M0.textContent('#sellerStatus')), 'approved, on the moderator’s screen', 10000);
    await S.waitForSelector('#listingForm', { timeout: 20000 }); // the rule gives way to the form by itself
    await M0.ctx.close();
  }
  assert.equal(await S.inputValue('#listingForm select[name=from]'), 'DE', 'the listing starts in the seller’s country');
  await S.fill('#listingForm [name=title]', 'Five autoflower seeds');
  await S.selectOption('#listingForm select[name=category]', 'seeds');
  await S.fill('#listingForm [name=price]', '€25');
  await S.fill('#listingForm [name=text]', 'A **mixed** pack, stored cool and dark.');
  const jpeg = Buffer.from(
    await S.evaluate(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
      const g = c.getContext('2d');
      g.fillStyle = '#65a30d';
      g.fillRect(0, 0, 800, 600);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }),
    'base64',
  );
  await S.setInputFiles('#compose input[type=file]', { name: 'seeds.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await S.waitForSelector('#composePhotos li', { timeout: 20000 });
  assert.deepEqual(await S.$$eval('#shipsTo li', (els) => els.map((e) => e.dataset.dest)), ['DE'], 'it ships to its own country to start with');
  await S.click('#listingForm [data-act=ship-EU]');
  await S.fill('#listingForm [name=contact]', 'signal: seller.01');
  await S.click('#listingForm .btn-primary');
  await until(async () => !(await S.$('#listingForm')), 'the form closes', 20000);

  step('on the relay: ciphertext, keyed search labels, an expiry; no word of it in clear');
  await until(async () => (await env.relayEvents([{ kinds: [30830] }])).length === 1, 'the listing on the relay', 15000);
  const [ev] = await env.relayEvents([{ kinds: [30830] }]);
  const raw = JSON.stringify(ev);
  for (const word of ['Five', 'seeds', '"DE"', 'signal', '€25', '"EU"']) assert.ok(!raw.includes(word), `no ${word} in clear`);
  assert.ok(ev.tags.some((t) => t[0] === 'a' && t[1] === space), 'tagged with the space');
  assert.ok(ev.tags.filter((t) => t[0] === 'l').length >= 6, 'search labels');
  assert.ok(Number(ev.tags.find((t) => t[0] === 'expiration')[1]) > Date.now() / 1000 + 29 * 86_400, 'up for thirty days');
  const blobs = [...env.blossom.blobs.values()];
  assert.ok(blobs.length >= 1 && blobs.every((b) => b.data.subarray(0, 3).toString('hex') !== 'ffd8ff'), 'the photo is encrypted');

  step('a buyer in Austria finds it; filtering for the US, for cuttings or for pickup finds nothing (asked of the relay by label)');
  const B = await dev('B', withAccount('buy'));
  await country(B, 'AT');
  await open(B);
  await until(async () => (await titles(B)).includes('Five autoflower seeds'), 'the listing reaches Austria (EU)', 20000);
  await B.selectOption('#country', 'US');
  await until(() => emptyHere(B), 'nothing for the US', 15000);
  await B.selectOption('#country', 'AT');
  await B.selectOption('#category', 'cuttings');
  await until(() => emptyHere(B), 'no cuttings', 15000);
  await B.selectOption('#category', 'seeds');
  await until(async () => (await titles(B)).includes('Five autoflower seeds'), 'seeds again', 15000);
  await B.check('#pickup');
  await until(() => emptyHere(B), 'no pickup in Austria', 15000);
  await B.uncheck('#pickup');
  await until(async () => (await titles(B)).includes('Five autoflower seeds'), 'back', 15000);
  await B.fill('#search', 'mixed');
  assert.deepEqual(await titles(B), ['Five autoflower seeds'], 'the search runs over what came');
  await B.fill('#search', 'clones');
  await until(async () => (await titles(B)).length === 0, 'no match');
  await B.fill('#search', '');

  step('it opens in a panel over the grid: where it is and where it goes, the description; the contact on request');
  await cardOf(B, 'Five autoflower seeds').click();
  await B.waitForSelector('#panel .listing');
  assert.ok(await B.$('#listings'), 'the grid stays under the panel');
  assert.equal((await B.textContent('#panel .listing-title')).trim(), 'Five autoflower seeds');
  assert.equal((await B.textContent('#panel .listing-head .listing-price')).trim(), '€25');
  assert.equal((await B.textContent('#panel [data-fact=from]')).trim(), 'Germany');
  assert.match(await B.textContent('#panel [data-fact=ships]'), /Germany, European Union/);
  assert.ok(await B.$('#panel .listing-text strong'), 'the description is markdown');
  await until(async () => B.$eval('#panel .photo-grid-item img', (img) => img.complete && img.naturalWidth > 0).catch(() => false), 'the photo opens', 20000);
  await B.click('#panel [data-act=contact]');
  await B.waitForSelector('#contactValue');
  assert.equal((await B.textContent('#contactValue')).trim(), 'signal: seller.01');
  await B.click('dialog.modal [data-close]');
  await until(async () => !(await B.$('#contactValue')), 'contact closed');

  step('saved: it is in the saved view');
  await B.click('#panel [data-act=save]');
  await B.waitForSelector('#panel [data-act=save][aria-pressed=true]');
  const listingUrl = B.url();

  step('"Message seller" opens the chat with a message about the listing drafted; sent, it reaches the seller');
  const href = await B.getAttribute('#panel [data-act=message]', 'href');
  assert.match(href, /#\/dm\/[0-9a-f]{64}\?text=/);
  await B.click('#panel [data-act=message]');
  await B.waitForSelector('#composer textarea');
  const draft = await B.inputValue('#composer textarea');
  assert.match(draft, /Five autoflower seeds/);
  assert.match(draft, /#\/l\/[0-9a-f]{64}\//, 'with the listing’s link');
  await B.press('#composer textarea', 'Enter');
  await until(async () => (await texts(B, '#messages .msg p')).some((x) => x.includes('Five autoflower seeds')), 'sent', 15000);
  const pkB = await B.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
  await S.goto(`${chat}#/dm/${pkB}`);
  await S.waitForSelector('#composer textarea');
  await until(async () => (await texts(S, '#messages .msg p')).some((x) => x.includes('Five autoflower seeds')), 'the seller reads it', 30000);

  step('the seller marks it reserved; the buyer sees it so in the saved view');
  await S.goto(`${listingUrl.replace(/^[^#]*/, app)}`);
  await S.waitForSelector('#panel .listing');
  await menu(S, 'Mark reserved');
  await S.waitForSelector('.toast-success');
  await open(B);
  await B.check('input[name=view][value=saved]', { force: true });
  await until(async () => (await texts(B, '#listings .listing-status')).includes('Reserved'), 'reserved in the saved view', 20000);

  if (moderator) {
    step('a moderator’s report folds the listing away for everyone else');
    const M = await dev('M', withAccount('mod', moderator));
    await M.goto(listingUrl.replace(/^[^#]*/, app));
    await M.waitForSelector('#panel .listing');
    await menu(M, 'Report…');
    await M.waitForSelector('#reportForm');
    await M.click('#reportForm .btn-danger');
    await until(async () => !(await M.$('#reportForm')), 'report sent', 20000);
    await until(async () => (await B.$$('.listing-card.folded')).length === 1, 'folded on B', 20000);
    {
      // where sellers need approval: taking it back hides the seller's listings from buyers, giving it again shows them
      const pkS = await S.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
      await M.goto(`${app}#/s/${pkS}`);
      await M.waitForSelector('#seller');
      if (await M.$('#seller [data-act=withdraw-seller]')) {
        await M.click('#seller [data-act=withdraw-seller]');
        await until(async () => (await B.$$('.listing-card')).length === 0, 'the listing is gone for the buyer once the approval is taken back', 20000);
        await M.waitForSelector('#seller [data-act=approve-seller]');
        await M.click('#seller [data-act=approve-seller]');
        await until(async () => (await B.$$('.listing-card')).length === 1, 'and back once it is given again', 20000);
      }
    }
    await S.goto(app);
    await S.waitForSelector('#newListing');
    await S.check('input[name=view][value=mine]', { force: true });
    await until(async () => (await titles(S)).includes('Five autoflower seeds'), 'the seller still sees it as it is', 15000);
  }

  step('deleted: gone for the buyer');
  await S.goto(listingUrl.replace(/^[^#]*/, app));
  await S.waitForSelector('#panel .listing');
  await menu(S, 'Delete…');
  await S.waitForSelector('dialog.modal [data-ok]');
  await S.click('dialog.modal [data-ok]');
  await until(async () => (await B.$$('.listing-card')).length === 0, 'gone on B', 20000);

  step('someone with a key alone gets the account gate');
  const K = await dev('K', { ...keypair(), alias: null, created: Date.now() });
  await K.goto(app);
  await K.waitForSelector('#accountGate');
  assert.ok(await absent(K, '#newListing'));
  await sleep(200);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const mod = keypair();
  const hubId = 'market-hub';
  const address = spaceAddress(getPublicKey(hexToBytes(spaceKey(hubId, 'trade'))), 'trade');
  const site = await testHub(
    [
      // sellers show up in the grow feed first (one post that someone liked), or a moderator approves them
      { app: 'market', id: 'trade', name: 'Trade', icon: 'package', space: 'trade', requireAccount: true, sellers: { space: 'grow', posts: 1, likes: 1 } },
      { app: 'chat', name: 'Chat', icon: 'message-circle' },
    ],
    {
      id: hubId,
      name: 'Market hub',
      spaces: [
        { id: 'trade', name: 'Trade', moderators: [mod.pk] },
        { id: 'grow', name: 'Grow' },
      ],
    },
  );
  await run(
    'market',
    (env) => marketSuite(env, { app: `${env.base}trade/`, chat: `${env.base}chat/`, settings: `${env.base}settings.html`, space: address, moderator: mod }),
    { webRoot: site },
  );
}
