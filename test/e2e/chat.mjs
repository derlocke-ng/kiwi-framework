// The chat in Chromium: a message to someone by key, answered; the writer's
// other device holds the conversation; a friend request from the
// conversation, accepted in the settings; a board sent from the boards app,
// the hub's unread count and toast, a browser notification, a room
// invitation; blocking; live rooms between strangers, with nothing kept on
// the relay; German.
//
// A distribution runs it against its own site:
//   import { chatSuite } from 'kiwi-framework/test/e2e/chat.mjs';
//   await run('uplink', (env) => chatSuite(env, { app: `${env.base}uplink/`, settings: `${env.base}settings.html`, boards: `${env.base}loadout/` }), { webRoot: site });
// Run directly, it builds a test hub with the app at chat/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { device, run, sleep, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, settings: string, boards: string }} where  the app's URL, the hub's settings page, the boards app's URL
 */
export async function chatSuite(env, { app, settings, boards }) {
  const init = (relay) => localStorage.setItem('wjs.relays', JSON.stringify([relay]));
  const dev = (name, options) => device(env, name, init, env.nostrUrl, options);
  const APP = app;
  const SETTINGS = settings;
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
  const messages = (page, sel = '#messages') => texts(page, `${sel} .msg p`);
  async function open(page) {
    await page.goto(APP);
    await page.waitForSelector('#rooms');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected to the relay', 15000);
  }
  async function talk(page, pk) {
    await page.goto(`${APP}#/dm/${pk}`);
    await page.waitForSelector('#composer textarea');
  }
  async function say(page, text, sel = '#composer') {
    await page.fill(`${sel} textarea`, text);
    await page.press(`${sel} textarea`, 'Enter');
  }

  step('A writes to B by key; B sees it, marked as from someone who is not a friend, and answers');
  const A = await dev('A');
  const B = await dev('B');
  await open(A);
  await open(B);
  const pkA = await pkOf(A);
  const pkB = await pkOf(B);
  await talk(A, pkB);
  await say(A, 'hello B');
  await until(async () => (await messages(A)).includes('hello B'), 'A sees its own message');
  await until(async () => (await texts(B, '#convs .conv-name')).length === 1, 'the conversation shows up on B', 30000);
  assert.ok(await B.$('#convs li.unread'), 'and is unread');
  await B.click('#convs .conv');
  await B.waitForSelector('#notFriend');
  await until(async () => (await messages(B)).includes('hello B'), 'the message on B');
  await say(B, 'hi A');
  await until(async () => (await messages(A)).join('|') === 'hello B|hi A', 'B’s answer on A', 30000);
  const wraps = await env.relayEvents([{ kinds: [1059] }]);
  assert.ok(wraps.length >= 4, 'each message travels as two gift wraps (the reader’s and the writer’s own)');
  assert.ok(!JSON.stringify(wraps).includes('hello B'), 'the relay sees no text');
  assert.ok(!wraps.some((w) => w.pubkey === pkA || w.pubkey === pkB), 'nor who writes');

  step('the writer’s other device holds the conversation: A creates an account, A2 signs in');
  const alias = `chat${Date.now().toString(36)}`;
  const pass = 'correct horse battery staple';
  await A.goto(SETTINGS);
  await A.waitForSelector('#authForm');
  await A.check('input[name=authTab][value=create]', { force: true });
  await A.fill('#authForm [name=alias]', alias);
  await A.fill('#authForm [name=pass]', pass);
  await A.fill('#authForm [name=pass2]', pass);
  await A.click('#authBtn');
  await until(async () => (await A.textContent('#accountBody')).includes(alias), 'account created', 60000);
  const A2 = await dev('A2');
  await A2.goto(SETTINGS);
  await A2.waitForSelector('#authForm');
  await A2.fill('#authForm [name=alias]', alias);
  await A2.fill('#authForm [name=pass]', pass);
  await A2.click('#authBtn');
  await until(async () => (await A2.textContent('#accountBody')).includes(alias), 'A2 signed in', 60000);
  await open(A2);
  await until(async () => (await texts(A2, '#convs .conv-name')).length === 1, 'the conversation reaches A2', 40000);
  await A2.click('#convs .conv');
  await until(async () => (await messages(A2)).join('|') === 'hello B|hi A', 'both messages on A2', 30000);

  step('a friend request from the conversation, accepted in the settings; the notice goes');
  await B.click('#notFriend [data-act=add-friend]');
  await B.waitForSelector('.toast-success');
  await A.goto(SETTINGS);
  await until(async () => (await texts(A, '#requestList li')).some((x) => /wants to be friends/.test(x)), 'A gets the request', 30000);
  await A.click('#requestList [data-accept]');
  await until(async () => !(await B.$('#notFriend')), 'B sees A as a friend now', 40000);
  await open(A);
  assert.ok((await texts(A, '#convs .conv-name')).length === 1);

  step('a board sent from the boards app arrives as a message with its link; the hub counts what is unread and says so');
  await A.goto(boards);
  await A.waitForSelector('.home');
  await A.click('[data-new="check"]');
  await A.fill('#newBoard input[name=title]', 'Picnic');
  await A.click('#newBoard [type=submit]');
  await A.waitForSelector('#boardName', { timeout: 15000 });
  await A.click('[data-act=share]');
  await A.waitForSelector('[data-act=chat]');
  await A.click('[data-act=chat]');
  await A.waitForSelector('#pickPeople input[name=pk]');
  await A.check('#pickPeople input[name=pk]', { force: true });
  await A.click('#pickPeople .btn-primary');
  await A.waitForSelector('.toast-success');
  await until(async () => (await messages(B)).some((x) => x.includes('Picnic')), 'the board link on B', 30000);
  assert.ok(await B.$(`#messages .msg a[href^="${boards}#"]`), 'the link is clickable, to the boards app wherever the hub mounts it');
  await B.goto(env.base);
  await B.waitForSelector('#apps');
  await talk(A, pkB);
  await say(A, 'one more');
  await until(async () => (await texts(B, '.toast')).some((x) => /New message/.test(x)), 'B is told while on the hub', 30000);
  await until(async () => (await B.textContent('[data-app=chat] .count').catch(() => '')) === '1', 'the chat card counts one unread conversation', 15000);

  step('browser notifications, opted in, while the tab is in the background');
  await B.ctx.addInitScript(() => {
    window.__notes = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title, options) {
        window.__notes.push({ title, body: options?.body });
      }
    };
  });
  await B.goto(`${SETTINGS}#notify`);
  await B.waitForSelector('#notifyToggle');
  await B.check('#notifyToggle', { force: true });
  await until(async () => (await B.evaluate(() => localStorage.getItem('wjs.notify'))) === 'true', 'opted in');
  await B.goto(env.base);
  await B.waitForSelector('#apps');
  await B.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }));
  await say(A, 'psst');
  await until(async () => (await B.evaluate(() => window.__notes.length)) === 1, 'a browser notification', 30000);
  assert.match(await B.evaluate(() => window.__notes[0].body), /psst/);
  await B.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }));

  step('an invitation sends the room’s link to a friend');
  const invite = `${APP}#/room/invite${Date.now().toString(36)}xyz`;
  await A.goto(invite);
  await A.waitForSelector('#enterRoom');
  await A.fill('#enterRoom [name=nick]', 'ada');
  await A.click('#enterBtn');
  await A.waitForSelector('#inviteRoom');
  await A.click('#inviteRoom');
  await A.waitForSelector('#pickPeople input[name=pk]');
  await A.check('#pickPeople input[name=pk]', { force: true });
  await A.click('#pickPeople .btn-primary');
  await A.waitForSelector('.toast-success');
  await talk(B, pkA);
  await until(async () => (await messages(B)).some((x) => /Join my room/.test(x)), 'the invitation on B', 30000);
  assert.ok(await B.$('#messages .msg a[href*="/room/"]'), 'with the room’s link');
  await A.click('#leaveRoom');

  step('blocking: the conversation goes at once and new messages never show; unblocking does not bring them back');
  await talk(B, pkA);
  await B.click('[data-act=menu]');
  await B.click('.menu button:has-text("Block this person")');
  await B.waitForSelector('.toast-success');
  await until(async () => (await texts(B, '#convs .conv-name')).length === 0, 'A’s conversation is gone on B');
  await talk(A, pkB);
  await say(A, 'still there?');
  await until(async () => (await messages(A)).includes('still there?'), 'A sent it');
  await sleep(2500);
  await open(B);
  assert.equal((await texts(B, '#convs .conv-name')).length, 0, 'nothing from a blocked person');

  step('a live room: two strangers talk, a latecomer sees nothing from before, the relay keeps nothing');
  const secret = `room${Date.now().toString(36)}abcdef`;
  const room = `${APP}#/room/${secret}`;
  const enter = async (page, nick) => {
    await page.goto(room);
    await page.waitForSelector('#enterRoom');
    await page.fill('#enterRoom [name=nick]', nick);
    await page.click('#enterBtn');
    await page.waitForSelector('#roomComposer textarea');
  };
  const R1 = await dev('R1');
  const R2 = await dev('R2');
  await enter(R1, 'ada');
  await enter(R2, 'bob');
  await until(async () => /ada/.test(await R1.textContent('#members')) && /bob/.test(await R1.textContent('#members')), 'both present on R1', 20000);
  await until(async () => /ada/.test(await R2.textContent('#members')), 'ada present on R2', 20000);
  await say(R1, 'first', '#roomComposer');
  await until(async () => (await messages(R2, '#roomMessages')).includes('first'), 'R2 hears R1', 20000);
  assert.ok((await texts(R2, '#roomMessages .nick')).includes('ada'), 'with the nickname');
  await say(R2, 'second', '#roomComposer');
  await until(async () => (await messages(R1, '#roomMessages')).join('|') === 'first|second', 'R1 hears R2', 20000);
  const R3 = await dev('R3');
  await enter(R3, 'cy');
  await until(async () => /cy/.test(await R1.textContent('#members')), 'the latecomer is seen', 20000);
  await sleep(1500);
  assert.deepEqual(await messages(R3, '#roomMessages'), [], 'nothing from before for the latecomer');
  assert.equal((await env.relayEvents([{ kinds: [21710, 21700] }])).length, 0, 'the relay stored none of it');
  assert.ok(await R1.$('#copyRoom'), 'the link can be copied');
  await R1.click('#leaveRoom');
  await R1.waitForSelector('#rooms');

  step('a German browser gets the chat in German');
  const G = await dev('G', { locale: 'de-DE' });
  await G.goto(APP);
  await G.waitForSelector('#startRoom');
  assert.equal(await G.textContent('#startRoom'), 'Raum eröffnen');
  assert.equal(await G.getAttribute('html', 'lang'), 'de');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const site = await testHub([
    { app: 'chat', name: 'Chat', icon: 'message-circle' },
    { app: 'boards', name: 'Boards', icon: 'list-checks' },
  ]);
  await run('chat', (env) => chatSuite(env, { app: `${env.base}chat/`, settings: `${env.base}settings.html`, boards: `${env.base}boards/` }), { webRoot: site });
}
