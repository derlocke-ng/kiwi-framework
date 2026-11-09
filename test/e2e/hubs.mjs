// A semi-public, private hub: its own relay (inside its network: the "VPN") and a public relay for
// the public area. Boards live on the hub's network, the chat on the public one. An insider and an
// outsider, who reaches only the public relay from a hub of their own, talk in the chat; nothing of
// the hub's own network reaches the public relay, not even by healing; the hub's relays cannot be
// edited; and while the hub's relay is away, the hub's pages wait and the public area goes on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { absent, device, freePort, run, sleep, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

const hubPort = await freePort();
const publicPort = await freePort();
const HUB_RELAY = `ws://localhost:${hubPort}`;
const PUBLIC_RELAY = `ws://localhost:${publicPort}`;
const apps = [
  { app: 'boards', name: 'Boards', icon: 'list-checks' },
  { app: 'chat', name: 'Chat', icon: 'message-circle', network: 'public' },
];
const site = await testHub(apps, { name: 'Acme', relays: [HUB_RELAY], publicRelays: [PUBLIC_RELAY], policy: { relays: 'locked', requireHub: true } });
// the outsider's hub: a public hub whose own network is the public relay. It is built with a relay that
// does not exist, and the host's hub.local.json (what a container's environment writes) names the real
// one and locks it: the deployment decides, the build does not.
const outside = await testHub([{ app: 'chat', name: 'Chat', icon: 'message-circle' }], { name: 'Elsewhere', relays: ['ws://localhost:1'] });
fs.writeFileSync(path.join(outside, 'hub.local.json'), JSON.stringify({ relays: [PUBLIC_RELAY], policy: { relays: 'locked' } }));

