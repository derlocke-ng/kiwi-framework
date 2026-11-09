// Two public hubs that share no relay, and a directory relay both know. A person on each finds the other:
// their relay lists are on the directory, a sealed note goes to the reader's inbox relays as a guest and
// carries the writer's relays for the answer, and a link (a board, a group, a room) carries hints to
// where its events are, which the other hub reads and writes as a guest. The directory holds nothing
// but relay lists.
import assert from 'node:assert/strict';
import { device, freePort, run, sleep, startBoard, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

const [xPort, yPort, dirPort] = [await freePort(), await freePort(), await freePort()];
const X_RELAY = `ws://localhost:${xPort}`;
const Y_RELAY = `ws://localhost:${yPort}`;
const DIR = `ws://localhost:${dirPort}`;
const apps = [
  { app: 'boards', name: 'Boards', icon: 'list-checks' },
  { app: 'chat', name: 'Chat', icon: 'message-circle' },
];
const siteX = await testHub(apps, { name: 'Xhub', relays: [X_RELAY], directoryRelays: [DIR] });
const siteY = await testHub(apps, { name: 'Yhub', relays: [Y_RELAY], directoryRelays: [DIR] });

async function main(env) {
  env.keepDirectories = true; // this suite's hubs name a local directory, which is what it tests
  const X = env.base;
  const Y = await env.serve(siteY);
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
  const messages = (page, sel = '#messages') => texts(page, `${sel} .msg p`);
  const connected = async (page) => until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected', 15000);
  const say = async (page, text, sel = '#composer') => {
    await page.fill(`${sel} textarea`, text);
    await page.press(`${sel} textarea`, 'Enter');
  };
  const onX = (filters) => env.relayEvents(filters, 'hub');
  const onY = (filters) => env.relayEvents(filters, 'y');
  const onDir = (filters) => env.relayEvents(filters, 'dir');
  /** a link made on one hub, opened on the other: the same fragment under the other hub's address */
  const across = (link, from, to) => link.replace(from, to);

  step('each person’s relay lists go to their hub’s relay and to the directory, naming their hub’s relay');
  const A = await device(env, 'A', null, null);
  await A.goto(`${X}chat/`);
  await A.waitForSelector('#chatTabs');
  await connected(A);
  const pkA = await pkOf(A);
  const B = await device(env, 'B', null, null);
  await B.goto(`${Y}chat/`);
  await B.waitForSelector('#chatTabs');
  await connected(B);
  const pkB = await pkOf(B);
  await until(async () => (await onDir([{ kinds: [10050], authors: [pkA, pkB] }])).length === 2, 'both inbox lists on the directory', 20000);
  const inboxA = (await onDir([{ kinds: [10050], authors: [pkA] }]))[0];
  assert.deepEqual(
    inboxA.tags.filter((t) => t[0] === 'relay').map((t) => t[1]),
    [X_RELAY],
    'A reads on X’s relay',
  );
  assert.equal((await onX([{ kinds: [10002], authors: [pkA] }])).length, 1, 'and its relay list is on X’s relay');

  step('B writes to A by key: the note goes to A’s inbox on X’s relay as a guest; A answers, and the answer finds B on Y’s relay');
  await B.goto(`${Y}chat/#/dm/${pkA}`);
  await B.waitForSelector('#composer textarea');
  await say(B, 'hello from Y');
  await until(async () => (await texts(A, '#convs .conv-name')).length === 1, 'A sees the conversation', 30000);
  assert.ok((await onX([{ kinds: [1059], '#p': [pkA] }])).length >= 1, 'the note is on X’s relay, A’s inbox');
  await A.goto(`${X}chat/#/dm/${pkB}`);
  await A.waitForSelector('#composer textarea');
  await until(async () => (await messages(A)).includes('hello from Y'), 'A reads it', 20000);
  await say(A, 'hello from X');
  await until(async () => (await messages(B)).includes('hello from X'), 'B reads the answer', 30000);
  assert.ok((await onY([{ kinds: [1059], '#p': [pkB] }])).length >= 1, 'the answer is on Y’s relay, where B reads');

  step('a board link from X carries X’s relay; B opens it on Y, reads, and edits; A sees the edit');
  await A.goto(`${X}boards/`);
  await A.waitForSelector('.home');
  await startBoard(A, 'check');
  await A.fill('#newBoard input[name=title]', 'Shared across hubs');
  await A.click('#newBoard [type=submit]');
  await A.waitForSelector('#boardName', { timeout: 15000 });
  await A.fill('.add-item input', 'from A');
  await A.press('.add-item input', 'Enter');
  await until(async () => (await texts(A, '[data-part=active] .text')).includes('from A'), 'A’s item');
  await A.click('[data-act=share]');
  await A.waitForSelector('#shareUrl');
  await A.check('input[name=role][value=edit]', { force: true });
  const boardLink = await A.inputValue('#shareUrl');
  await A.click('dialog [data-close]');
  assert.match(boardLink, new RegExp(`[?&]r=localhost%3A${xPort}`), 'the link names X’s relay, without the scheme');
  await B.goto(across(boardLink, X, Y));
  await until(async () => (await texts(B, '[data-part=active] .text')).includes('from A'), 'B reads the board from X’s relay', 30000);
  await B.fill('.add-item input', 'from B');
  await B.press('.add-item input', 'Enter');
  await until(async () => (await texts(A, '[data-part=active] .text')).includes('from B'), 'A sees B’s edit', 30000);

  step('a group link from X: B knocks from Y, A lets B in, both talk');
  await A.goto(`${X}chat/#/groups`);
  await A.waitForSelector('#chatTabs');
  await A.click('#newGroup');
  await A.fill('#groupForm [name=name]', 'Across');
  await A.fill('#groupForm [name=myName]', 'Ada');
  await A.click('#groupForm [type=submit]');
  await A.waitForSelector('#groupComposer textarea');
  const groupLink = await A.getAttribute('.group', 'data-invite');
  assert.match(groupLink, new RegExp(`\\?r=localhost%3A${xPort}`), 'the group link names X’s relay');
  await B.goto(across(groupLink, X, Y));
  await B.waitForSelector('#joinGroup');
  await B.fill('#joinGroup [name=name]', 'Bea');
  await B.click('#knockBtn');
  await until(async () => (await A.$$('#requests [data-admit]')).length === 1, 'A sees B at the door', 40000);
  await A.click('#requests [data-admit]');
  await B.waitForSelector('#groupComposer textarea', { timeout: 40000 });
  await say(B, 'hi from Y', '#groupComposer');
  await until(async () => (await texts(A, '#groupMessages .msg p')).includes('hi from Y'), 'A reads B in the group', 30000);
  await say(A, 'welcome', '#groupComposer');
  await until(async () => (await texts(B, '#groupMessages .msg p')).includes('welcome'), 'B reads A in the group', 30000);

  step('a live room from X: B enters from Y through the link’s hint, and the two talk');
  const secret = `reach${Date.now().toString(36)}room`;
  await A.goto(`${X}chat/#/room/${secret}`);
  await A.waitForSelector('#enterRoom');
  await A.fill('#enterRoom [name=nick]', 'ada');
  await A.click('#enterBtn');
  await A.waitForSelector('#roomComposer textarea');
  const roomLink = await A.getAttribute('.room', 'data-invite'); // what the copy button copies
  assert.match(roomLink, new RegExp(`\\?r=localhost%3A${xPort}`), 'the room link names X’s relay');
  await B.goto(across(roomLink, X, Y));
  await B.waitForSelector('#enterRoom');
  await B.fill('#enterRoom [name=nick]', 'bea');
  await B.click('#enterBtn');
  await B.waitForSelector('#roomComposer textarea');
  await until(async () => /ada/.test(await B.textContent('#members')), 'B sees A in the room', 30000);
  await say(B, 'room hello', '#roomComposer');
  await until(async () => (await messages(A, '#roomMessages')).includes('room hello'), 'A hears B', 20000);

  step('the directory holds relay lists and nothing else');
  await sleep(1000);
  const kinds = new Set((await onDir([{}])).map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), [10002, 10050], 'no notes, no boards, no groups on the directory');
}

await run('reach', main, { webRoot: siteX, nostrPort: xPort, extraRelays: { y: yPort, dir: dirPort } });
