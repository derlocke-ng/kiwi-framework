// The feed app in Chromium: a hub mounts it twice, as Outpost on a space (with a moderator) and as Club,
// a feed on no space that asks for an account. Entries for the space, for friends and for "only me", with
// a photo; who can read what, on the relay and on the screen; a friend added later reads what was posted
// under the current key, an unfriended one reads nothing new; likes and comments; edits and deletions;
// a moderator's report folds an entry; an ad reported as unmarked waits under the moderator's Reported tab,
// the moderator marks it (folded for someone without an account) and lifts the mark again; an entry marked
// 18+ is folded for someone without an account; an
// entry or a person opens in a panel over the feed, which keeps its place; a link opens the entry; diaries (a
// diary for friends with a cover, entries added on its page and from the composer, read in order by a friend
// and by no one else, nothing on the relay tying them together; pinned by a reader in the Diaries tab, pinned
// to the writer's profile, finished, deleted, reported and marked); the account gate sends a person with a key alone to register
// and brings them back.
//
// A distribution runs it against its own site:
//   import { feedSuite } from 'kiwi-framework/test/e2e/feed.mjs';
//   await run('outpost', (env) => feedSuite(env, { app: `${env.base}outpost/`, settings: `${env.base}settings.html`, space: <address> }), { webRoot: site });
// Run directly, it builds a test hub with both mounts.
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
 * @param {{ app: string, settings: string, space: string, moderator?: { sk: string, pk: string } | null, club?: string | null }} where
 *   app: the feed on the space; space: its address; moderator: a key the space names as one (its report is checked);
 *   club: a mount of the feed that asks for an account (the gate is checked)
 */
