// The feed app in Chromium: a hub mounts it twice, as Outpost on a space (with a moderator) and as Club,
// a feed on no space that asks for an account. Entries for the space, for friends and for "only me", with
// a photo; who can read what, on the relay and on the screen; a friend added later reads what was posted
// under the current key, an unfriended one reads nothing new; likes and comments; edits and deletions;
// a moderator's report folds an entry; a link opens the entry; the account gate sends a person with a key
// alone to register and brings them back.
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
import { device, run, sleep, testHub, until } from './env.mjs';

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
  const entryOn = (page, text) => page.locator('.entry', { has: page.locator('.entry-text', { hasText: text }) });
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);

  async function open(page, url = app) {
    await page.goto(url);
    await page.waitForSelector('#newEntry');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  }
  async function tab(page, which) {
    await page.check(`input[name=tab][value=${which}]`, { force: true });
  }
  async function post(page, text, audience, photo = null) {
    await page.click('#newEntry');
    await page.waitForSelector('#composeForm');
    await page.fill('#composeForm textarea[name=text]', text);
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
  assert.deepEqual(await A.$$eval('input[name=tab]', (els) => els.map((e) => e.value)), ['space', 'friends', 'mine']);
  assert.match(await A.textContent('.feed'), /Nothing in this space yet/);

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
  await until(async () => C.$eval('.entry-photo img', (img) => img.complete && img.naturalWidth > 0).catch(() => false), 'the photo opens on C', 20000);
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
  await entryOn(B, 'Only for my friends').locator('[data-act=comments]').click();
  await B.waitForSelector('#commentForm');
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
  await until(async () => (await A.textContent('.entry .like-count')) === '1', 'A sees the like', 20000);

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
  await B.waitForSelector('#notForYou', { timeout: 20000 });
  await B.goto(`${app}#/e/${pkA}/${oldD}`);
  await until(async () => (await entryTexts(B)).some((x) => x.startsWith('Only for my friends')), 'B still reads the old one', 20000);

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
  await until(async () => (await entryTexts(C)).includes('Week 2: first true leaves #grow'), 'the linked entry on C', 20000);
  await C.waitForSelector('#commentForm');

  if (moderator) {
    step('a moderator of the space reports an entry: it is folded away for everyone else, not for its writer');
    await post(A, 'Buy cheap followers here', 'space');
    const M = await dev('M', { ...moderator, alias: 'mod', created: Date.now() });
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
    assert.equal(await A.$('.entry.folded'), null, 'the writer sees it as it is');
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
    assert.equal(await E.$('#newEntry'), null, 'nothing of the feed behind it');
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
    assert.equal(await E.$('#accountGate'), null);
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
