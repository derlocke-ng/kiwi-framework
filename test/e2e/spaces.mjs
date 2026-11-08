// Spaces: one hub mounts the notices app twice, each mount on a space of its own: `jobs` with a relay of
// its own, `gigs` on the hub's relays, with a moderator. Nothing of one shows on the other; the jobs
// notes live on the space's relay alone; the hub publishes the spaces' definitions. A second hub serves
// the jobs space by its address from another host (its relays from hub.local.json) and sees the same
// notes; a note's link opens on the mount that serves its space, on either hub, and a hub that serves
// no such space says so. A moderator's report collapses a note by itself. hub.json lists the spaces.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { device, freePort, run, sleep, testHub, until } from './env.mjs';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { spaceAddress, spaceKey } from '../../shared/spaces.js';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const POW = 8;

const [hubPort, spacePort, yPort, zPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
const HUB_RELAY = `ws://localhost:${hubPort}`;
const SPACE_RELAY = `ws://localhost:${spacePort}`;
const Y_RELAY = `ws://localhost:${yPort}`;
const Z_RELAY = `ws://localhost:${zPort}`;
// the moderator of gigs: a key the test holds, so the config can name it
const modSk = bytesToHex(generateSecretKey());
const modPk = getPublicKey(hexToBytes(modSk));
// the jobs space nobody owns: its key comes from the hub's id and its own, so a second hub can name its address
const jobsOwner = getPublicKey(hexToBytes(spaceKey('agora', 'jobs')));
const JOBS = spaceAddress(jobsOwner, 'jobs');
const sticky = { app: 'notices', icon: 'sticky-note' };

const siteX = await testHub(
  [
    { ...sticky, id: 'jobs', name: 'Jobs', space: 'jobs' },
    { ...sticky, id: 'gigs', name: 'Gigs', space: 'gigs' },
  ],
  {
    id: 'agora',
    name: 'Agora',
    relays: [HUB_RELAY],
    spaces: [
      { id: 'jobs', name: 'Jobs board', description: 'Work for hire.', relays: [SPACE_RELAY], rules: 'Be concrete.' },
      { id: 'gigs', name: 'Gigs', description: 'Small jobs.', moderators: [modPk], adult: true },
    ],
  },
);
// Y: another hub serving the jobs space by its address, from a host and a relay of its own; where the space's
// events are comes from the host's hub.local.json, as a container's environment would set it
const siteY = await testHub([{ ...sticky, id: 'jobs', name: 'Jobs (mirror)', space: 'jobs' }], {
  id: 'elsewhere',
  name: 'Elsewhere',
  relays: [Y_RELAY],
  spaces: [{ id: 'jobs', owner: jobsOwner, name: 'Jobs (mirror)' }],
});
fs.writeFileSync(path.join(siteY, 'hub.local.json'), JSON.stringify({ spaces: { jobs: { relays: [SPACE_RELAY] } } }));
// Z: a hub that serves a space of its own and none of Agora's
const siteZ = await testHub([{ ...sticky, name: 'Notices', space: 'other' }], { id: 'nowhere', name: 'Nowhere', relays: [Z_RELAY], spaces: [{ id: 'other', name: 'Other' }] });

async function main(env) {
  const X = env.base;
  const Y = await env.serve(siteY);
  const Z = await env.serve(siteZ);
  const init = ({ pow, identity }) => {
    localStorage.setItem('devboard.pow', String(pow));
    if (identity) localStorage.setItem('wjs.identity', JSON.stringify(identity));
  };
  const dev = (name, options = {}, identity = null) => device(env, name, init, { pow: POW, identity }, options);
  const titles = (page) => texts(page, '.note h3');
  const noteOn = (page, title) => page.locator('.note', { has: page.locator('h3', { hasText: title }) });
  const network = (page) => page.$eval('#sync', (el) => el.dataset.network);
  const onHub = (filters) => env.relayEvents(filters, 'hub');
  const onSpace = (filters) => env.relayEvents(filters, 'space');
  const onY = (filters) => env.relayEvents(filters, 'y');
  const onZ = (filters) => env.relayEvents(filters, 'z');
  const spaceTagOf = (ev) => ev.tags.find((t) => t[0] === 'a' && t[1].startsWith('34550:'))?.[1] || null;

  async function open(page, url) {
    await page.goto(url);
    await page.waitForSelector('#postBtn');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  }
  async function pin(page, title, text = 'Short and concrete.') {
    await page.click('#postBtn');
    await page.waitForSelector('#compose');
    await page.fill('#compose [name=title]', title);
    await page.fill('#compose [name=text]', text);
    await page.fill('#compose [name=contact]', 'me@example.com');
    await page.click('#compose .btn-primary');
    await until(async () => !(await page.$('#compose')), 'compose closed after mining', 30000);
    await until(async () => (await titles(page)).includes(title), `"${title}" on the board`, 15000);
  }
  async function menu(page, title, label) {
    await noteOn(page, title).locator('[data-act=menu]').click();
    await page.waitForSelector('.menu [data-i]');
    const items = await texts(page, '.menu [data-i]');
    const i = items.indexOf(label);
    assert.ok(i >= 0, `menu has "${label}": ${items.join(', ')}`);
    await page.click(`.menu [data-i="${i}"]`);
  }

  step('the jobs board is on the space’s own relay: the page says so, the space’s name and rules show, a note goes there and nowhere else, tagged with the space');
  const A = await dev('A', { permissions: ['clipboard-read', 'clipboard-write'] });
  await open(A, `${X}jobs/`);
  assert.equal(await network(A), 'space:jobs', 'the page’s network is the space’s');
  assert.equal(await A.title(), 'Jobs', 'the tab says the mount’s name');
  assert.equal((await A.textContent('#spaceHead .space-name')).trim(), 'Jobs board', 'the space’s name, from the config');
  assert.match(await A.textContent('#spaceHead'), /Work for hire/);
  assert.match(await A.textContent('#spaceHead .space-rules'), /Be concrete/);
  assert.equal(await A.$('#spaceHead .badge.adult'), null, 'not for adults');
  await pin(A, 'Jobs: React dev wanted', 'Shop relaunch, remote.');
  const jobsNotes = await onSpace([{ kinds: [30810] }]);
  assert.equal(jobsNotes.length, 1, 'the note is on the space’s relay');
  assert.equal(spaceTagOf(jobsNotes[0]), JOBS, 'and names its space');
  assert.equal(jobsNotes[0].tags.find((t) => t[0] === 'a')[2], SPACE_RELAY, 'with a relay where it lives, as NIP-72 wants');
  await sleep(1000);
  assert.equal((await onHub([{ kinds: [30810] }])).length, 0, 'nothing of it on the hub’s relay');

  step('the hub publishes the definitions of the spaces nobody owns: jobs on its relay, gigs on the hub’s, each with its tags');
  await until(async () => (await onSpace([{ kinds: [34550] }])).length === 1, 'the jobs definition on the space’s relay', 20000);
  const jobsDef = (await onSpace([{ kinds: [34550] }]))[0];
  assert.equal(jobsDef.pubkey, jobsOwner, 'under the derived key');
  assert.deepEqual(jobsDef.tags.find((t) => t[0] === 'name'), ['name', 'Jobs board']);
  assert.deepEqual(jobsDef.tags.find((t) => t[0] === 'relay'), ['relay', SPACE_RELAY]);
  assert.deepEqual(jobsDef.tags.find((t) => t[0] === 'rules'), ['rules', 'Be concrete.']);
  assert.equal((await onSpace([{ kinds: [34550], '#d': ['gigs'] }])).length, 0, 'gigs is not defined on the jobs relay');
  const B = await dev('B', {}, { sk: modSk, pk: modPk, alias: null, created: Date.now() }); // the moderator of gigs
  await open(B, `${X}gigs/`);
  assert.equal(await network(B), 'hub', 'gigs has no relays of its own: the hub’s network');
  assert.equal((await B.textContent('#spaceHead .space-name')).trim(), 'Gigs');
  assert.ok(await B.$('#spaceHead .badge.adult'), 'gigs is for adults');
  await until(async () => (await onHub([{ kinds: [34550] }])).length === 1, 'the gigs definition on the hub’s relay', 20000);
  const gigsDef = (await onHub([{ kinds: [34550] }]))[0];
  assert.deepEqual(gigsDef.tags.find((t) => t[0] === 'p'), ['p', modPk, '', 'moderator']);
  assert.deepEqual(gigsDef.tags.find((t) => t[0] === 'adult'), ['adult', '1']);

  step('the two boards never mix: a gigs note is on the hub’s relay, tagged gigs, unseen on jobs; the jobs note is unseen on gigs');
  assert.deepEqual(await titles(B), [], 'the jobs note is not on the gigs board');
  await pin(B, 'Gigs: Logo for a bakery');
  const gigsNotes = await onHub([{ kinds: [30810] }]);
  assert.equal(gigsNotes.length, 1);
  assert.equal(spaceTagOf(gigsNotes[0]), gigsDef.tags.find((t) => t[0] === 'd') && `34550:${gigsDef.pubkey}:gigs`);
  await sleep(1500);
  assert.deepEqual(await titles(A), ['Jobs: React dev wanted'], 'the gigs note is not on the jobs board');
  assert.equal((await onSpace([{ kinds: [30810] }])).length, 1, 'and not on the jobs relay');

  step('a board on no space shows notes in no space: the app’s own route sees neither');
  const N = await dev('N');
  await open(N, `${X}notices/`);
  assert.equal(await network(N), 'hub');
  assert.equal(await N.$('#spaceHead'), null, 'no space, no head');
  await sleep(2000);
  assert.deepEqual(await titles(N), [], 'notes that name a space stay off a board on none');

  step('another device on the jobs board reads the space’s relay and votes there');
  await open(B, `${X}jobs/`);
  await until(async () => (await titles(B)).includes('Jobs: React dev wanted'), 'the jobs note on B', 20000);
  await noteOn(B, 'Jobs: React dev wanted').locator('[data-act=up]').click();
  await until(async () => (await onSpace([{ kinds: [7] }])).length === 1, 'the vote on the space’s relay', 15000);
  await until(async () => (await A.textContent('.note .score')) === '+1', 'the vote reaches A', 20000);
  assert.equal((await onHub([{ kinds: [7] }])).length, 0, 'no vote on the hub’s relay');

  step('a note’s link names the space and where it lives; opened under the other mount, this hub goes to the one serving the space');
  await menu(A, 'Jobs: React dev wanted', 'Copy link');
  await A.waitForSelector('.toast-success');
  const link = await A.evaluate(() => navigator.clipboard.readText());
  assert.match(link, new RegExp(`^${X.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}jobs/#/n/[0-9a-f]{64}/[^?]+\\?s=${encodeURIComponent(JOBS).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}&h=.*&r=localhost%3A${spacePort}$`), `the link: ${link}`);
  const hash = link.slice(link.indexOf('#'));
  await B.goto(`${X}gigs/${hash}`);
  await until(async () => B.url().startsWith(`${X}jobs/#/n/`), 'redirected to the jobs mount', 15000);
  await B.waitForSelector('.note.focus', { timeout: 20000 });
  assert.equal((await B.textContent('.note.focus h3')).trim(), 'Jobs: React dev wanted', 'the linked note is in focus');

  step('a second hub serves the jobs space from its own host: it reads the same notes, shows the relays’ definition, and its vote reaches the first');
  const C = await dev('C');
  await open(C, `${Y}jobs/${hash}`);
  assert.equal(await network(C), 'space:jobs', 'the mirror is on the space’s network too (relays from hub.local.json)');
  await C.waitForSelector('.note.focus', { timeout: 20000 });
  assert.equal((await C.textContent('#spaceHead .space-name')).trim(), 'Jobs board', 'the definition from the relays wins over the mirror’s config name');
  await noteOn(C, 'Jobs: React dev wanted').locator('[data-act=up]').click();
  await until(async () => (await A.textContent('.note .score')) === '+2', 'the mirror’s vote reaches A', 20000);
  await sleep(500);
  assert.equal((await onY([{ kinds: [30810, 7] }])).length, 0, 'nothing of the space on the mirror hub’s own relay');
  const yHub = await (await fetch(`${Y}hub.json`)).json();
  assert.equal(yHub.spaces[0].address, JOBS, 'the mirror’s hub.json names the same space');
  assert.equal(yHub.spaces[0].owned, true);

  step('a hub that serves no such space says so and offers the page the link came from');
  const D = await dev('D');
  await D.goto(`${Z}notices/${hash}`);
  await D.waitForSelector('#foreignSpace');
  assert.match(await D.textContent('#foreignSpace'), /space “jobs”, which this hub does not serve/);
  assert.equal(await D.getAttribute('#foreignSpace a', 'href'), `${X}jobs/${hash}`, 'the way back is the page the link came from');
  assert.equal((await D.textContent('#spaceHead .space-name')).trim(), 'Other', 'its own board stays what it is');
  await sleep(1500);
  assert.equal((await onZ([{ kinds: [30810] }])).length, 0);

  step('a moderator’s report collapses a note for everyone on the spot');
  await open(A, `${X}gigs/`);
  await pin(A, 'Gigs: Totally not spam');
  const E = await dev('E');
  await open(E, `${X}gigs/`);
  await until(async () => (await titles(E)).includes('Gigs: Totally not spam'), 'the note on E', 20000);
  assert.equal(await E.$('.note.collapsed'), null, 'not collapsed yet');
  await open(B, `${X}gigs/`);
  await until(async () => (await titles(B)).includes('Gigs: Totally not spam'), 'the note on the moderator’s device', 20000);
  await menu(B, 'Gigs: Totally not spam', 'Report…');
  await B.waitForSelector('#reportForm');
  await B.click('#reportForm .btn-danger');
  await until(async () => !(await B.$('#reportForm')), 'report sent', 30000);
  await until(async () => (await E.$$('.note.collapsed')).length === 1, 'collapsed on E by the one report', 20000);
  assert.match(await E.textContent('.note.collapsed'), /reported/);
  assert.equal(await A.$('.note.collapsed'), null, 'the author still sees their own note opened');

  step('hub.json lists the spaces with their addresses and relays, and which mount serves which');
  const hub = await (await fetch(`${X}hub.json`)).json();
  assert.deepEqual(
    hub.spaces.map((s) => [s.id, s.address, s.relays, s.owned, s.adult]),
    [
      ['jobs', JOBS, [SPACE_RELAY], false, false],
      ['gigs', `34550:${gigsDef.pubkey}:gigs`, [], false, true],
    ],
  );
  assert.deepEqual(hub.spaces[1].moderators, [modPk]);
  assert.deepEqual(
    hub.mounts.map((m) => [m.id, m.space]),
    [
      ['jobs', 'jobs'],
      ['gigs', 'gigs'],
    ],
  );

  step('the settings list the spaces: name, address, relays, that the relays hold a definition');
  await A.goto(`${X}settings.html#spaces`);
  await A.waitForSelector('#spaceList');
  await until(async () => (await A.$$('#spaceList [data-space][data-defined=yes]')).length === 2, 'both definitions known', 20000);
  assert.match(await A.textContent('#spaceList [data-space=jobs]'), new RegExp(`Jobs board[\\s\\S]*localhost:${spacePort}[\\s\\S]*${JOBS}`));
  assert.match(await A.textContent('#spaceList [data-space=gigs]'), /Gigs[\s\S]*On the hub’s relays[\s\S]*1 moderator/);
}

await run('spaces', main, { webRoot: siteX, nostrPort: hubPort, extraRelays: { space: spacePort, y: yPort, z: zPort } });