export async function feedSuite(env, { app, settings, space, moderator = null, club = null }) {
  // a key of its own per device, set once (an account made later must survive the next page)
  const init = ({ relay, identity }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    if (identity && !localStorage.getItem('wjs.identity')) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const dev = (name, identity = null, options = {}) => device(env, name, init, { relay: env.nostrUrl, identity }, options);
  const id = (alias) => ({ ...keypair(), alias, created: Date.now() });
  const entryTexts = (page) => texts(page, '.entry .entry-text');
  const panelTexts = (page) => texts(page, '#panel .entry .entry-text'); // what a link or a tap opened over the feed
  const entryOn = (page, text) => page.locator('.entry', { has: page.locator('.entry-text', { hasText: text }) });
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);

  async function open(page, url = app) {
    await page.goto(url);
    await page.waitForSelector('#newEntry, #newDiary');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  }
  async function tab(page, which) {
    await page.check(`input[name=tab][value=${which}]`, { force: true });
  }
  async function post(page, text, audience, photo = null, label = '') {
    await page.click('#newEntry');
    await page.waitForSelector('#composeForm');
    await page.fill('#composeForm textarea[name=text]', text);
    if (label) await page.selectOption('#composeForm select[name=label]', label);
    if (photo) {
      await page.setInputFiles('#compose input[type=file]', photo);
      await page.waitForSelector('#composePhotos li', { timeout: 20000 });
    }
    await page.selectOption('#composeForm select[name=audience]', audience);
    await page.click('#composeForm .btn-primary');
    await until(async () => !(await page.$('#composeForm')), 'composer closed', 20000);
  }
  async function menu(page, text, label) {
    await entryOn(page, text).locator('[data-act=menu]').first().click();
    await page.waitForSelector('.menu [data-i]');
    const items = await texts(page, '.menu [data-i]');
    const i = items.indexOf(label);
    assert.ok(i >= 0, `menu has "${label}": ${items.join(', ')}`);
    await page.click(`.menu [data-i="${i}"]`);
  }
  async function act(page, opener, which) {
    await page.click(opener);
    await page.waitForSelector(`.menu [data-act=${which}]`);
    await page.click(`.menu [data-act=${which}]`);
  }
  const diaryTexts = (page) => texts(page, '#panel #diaryEntries .entry-text');
  const diaryCard = (page, title) => page.locator(`.diary-card[data-title="${title}"]`);
  async function beginDiary(page, title, about, audience, cover = null) {
    await tab(page, 'diaries');
    await page.click('#newDiary');
    await page.waitForSelector('#diaryFormBody');
    await page.fill('#diaryFormBody [name=title]', title);
    await page.fill('#diaryFormBody [name=about]', about);
    if (cover) {
      await page.setInputFiles('#diaryForm input[type=file]', cover);
      await page.waitForSelector('#diaryCover img', { timeout: 20000 });
    }
    await page.selectOption('#diaryFormBody select[name=audience]', audience);
    await page.click('#diaryFormBody [type=submit]');
    await until(async () => (await page.textContent('#panel #diaryTitle').catch(() => '')) === title, `the diary “${title}” opens`, 20000);
    return page.url().split('#/d/')[1].split('/')[1].split('?')[0];
  }
  async function befriend(asker, asked) {
    await asked.goto(settings);
    await asked.waitForSelector('#myNpub');
    const key = await asked.textContent('#myNpub');
    await asker.goto(settings);
    await asker.waitForSelector('#friendForm');
    await asker.fill('#friendForm [name=who]', key);
    await asker.click('#friendForm .btn');
    await asked.waitForSelector('#requestList [data-accept]', { timeout: 30000 });
    await asked.click('#requestList [data-accept]');
    await until(async () => (await asker.$$('#friendList [data-remove]')).length > 0, 'friends on both sides', 30000);
  }

  step('a media server for the writer; the feed starts empty, on the space');
  const A = await dev('A', id('ada'), { permissions: ['clipboard-read', 'clipboard-write'] });
  await A.goto(`${settings}#media`);
  await A.waitForSelector('#mediaForm', { state: 'attached' });
  // a distribution names real servers: their list is folded away, and the test's own server replaces it (none is contacted)
  if (!(await A.$eval('#media details', (d) => d.open))) await A.click('#media details summary');
  await A.fill('#mediaForm textarea', env.blossom.url);
  await A.click('#mediaForm [type=submit]');
  await A.waitForSelector(`#mediaList li[data-server="${env.blossom.url}"]`);
  await open(A);
  assert.deepEqual(await A.$$eval('input[name=tab]', (els) => els.map((e) => e.value)), ['space', 'diaries', 'friends', 'mine']);
  await until(async () => /Nothing in this space yet/.test(await A.textContent('.feed')), 'the empty feed (after the relay’s first answer)', 15000);

  step('an entry for the space with a photo: sealed on the relay, the photo encrypted on the media server, the text and photo shown');
  const jpeg = Buffer.from(
    await A.evaluate(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 900, height: 600 });
      const g = c.getContext('2d');
      g.fillStyle = '#4d7c0f';
      g.fillRect(0, 0, 900, 600);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }),
    'base64',
  );
  await post(A, 'Week 1: seedlings up #grow #auto', 'space', { name: 'week1.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await until(async () => (await entryTexts(A)).includes('Week 1: seedlings up #grow #auto'), 'the entry on A');
  const onRelay = await env.relayEvents([{ kinds: [30820] }]);
  assert.equal(onRelay.length, 1);
  assert.ok(!onRelay[0].content.includes('seedlings'), 'the relay holds ciphertext');
  assert.ok(onRelay[0].tags.some((t) => t[0] === 'a' && t[1] === space), 'tagged with the space');
  assert.ok(onRelay[0].tags.some((t) => t[0] === 'key' && /^[0-9a-f]{16}$/.test(t[1])), 'naming its key');
  const blobs = [...env.blossom.blobs.values()];
  assert.ok(blobs.length >= 1 && blobs.every((b) => b.type === 'application/octet-stream' && b.data.subarray(0, 3).toString('hex') !== 'ffd8ff'), 'the photo is encrypted');
  assert.equal(await A.getAttribute('.entry', 'data-audience'), 'space');

  step('a stranger reads it in the space, photo and all; the hashtag finds it');
  const C = await dev('C', id(null));
  await open(C);
  await until(async () => (await entryTexts(C)).includes('Week 1: seedlings up #grow #auto'), 'the entry on C', 20000);
  await until(async () => C.$eval('.photo-grid-item img', (img) => img.complete && img.naturalWidth > 0).catch(() => false), 'the photo opens on C', 20000);
  assert.match(await C.textContent('.entry-author'), /ada/, 'the writer’s name travels with the entry');
  await C.click('.entry [data-tag=auto]');
  assert.equal(await C.inputValue('#search'), '#auto');
  assert.equal((await entryTexts(C)).length, 1);
  await C.fill('#search', '#nothing');
  await until(async () => (await entryTexts(C)).length === 0, 'no match');
  await C.fill('#search', '');

  step('friends: B asks, A accepts; A writes for friends: B reads it, the stranger does not, the relay holds ciphertext');
  const B = await dev('B', id('bea'));
  await befriend(B, A);
  await open(A);
  await post(A, 'Only for my friends: the secret nutrient mix', 'friends');
  await until(async () => (await entryTexts(A)).some((x) => x.startsWith('Only for my friends')), 'on A');
  await open(B);
  await tab(B, 'friends');
  await until(async () => (await entryTexts(B)).some((x) => x.startsWith('Only for my friends')), 'B reads the friends entry (its key reached B)', 40000);
  const friendsEntry = entryOn(B, 'Only for my friends');
  assert.equal(await friendsEntry.getAttribute('data-audience'), 'shared');
  assert.ok(!JSON.stringify(await env.relayEvents([{ kinds: [30820, 1059] }])).includes('nutrient'), 'nowhere in clear on the relay');
  await open(C);
  await sleep(1500);
  assert.ok(!(await entryTexts(C)).some((x) => x.includes('nutrient')), 'the stranger sees nothing of it');

  step('B likes it and comments; A sees both; the comment is sealed');
  await open(B);
  await tab(B, 'friends');
  await until(async () => (await entryTexts(B)).some((x) => x.startsWith('Only for my friends')), 'the entry again on B', 20000);
  await entryOn(B, 'Only for my friends').locator('[data-act=like]').click();
  await until(async () => (await entryOn(B, 'Only for my friends').locator('.like-count').textContent()) === '1', 'liked on B');
  const scrolled = await B.evaluate(() => {
    window.scrollTo(0, 120);
    return window.scrollY;
  });
  await entryOn(B, 'Only for my friends').locator('[data-act=comments]').click();
  await B.waitForSelector('#panel #commentForm');
  assert.ok(await B.$('#feedTabs'), 'the feed stays under the panel');
  assert.equal(await B.evaluate(() => window.scrollY), scrolled, 'and keeps its place');
  await B.fill('#commentForm textarea', 'Looks great, what ratio?');
  await B.click('#commentForm [type=submit]');
  await until(async () => (await texts(B, '.comment-text')).includes('Looks great, what ratio?'), 'the comment on B', 15000);
  const entryLink = B.url();
  const commentEvents = await env.relayEvents([{ kinds: [30822] }]);
  assert.equal(commentEvents.length, 1);
  assert.ok(!commentEvents[0].content.includes('ratio'), 'the comment is sealed');
  await A.goto(entryLink.replace(/^[^#]*/, app));
  await A.waitForSelector('#commentForm');
  await until(async () => (await texts(A, '.comment-text')).includes('Looks great, what ratio?'), 'A reads the comment', 20000);
  await until(async () => (await A.textContent('#panel .entry .like-count')) === '1', 'A sees the like', 20000);
  await A.click('#panel [data-act=panel-back]');
  await until(async () => !(await A.$('#panel')), 'the panel closes; the feed is there', 10000);
  assert.ok(await A.$('#feedTabs'));

  step('a friend added later reads what was posted under the current key');
  const D = await dev('D', id('dan'));
  await befriend(D, A);
  await open(D);
  await tab(D, 'friends');
  await until(async () => (await entryTexts(D)).some((x) => x.startsWith('Only for my friends')), 'D reads the earlier friends entry', 40000);

  step('A unfriends B: the next friends entry is under a new key; B no longer reads new ones, still reads the old; D reads both');
  await A.goto(`${settings}#people`);
  await A.waitForSelector('#friendList');
  const pkB = await pkOf(B);
  await A.click(`#friendList [data-remove="${pkB}"]`);
  await until(async () => !(await A.$(`#friendList [data-remove="${pkB}"]`)), 'B is no longer A’s friend', 15000);
  await open(A);
  await post(A, 'After B left: news for friends', 'friends');
  await until(async () => (await entryTexts(A)).includes('After B left: news for friends'), 'on A');
  const keys = new Set((await env.relayEvents([{ kinds: [30820] }])).map((e) => e.tags.find((t) => t[0] === 'key')[1]));
  assert.equal(keys.size, 3, 'three keys on the relay: the space’s, friends before, friends after');
  await open(D);
  await tab(D, 'friends');
  await until(async () => (await entryTexts(D)).includes('After B left: news for friends'), 'D reads the new one', 40000);
  const newAddress = await entryOn(D, 'After B left').getAttribute('data-address');
  const oldAddress = await entryOn(D, 'Only for my friends').getAttribute('data-address');
  const [, , newD] = newAddress.split(':');
  const [, , oldD] = oldAddress.split(':');
  const pkA = await pkOf(A);
  await B.goto(`${app}#/e/${pkA}/${newD}`);
  await B.waitForSelector('#panel #notForYou', { timeout: 20000 });
  await B.goto(`${app}#/e/${pkA}/${oldD}`);
  await until(async () => (await panelTexts(B)).some((x) => x.startsWith('Only for my friends')), 'B still reads the old one', 20000);

  step('"only me": on A’s own feed, labelled so, nowhere else');
  await open(A);
  await post(A, 'Note to self: check pH tomorrow', 'me');
  await tab(A, 'mine');
  await until(async () => (await entryTexts(A)).includes('Note to self: check pH tomorrow'), 'on A');
  assert.equal(await entryOn(A, 'Note to self').getAttribute('data-audience'), 'me');
  assert.match(await entryOn(A, 'Note to self').locator('.entry-aud').textContent(), /Only me/);
  await open(D);
  await tab(D, 'friends');
  await sleep(1500);
  assert.ok(!(await entryTexts(D)).some((x) => x.includes('pH')), 'not even a friend reads it');

  step('an entry marked 18+ is folded for someone without an account, and shown to someone with one');
  await tab(A, 'space');
  await post(A, 'Flowering week 6, lights off #grow', 'space', null, 'adult');
  await until(async () => (await entryTexts(A)).includes('Flowering week 6, lights off #grow'), 'the writer sees it');
  await open(C);
  await until(async () => (await C.$$('.entry-locked[data-label=adult]')).length === 1, 'folded on C, who has no account', 20000);
  assert.ok(!(await entryTexts(C)).some((x) => x.startsWith('Flowering')), 'its text is not shown');
  assert.match(await C.textContent('.entry-locked'), /people with an account/);
  const G = await dev('G', { ...id('gus'), accountPk: 'a'.repeat(64) });
  await open(G);
  await until(async () => (await entryTexts(G)).includes('Flowering week 6, lights off #grow'), 'shown on G, who has an account', 20000);
  assert.equal((await G.textContent('.entry .badge.label-adult')).trim(), '18+');
  await G.ctx.close();

  step('editing and deleting: the space entry changes, then disappears, for the stranger too');
  await tab(A, 'space');
  await until(async () => (await entryTexts(A)).some((x) => x.startsWith('Week 1')), 'the space entry on A');
  await menu(A, 'Week 1', 'Edit');
  await A.waitForSelector('#composeForm');
  assert.equal(await A.$$eval('#composePhotos li', (els) => els.length), 1, 'the photo stays');
  await A.fill('#composeForm textarea[name=text]', 'Week 1 (edited): seedlings up #grow');
  await A.click('#composeForm .btn-primary');
  await open(C);
  await until(async () => (await entryTexts(C)).includes('Week 1 (edited): seedlings up #grow'), 'the edit on C', 20000);
  await menu(A, 'Week 1 (edited)', 'Delete…');
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await until(async () => !(await entryTexts(C)).some((x) => x.startsWith('Week 1')), 'gone on C', 20000);

  step('a link to an entry opens it on another device');
  await post(A, 'Week 2: first true leaves #grow', 'space');
  await until(async () => (await entryTexts(A)).includes('Week 2: first true leaves #grow'), 'on A');
  await menu(A, 'Week 2', 'Copy link');
  await A.waitForSelector('.toast-success');
  const link = await A.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#\/e\/[0-9a-f]{64}\/[^?]+\?s=34550%3A/, `a link into the space: ${link}`);
  await C.goto(link);
  await until(async () => (await panelTexts(C)).includes('Week 2: first true leaves #grow'), 'the linked entry, in a panel on C', 20000);
  await C.waitForSelector('#panel #commentForm');
  await C.click('#panel [data-act=panel-back]');
  await until(async () => !(await C.$('#panel')) && Boolean(await C.$('#feedTabs')), 'back closes the panel onto the feed', 10000);

  step('a diary for friends, with a cover: entries added on its page and from the composer, with their steps; the relay sees them apart');
  await open(A);
  const diaryD = await beginDiary(A, 'Autoflower run #1', 'Two plants under a **100 W** LED.', 'friends', { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  assert.match(await A.textContent('#panel .diary-head'), /Friends/);
  await until(async () => A.$eval('#panel img.diary-hero', (img) => img.complete && img.naturalWidth > 0).catch(() => false), 'the cover over the diary', 20000);
  for (const [text, at] of [
    ['Day 1: germinated in paper towels', 'Week 1'],
    ['Day 12: first nodes, watering every two days', 'Week 2'],
  ]) {
    await A.click('#addToDiary');
    await A.waitForSelector('#composeForm');
    assert.match(await A.textContent('#compose h2'), /Autoflower run #1/);
    assert.ok(await absent(A, '#composeForm select[name=audience]'), 'an entry in a diary is for the diary’s readers');
    assert.match(await A.textContent('#audienceHint'), /Friends/);
    await A.fill('#composeForm textarea[name=text]', text);
    await A.fill('#composeForm [name=step]', at);
    await A.click('#composeForm .btn-primary');
    await until(async () => !(await A.$('#composeForm')), 'composer closed', 20000);
    await until(async () => (await diaryTexts(A)).includes(text), `“${text}” in the diary`, 20000);
  }
  await A.click('#panel [data-act=panel-back]');
  await until(async () => !(await A.$('#panel')), 'back on the Diaries tab', 10000);
  await tab(A, 'space');
  await A.click('#newEntry');
  await A.waitForSelector('#composeForm');
  await A.selectOption('#composeForm select[name=diary]', { label: 'Autoflower run #1' });
  await A.waitForSelector('#composeForm [name=step]');
  assert.ok(await absent(A, '#composeForm select[name=audience]'));
  await A.fill('#composeForm textarea[name=text]', 'Day 20: stretching, raised the light');
  await A.fill('#composeForm [name=step]', 'Week 3');
  await A.click('#composeForm .btn-primary');
  await until(async () => !(await A.$('#composeForm')), 'composer closed', 20000);
  const diaries = await env.relayEvents([{ kinds: [30821] }]);
  assert.equal(diaries.length, 1, 'one diary on the relay');
  assert.ok(!diaries[0].content.includes('Autoflower'), 'its title sealed');
  const inDiary = (await env.relayEvents([{ kinds: [30820] }])).filter((e) => e.created_at >= diaries[0].created_at - 60);
  assert.ok(inDiary.length >= 3);
  assert.ok(!JSON.stringify(inDiary).includes(diaryD), 'no tag names the diary: which entries belong to it is sealed');

  step('a friend reads the diary from its beginning, the steps beside the entries; the feed points at the diary; strangers see none of it');
  await open(D);
  await tab(D, 'diaries');
  await until(async () => (await diaryCard(D, 'Autoflower run #1').count()) === 1, 'the diary on D', 40000);
  await until(async () => (await diaryCard(D, 'Autoflower run #1').textContent()).includes('ada'), 'with its writer');
  await diaryCard(D, 'Autoflower run #1').click();
  await until(async () => (await diaryTexts(D)).length === 3, 'its three entries on D', 30000);
  assert.deepEqual(await diaryTexts(D), [
    'Day 1: germinated in paper towels',
    'Day 12: first nodes, watering every two days',
    'Day 20: stretching, raised the light',
  ]);
  assert.deepEqual(await texts(D, '#panel #diaryEntries .entry-step'), ['Week 1', 'Week 2', 'Week 3']);
  assert.match(await D.textContent('#panel .diary-head'), /3 entries/);
  assert.match(await D.textContent('#panel .diary-about'), /100 W/);
  await until(async () => D.$eval('#panel img.diary-hero', (img) => img.complete && img.naturalWidth > 0).catch(() => false), 'the cover opens on D', 20000);
  assert.ok(await absent(D, '#addToDiary'), 'only its writer adds to it');
  await D.click('#panel [data-act=panel-back]');
  await until(async () => !(await D.$('#panel')), 'back on the Diaries tab', 10000);
  await tab(D, 'friends');
  await until(async () => (await entryTexts(D)).includes('Day 20: stretching, raised the light'), 'the entry in D’s feed', 20000);
  assert.match(await entryOn(D, 'Day 20').locator('.entry-diary').textContent(), /In Autoflower run #1 · Week 3/);
  await open(C);
  await tab(C, 'diaries');
  await sleep(1500);
  assert.equal(await diaryCard(C, 'Autoflower run #1').count(), 0, 'the stranger does not see the diary');
  await C.goto(`${app}#/d/${pkA}/${diaryD}`);
  await C.waitForSelector('#panel #notForYou', { timeout: 20000 });
  await tab(C, 'space');

  step('a second diary, for the space; a reader pins the first to the top of the Diaries tab, and it stays pinned');
  await open(A);
  await beginDiary(A, 'Balcony tomatoes', 'Three pots, one balcony.', 'space');
  await A.click('#panel [data-act=panel-back]');
  await open(D);
  await tab(D, 'diaries');
  await until(async () => (await texts(D, '.diary-card .diary-title')).join('|') === 'Balcony tomatoes|Autoflower run #1', 'both, the one written to last first', 30000);
  await D.locator('.collection-item', { has: diaryCard(D, 'Autoflower run #1') }).locator('.pin-btn').click();
  await until(async () => (await D.$$('[data-part=pinned] .diary-card[data-title="Autoflower run #1"]')).length === 1, 'pinned on top', 10000);
  await open(D);
  await until(async () => (await D.$$('[data-part=pinned] .diary-card[data-title="Autoflower run #1"]')).length === 1, 'still pinned after a reload', 20000);
  // someone without an account sees a title once its marks are known (an 18+ diary is folded for them)
  await until(async () => (await texts(D, '.diary-card .diary-title')).join('|') === 'Autoflower run #1|Balcony tomatoes', 'the pinned one first', 10000);

  step('the writer pins the diary and an entry to their profile: on top of their page, for whoever can read them');
  await open(A);
  await tab(A, 'diaries');
  await diaryCard(A, 'Autoflower run #1').click();
  await A.waitForSelector('#panel #diaryEntries');
  await act(A, '#panel [data-act=diary-menu]', 'pin-profile');
  await A.waitForSelector('.toast-success');
  await A.click('#panel [data-act=panel-back]');
  await tab(A, 'space');
  await until(async () => (await entryTexts(A)).includes('Week 2: first true leaves #grow'), 'the space entry on A');
  await menu(A, 'Week 2: first true', 'Pin to my profile');
  await until(async () => Boolean(await entryOn(A, 'Week 2: first true').locator('[data-pinned]').count()), 'marked pinned on A', 10000);
  await D.goto(`${app}#/p/${pkA}`);
  await until(
    async () => (await D.$$('#personPinned .diary-card[data-title="Autoflower run #1"]')).length === 1 && (await texts(D, '#personPinned .entry-text')).includes('Week 2: first true leaves #grow'),
    'D sees both pinned on A’s page',
    30000,
  );
  assert.deepEqual(await texts(D, '#personDiaries .diary-title'), ['Balcony tomatoes'], 'the other diaries below, the pinned one not twice');
  await C.goto(`${app}#/p/${pkA}`);
  await until(async () => (await texts(C, '#personPinned .entry-text')).includes('Week 2: first true leaves #grow'), 'C sees the pinned space entry', 30000);
  assert.ok(await absent(C, '#personPinned .diary-card'), 'not the friends’ diary');

  step('finished, then deleted: a finished diary takes no more entries; a deleted one is gone, its entries stay');
  await A.goto(`${app}#/d/${pkA}/${diaryD}`);
  await A.waitForSelector('#panel #diaryEntries');
  await act(A, '#panel [data-act=diary-menu]', 'finish');
  await until(async () => Boolean(await A.$('#panel .diary-head [data-done]')) && (await absent(A, '#addToDiary')), 'finished on A', 10000);
  await A.goto(app);
  await A.waitForSelector('#feedTabs');
  await tab(A, 'diaries');
  await diaryCard(A, 'Balcony tomatoes').click();
  await A.waitForSelector('#panel #addToDiary');
  await act(A, '#panel [data-act=diary-menu]', 'delete-diary');
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await until(async () => !(await A.$('#panel')) && (await diaryCard(A, 'Balcony tomatoes').count()) === 0, 'gone on A', 20000);
  await open(D);
  await until(async () => (await diaryCard(D, 'Balcony tomatoes').count()) === 0, 'gone on D', 20000);
  assert.equal(await diaryCard(D, 'Autoflower run #1').locator('[data-done]').count(), 1, 'the other shows as finished');
  await tab(D, 'friends');
  await tab(A, 'space');

  if (moderator) {
    step('a moderator of the space reports an entry: it is folded away for everyone else, not for its writer');
    await post(A, 'Buy cheap followers here', 'space');
    // an account, so a mark does not fold what the moderator looks at
    const M = await dev('M', { ...moderator, alias: 'mod', created: Date.now(), accountPk: 'b'.repeat(64) });
    await open(M);
    await until(async () => (await entryTexts(M)).includes('Buy cheap followers here'), 'the entry on M', 20000);
    await menu(M, 'Buy cheap followers', 'Report…');
    await M.waitForSelector('#reportForm');
    await M.selectOption('#reportForm [name=type]', 'spam');
    await M.click('#reportForm .btn-danger');
    await until(async () => !(await M.$('#reportForm')), 'report sent', 20000);
    await open(C);
    await until(async () => (await C.$$('.entry.folded')).length === 1, 'folded on C', 20000);
    assert.match(await C.textContent('.entry.folded'), /moderator of this space/);
    await C.click('.entry.folded [data-act=reveal]');
    await until(async () => (await C.$$('.entry.folded')).length === 0, 'shown on request');
    await open(A);
    assert.ok(await absent(A, '.entry.folded'), 'the writer sees it as it is');

    step('an ad nobody marked: reported as one, the moderator finds it under Reported and marks it; “fine” lifts the mark');
    await post(A, 'Nutrient sale: 20% off this week', 'space');
    await open(C);
    await until(async () => (await entryTexts(C)).includes('Nutrient sale: 20% off this week'), 'shown on C at first', 20000);
    await menu(C, 'Nutrient sale', 'Report…');
    await C.waitForSelector('#reportForm');
    assert.deepEqual((await texts(C, '#reportForm [name=type] option')).slice(0, 2), ['Should be marked 18+', 'An ad that isn’t marked']);
    await C.selectOption('#reportForm [name=type]', 'ad');
    await C.click('#reportForm .btn-danger');
    await until(async () => !(await C.$('#reportForm')), 'report sent', 20000);
    assert.match(await C.textContent('.toast-success'), /once another person or a moderator agrees/);
    assert.ok(await absent(C, '.entry-locked[data-label=ad]'), 'one report does not mark it');
    await open(M);
    await tab(M, 'review');
    await until(async () => (await entryTexts(M)).includes('Nutrient sale: 20% off this week'), 'under Reported on M', 20000);
    assert.equal((await entryTexts(M)).length, 1, 'only what waits for a review');
    assert.match(await M.textContent('.entry-review'), /1 report waits for your review/);
    await menu(M, 'Nutrient sale', 'Mark as an ad');
    await until(async () => (await entryTexts(M)).length === 0, 'reviewed: off the Reported tab', 20000);
    // C was away when the moderator marked it: the entry must not show for a moment before the mark is known
    await C.ctx.addInitScript(() => {
      window.__flashed = false;
      new MutationObserver(() => {
        if ([...document.querySelectorAll('.entry .entry-text')].some((e) => e.textContent.includes('Nutrient sale'))) window.__flashed = true;
      }).observe(document, { subtree: true, childList: true });
    });
    await open(C);
    await until(async () => (await C.$$('.entry-locked[data-label=ad]')).length === 1, 'folded as an ad on C, who has no account', 20000);
    assert.equal(await C.evaluate(() => window.__flashed), false, 'never shown on C, not for a moment');
    await open(A);
    await until(async () => Boolean(await A.$('.entry .badge.label-ad[data-by=moderator]')), 'the writer sees the moderator’s mark', 20000);
    await tab(M, 'space');
    await until(async () => (await entryTexts(M)).includes('Nutrient sale: 20% off this week'), 'in the space on M');
    await menu(M, 'Nutrient sale', 'Fine as it is');
    await open(C);
    // C's store still holds the moderator's earlier mark: the entry shows folded first, until "fine" comes in
    await until(
      async () => (await entryTexts(C)).includes('Nutrient sale: 20% off this week') && (await absent(C, '.entry-locked[data-label=ad]')),
      'shown on C again, no longer folded as an ad',
      20000,
    );

    step('a diary is reported and marked as an entry is: under Reported for the moderator, then an ad for someone without an account');
    await open(A);
    await beginDiary(A, 'Clone shop diary', 'Cuttings for sale, write me.', 'space');
    await A.click('#panel [data-act=panel-back]');
    await tab(A, 'space');
    await open(C);
    await tab(C, 'diaries');
    await until(async () => (await diaryCard(C, 'Clone shop diary').count()) === 1, 'the diary on C', 20000);
    await until(async () => (await diaryCard(C, 'Clone shop diary').locator('.diary-title').textContent()) === 'Clone shop diary', 'its title on C');
    await diaryCard(C, 'Clone shop diary').click();
    await C.waitForSelector('#panel #diary');
    await act(C, '#panel [data-act=diary-menu]', 'report');
    await C.waitForSelector('#reportForm');
    await C.selectOption('#reportForm [name=type]', 'ad');
    await C.click('#reportForm .btn-danger');
    await until(async () => !(await C.$('#reportForm')), 'report sent', 20000);
    await open(M);
    await tab(M, 'review');
    await until(async () => (await M.$$('#reportedDiaries .diary-card[data-title="Clone shop diary"]')).length === 1, 'under Reported on M', 20000);
    await diaryCard(M, 'Clone shop diary').click();
    await M.waitForSelector('#panel #diary');
    await act(M, '#panel [data-act=diary-menu]', 'mark-ad');
    await until(async () => (await M.$$('#reportedDiaries .diary-card')).length === 0, 'reviewed: off the Reported tab', 20000);
    await open(C);
    await until(async () => (await C.$$('.diary-card[data-label=ad][data-title="Clone shop diary"]')).length === 1, 'an ad on C', 20000);
    assert.match(await diaryCard(C, 'Clone shop diary').locator('.diary-title').textContent(), /shown to people with an account/);
    await tab(C, 'space');
    await M.ctx.close();
  }

  step('blocking a writer hides their entries');
  await open(C);
  await until(async () => (await entryTexts(C)).includes('Week 2: first true leaves #grow'), 'A’s entry on C');
  await menu(C, 'Week 2', 'Block this person');
  await until(async () => (await entryTexts(C)).length === 0, 'A’s entries gone on C', 15000);

  if (club) {
    step('a mount that asks for an account: a key alone gets the gate, registers, and comes back');
    const E = await dev('E', id(null));
    await E.goto(club);
    await E.waitForSelector('#accountGate');
    assert.match(await E.textContent('#accountGateTitle'), /asks for an account/);
    assert.ok(await absent(E, '#newEntry'), 'nothing of the feed behind it');
    await E.click('#accountGateGo');
    await E.waitForSelector('#returnNote');
    assert.match(await E.textContent('#returnNote'), /asks for an account/);
    await E.check('input[name=authTab][value=create]', { force: true });
    await E.fill('#authForm [name=alias]', `club${Date.now().toString(36)}`);
    await E.fill('#authForm [name=pass]', 'a long enough password');
    await E.fill('#authForm [name=pass2]', 'a long enough password');
    await E.click('#authBtn');
    await until(async () => E.url().startsWith(club), 'back on the mount after registering', 90000);
    await E.waitForSelector('#newEntry', { timeout: 20000 });
    assert.ok(await absent(E, '#accountGate'));
    await E.goto(club.replace(/[^/]+\/$/, ''));
    await E.waitForSelector('#apps');
    assert.ok(await E.$(`[data-app=${club.split('/').filter(Boolean).pop()}] .badge.account`), 'the start page marks the mount');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const mod = keypair();
  const hubId = 'feed-hub';
  const address = spaceAddress(getPublicKey(hexToBytes(spaceKey(hubId, 'grow'))), 'grow');
  const site = await testHub(
    [
      { app: 'feed', id: 'outpost', name: 'Outpost', icon: 'sprout', space: 'grow' },
      { app: 'feed', id: 'club', name: 'Club', icon: 'newspaper', requireAccount: true },
    ],
    { id: hubId, name: 'Feed hub', spaces: [{ id: 'grow', name: 'Grow reports', moderators: [mod.pk] }] },
  );
  await run(
    'feed',
    (env) => feedSuite(env, { app: `${env.base}outpost/`, settings: `${env.base}settings.html`, space: address, moderator: mod, club: `${env.base}club/` }),
    { webRoot: site },
  );
}