async function main(env) {
  const BOARDS = `${env.base}boards/`;
  const CHAT = `${env.base}chat/`;
  const SETTINGS = `${env.base}settings.html`;
  const outsideBase = await env.serve(outside);
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
  const messages = (page) => texts(page, '#messages .msg p');
  const connected = async (page) => until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  const say = async (page, text) => {
    await page.fill('#composer textarea', text);
    await page.press('#composer textarea', 'Enter');
  };
  const onHub = (filters) => env.relayEvents(filters, 'hub');
  const onPublic = (filters) => env.relayEvents(filters, 'public');

  step('an insider makes a board: it is on the hub’s relay and nowhere else; the settings too');
  const A = await device(env, 'A', null, null);
  await A.goto(BOARDS);
  await A.waitForSelector('.home');
  await connected(A);
  assert.equal(await A.$eval('#sync', (el) => el.dataset.network), 'hub', 'the boards page is on the hub’s network');
  await A.click('[data-new="check"]');
  await A.fill('#newBoard input[name=title]', 'Internal plan');
  await A.click('#newBoard [type=submit]');
  await A.waitForSelector('#boardName', { timeout: 15000 });
  const pkA = await pkOf(A);
  await until(async () => (await onHub([{ kinds: [30700, 30701, 30702, 30703] }])).length >= 1, 'the board on the hub’s relay', 20000);
  await sleep(1500);
  assert.equal((await onPublic([{ kinds: [30700, 30701, 30702, 30703, 30791] }])).length, 0, 'nothing of the board, no settings, on the public relay');

  step('the chat is the public area: its page is on the public network, with a badge on the start page');
  await A.goto(env.base);
  await A.waitForSelector('#apps');
  assert.ok(await A.$('[data-app=chat] .badge.public'), 'the chat card says public');
  assert.ok(await absent(A, '[data-app=boards] .badge.public'), 'the boards card does not');
  await A.goto(CHAT);
  await A.waitForSelector('#chatTabs');
  await connected(A);
  assert.equal(await A.$eval('#sync', (el) => el.dataset.network), 'public', 'the chat page is on the public network');

  step('an outsider, on a hub of their own that reaches only the public relay, writes to the insider by key; the answer goes back the same way');
  const B = await device(env, 'B', null, null);
  await B.goto(`${outsideBase}chat/`);
  await B.waitForSelector('#chatTabs');
  await connected(B);
  const pkB = await pkOf(B);
  await B.goto(`${outsideBase}chat/#/dm/${pkA}`);
  await B.waitForSelector('#composer textarea');
  await say(B, 'hello from outside');
  await until(async () => (await texts(A, '#convs .conv-name')).length === 1, 'the insider sees the conversation', 30000);
  await A.goto(`${CHAT}#/dm/${pkB}`);
  await A.waitForSelector('#composer textarea');
  await until(async () => (await messages(A)).includes('hello from outside'), 'the outsider’s message on A', 20000);
  await say(A, 'hi outsider');
  await until(async () => (await messages(B)).includes('hi outsider'), 'the answer reached the outsider', 30000);
  await until(async () => (await onPublic([{ kinds: [1059], '#p': [pkB] }])).length >= 1, 'the answer travelled over the public relay', 10000);
  assert.equal((await onHub([{ kinds: [1059], '#p': [pkB] }])).length, 0, 'nothing for the outsider went to the hub’s relay');
  assert.ok((await onHub([{ kinds: [1059], '#p': [pkA] }])).length >= 1, 'the insider’s own copy stays on the hub’s relay');

  step('the outsider asks to be friends over the public relay; the insider accepts in the settings; the accept goes the same way');
  await B.click('[data-act=menu]');
  await B.click('.menu button:has-text("Add as friend")');
  await B.waitForSelector('.toast-success');
  await A.goto(`${SETTINGS}#people`);
  await A.waitForSelector('#people');
  await until(async () => (await A.$$('#people [data-accept]')).length === 1, 'the request on A', 30000);
  await A.click('#people [data-accept]');
  await until(async () => (await A.$$('#people [data-message]')).length === 1, 'friends on A', 20000);
  await B.goto(`${outsideBase}settings.html#people`);
  await B.waitForSelector('#people');
  await until(async () => (await B.$$('#people [data-message]')).length === 1, 'friends on B', 30000);
  await B.goto(`${outsideBase}settings.html#relays`);
  await B.waitForSelector('#relays');
  assert.ok(await B.$('#relaysLocked'), 'the outsider’s hub took its relays and the lock from hub.local.json');
  assert.deepEqual((await texts(B, '#relayList .relay-name')).map((x) => x.split(' ')[0]), [`localhost:${publicPort}`], 'the host’s relay, not the built one');
  assert.ok(JSON.parse(await (await fetch(`${outsideBase}hub.json`)).text()).relays.includes('ws://localhost:1'), 'hub.json still says what was built');
  await until(async () => (await onHub([{ kinds: [30791], authors: [pkA] }])).length >= 1, 'the insider’s settings (the friends list) are on the hub’s relay', 10000);
  assert.equal((await onPublic([{ kinds: [30791], authors: [pkA] }])).length, 0, 'and not on the public one');

  step('the hub’s relays are locked: no editing; the public area’s relays are listed beside them');
  await A.goto(`${SETTINGS}#relays`);
  await A.waitForSelector('#relays');
  assert.ok(await A.$('#relaysLocked'), 'the lock note');
  assert.ok(await absent(A, '#relayForm'), 'no form to edit the relays');
  const names = async (sel) => (await texts(A, `${sel} .relay-name`)).map((x) => x.split(' ')[0]);
  assert.deepEqual(await names('#relayList'), [`localhost:${hubPort}`], 'the hub’s own relay, alone');
  assert.deepEqual(await names('#relayListPublic'), [`localhost:${publicPort}`], 'the public relay, alone');
  assert.match(await A.textContent('#relays'), /Chat/, 'the public area names its mount');

  step('healing fills the relays that miss something, each with its own network’s events only');
  // the outsider's own settings are on the public relay by right: it is their hub's own network; the insider's must not be
  const ofA = async (which) => (await env.relayEvents([{ kinds: [30791, 30790], authors: [pkA] }, { kinds: [30700, 30701, 30702, 30703] }], which)).length;
  assert.equal(await ofA('public'), 0, 'nothing of the insider’s own on the public relay before healing');
  await A.click('[data-act=sync-now]');
  await A.waitForSelector('.toast-success', { timeout: 30000 });
  await sleep(1000);
  assert.equal(await ofA('public'), 0, 'still nothing of the insider’s own on the public relay');
  assert.ok((await onHub([{ kinds: [30700, 30701, 30702, 30703] }])).length >= 1, 'the board is still on the hub’s relay');

  step('a group made in the public area lives on the public relay');
  await A.goto(`${CHAT}#/groups`);
  await A.waitForSelector('#chatTabs');
  await A.click('#newGroup');
  await A.fill('#groupForm [name=name]', 'Open house');
  await A.fill('#groupForm [name=myName]', 'Ada');
  await A.click('#groupForm [type=submit]');
  await A.waitForSelector('#groupComposer textarea');
  const groupPub = await A.getAttribute('.group', 'data-group');
  await until(async () => (await onPublic([{ kinds: [30720, 7821] }])).filter((e) => e.pubkey.startsWith(groupPub)).length >= 2, 'info and join on the public relay', 20000);
  assert.equal((await onHub([{ kinds: [30720, 7820, 7821] }])).filter((e) => e.pubkey.startsWith(groupPub)).length, 0, 'none of it on the hub’s relay');

  step('nothing on the public relay names the hub’s own relay, and the hub’s links carry no hints (its relays are locked)');
  const leaked = (await onPublic([{}])).filter((e) => JSON.stringify(e).includes(`localhost:${hubPort}`) || JSON.stringify(e).includes(`localhost%3A${hubPort}`));
  assert.deepEqual(leaked.map((e) => e.kind), [], 'no list, no event names the VPN relay');
  assert.ok((await onPublic([{ kinds: [10050], authors: [pkA] }])).length >= 1, 'the insider’s inbox list for the public area is on the public relay');
  await A.goto(BOARDS);
  await A.waitForSelector('.home');
  await A.click('.board-card');
  await A.waitForSelector('[data-act=share]');
  await A.click('[data-act=share]');
  await A.waitForSelector('#shareUrl');
  assert.ok(!(await A.inputValue('#shareUrl')).includes('r='), 'a locked hub’s board link has no hints');
  await A.click('dialog [data-close]');

  step('the hub’s relay goes away: the hub’s pages wait, the public area goes on; it comes back and the pages continue');
  await A.goto(BOARDS);
  await A.waitForSelector('.home');
  await connected(A);
  await env.pauseNostr();
  await A.waitForSelector('#networkGate', { timeout: 30000 });
  assert.match(await A.textContent('#gateTitle'), /Acme/);
  await A.goto(CHAT);
  await A.waitForSelector('#chatTabs');
  await sleep(8000);
  assert.ok(await absent(A, '#networkGate'), 'the public area is not gated');
  await A.goto(BOARDS);
  await A.waitForSelector('#networkGate', { timeout: 30000 });
  await env.resumeNostr();
  await until(async () => (await A.$('#networkGate')) === null, 'the gate lifts when the relay is back', 40000);
  await connected(A);
}

await run('hubs', main, { webRoot: site, nostrPort: hubPort, publicPort });
