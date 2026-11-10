// The chat in Chromium: a message to someone by key, answered; the writer's
// other device holds the conversation; a friend request from the
// conversation, accepted in the settings; a board sent from the boards app,
// the hub's unread count and toast, a browser notification; a reply, a
// reaction, an edit, a pin and a deletion seen on the other side, the
// search, a pinned conversation, disappearing messages; a room invitation;
// groups (with a reaction, a reply and a timer); blocking; live rooms
// between strangers, with nothing kept on the relay; German.
//
// A distribution runs it against its own site:
//   import { chatSuite } from 'kiwi-framework/test/e2e/chat.mjs';
//   await run('uplink', (env) => chatSuite(env, { app: `${env.base}uplink/`, settings: `${env.base}settings.html`, boards: `${env.base}loadout/` }), { webRoot: site });
// Run directly, it builds a test hub with the app at chat/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { absent, device, run, sleep, startBoard, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
// a photo of one pixel, for the file step
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
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
  const MOUNT = new URL(app).pathname.split('/').filter(Boolean).pop(); // the chat's mount id on this hub (chat, uplink, …)
  const pkOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
  const messages = (page, sel = '#messages') => texts(page, `${sel} .msg p`);
  async function open(page, tab = '') {
    await page.goto(`${APP}${tab}`);
    await page.waitForSelector('#chatTabs');
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
  /** A message's bubble by its exact text, in the list `sel`. */
  const bubble = (text, sel = '#messages') => `${sel} .msg:has(> p:text-is("${text}"))`;
  /** Tap a message and choose one of its actions (`data-act`), or a reaction (`data-react`). */
  async function act(page, text, what, sel = '#messages') {
    await page.click(`${bubble(text, sel)} > p`);
    await page.waitForSelector('#msgActions');
    await page.click(`#msgActions [${what.startsWith('react=') ? 'data-react' : 'data-act'}="${what.replace(/^react=/, '')}"]`);
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
  await startBoard(A, 'check');
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
  await until(async () => (await B.textContent(`[data-app="${MOUNT}"] .count`).catch(() => '')) === '1', 'the chat card counts one unread conversation', 15000);

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

  step('a reply, a reaction, an edit, a pin and a deletion: made on one side, seen on the other');
  await talk(A, pkB);
  await talk(B, pkA);
  await until(async () => (await messages(B)).includes('psst'), 'B has the conversation so far', 30000);
  await act(B, 'hello B', 'reply');
  await B.waitForSelector('#composer .composer-context[data-context=reply]');
  await say(B, 'answering you');
  await B.waitForSelector('#composer .composer-context', { state: 'detached' });
  await until(async () => (await A.textContent(`${bubble('answering you')} .quote`).catch(() => '')).includes('hello B'), 'A sees the reply with what it answers', 30000);
  await act(A, 'answering you', 'react=❤️');
  await until(async () => Boolean(await B.$(`${bubble('answering you')} .reaction[data-react="❤️"]`)), 'B sees A’s reaction', 30000);
  await B.click(`${bubble('answering you')} .reaction[data-react="❤️"]`); // the same, by a tap on the chip
  await until(async () => (await A.textContent(`${bubble('answering you')} .reaction`).catch(() => '')).includes('2'), 'two hearts on A', 30000);
  await act(A, 'one more', 'edit');
  await A.waitForSelector('#composer .composer-context[data-context=edit]');
  assert.equal(await A.inputValue('#composer textarea'), 'one more', 'the text to edit is in the box');
  await say(A, 'one more thing');
  await until(async () => Boolean(await B.$(`${bubble('one more thing')} .edited`)), 'B sees the new text, marked as edited', 30000);
  assert.ok(await absent(B, bubble('one more')), 'and not the old');
  await act(A, 'hello B', 'pin');
  await until(async () => (await B.textContent('#pinbar').catch(() => '')).includes('hello B'), 'B sees the pinned message above the conversation', 30000);
  await B.click('#pinbar');
  await B.waitForSelector(`${bubble('hello B')}.lit`);
  await act(A, 'psst', 'delete');
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await until(async () => !(await messages(B)).includes('psst') && Boolean(await B.$('#messages .msg.deleted')), 'deleted on B too', 30000);
  assert.ok(await absent(B, `#messages .msg.deleted .reaction`));
  const changes = await env.relayEvents([{ kinds: [1059] }]);
  assert.ok(!JSON.stringify(changes).includes('one more thing'), 'the relay sees changes sealed like messages');

  step('the search finds a message on this device and opens the conversation at it; a deleted one is not found');
  await A.goto(`${APP}#/search`);
  await A.fill('#searchInput', 'THING');
  await A.waitForSelector('#searchResults [data-result]');
  assert.match(await A.textContent('#searchResults'), /one more thing/);
  await A.click('#searchResults [data-result]');
  await A.waitForSelector(`${bubble('one more thing')}.lit`);
  await A.goto(`${APP}#/search?q=psst`);
  await A.waitForSelector('#searchEmpty');
  await A.goBack();
  await A.waitForSelector('#composer textarea');

  step('a conversation pinned to the top; disappearing messages set by one side hold for both, and go');
  await A.click('[data-act=menu]');
  await A.click('.menu [data-act=pin-conv]');
  await open(A);
  await A.waitForSelector('#convs li.pinned');
  await talk(A, pkB);
  await A.click('[data-act=menu]');
  await A.click('.menu [data-act=timer]');
  await A.click('#timerDialog [data-timer="300"]');
  await until(async () => (await B.getAttribute('#timerBadge', 'data-timer').catch(() => '')) === '300', 'B’s side shows the timer', 30000);
  assert.match(await B.textContent('#messages .sysline:last-of-type'), /5 minutes/);
  // a short timer, set the way the dialog does: the message is gone from both screens, the store and the relay
  await A.evaluate((pk) => window.kiwi.messages.setTimer(pk, 6), pkB);
  await until(async () => (await B.getAttribute('#timerBadge', 'data-timer').catch(() => '')) === '6', 'the short timer on B', 30000);
  await say(A, 'gone soon');
  await until(async () => (await messages(B)).includes('gone soon'), 'B reads it', 30000);
  const wrapped = (await env.relayEvents([{ kinds: [1059] }])).filter((w) => w.tags.some((t) => t[0] === 'expiration'));
  assert.ok(wrapped.length >= 2, 'its wraps carry NIP-40 for the relay');
  await until(async () => !(await messages(A)).includes('gone soon') && !(await messages(B)).includes('gone soon'), 'gone from both screens', 15000);
  await B.evaluate(() => window.kiwi.messages.purge());
  assert.ok(!(await B.evaluate(async () => JSON.stringify(await window.kiwi.messages.net.db.chatAll()))).includes('gone soon'), 'and from the store');
  assert.equal((await env.relayEvents([{ kinds: [1059] }])).filter((w) => wrapped.some((x) => x.id === w.id)).length, 0, 'the relay hands it out no more');
  await A.click('[data-act=menu]');
  await A.click('.menu [data-act=timer]');
  await A.click('#timerDialog [data-timer="0"]');
  await until(async () => (await B.$('#timerBadge')) === null, 'off on B', 30000);

  step('a room invitation reaches a friend sealed, not as a link; yes puts them at the room’s door, and the two talk');
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
  await open(B, '#/groups');
  await until(async () => (await B.$$('#invites [data-invite=room] [data-accept]')).length === 1, 'the room invitation on B', 40000);
  assert.deepEqual(await messages(B).catch(() => []), [], 'no link travelled as a message');
  await B.click('#invites [data-invite=room] [data-accept]');
  await B.waitForSelector('#enterRoom');
  await B.fill('#enterRoom [name=nick]', 'bea');
  await B.click('#enterBtn');
  await B.waitForSelector('#roomComposer textarea');
  await say(B, 'got the invite', '#roomComposer');
  await until(async () => (await messages(A, '#roomMessages')).includes('got the invite'), 'B in A’s room', 30000);
  await B.click('#leaveRoom');
  await A.click('#leaveRoom');
  await B.goto(SETTINGS);
  await B.waitForSelector('#friendList [data-message]');
  assert.ok((await B.getAttribute('#friendList [data-message]', 'href')).includes(`#/dm/${pkA}`), 'the friends list messages a friend in the chat');

  step('a group: A makes it and invites B directly; B is in without knocking, both talk under their names; A2 has it too');
  const groupMessages = (page) => texts(page, '#groupMessages .msg p');
  await open(A, '#/groups');
  await A.click('#newGroup');
  await A.fill('#groupForm [name=name]', 'Crew');
  await A.fill('#groupForm [name=myName]', 'Ada');
  await A.click('#groupForm [type=submit]');
  await A.waitForSelector('#groupComposer textarea');
  await until(async () => /Ada/.test(await A.textContent('#groupMembers')), 'A is in as Ada');
  await A.click('[data-act=menu]');
  await A.click('.menu button:has-text("Invite friends")');
  await A.waitForSelector('#pickPeople input[name=pk]');
  await A.check('#pickPeople input[name=pk]', { force: true });
  await A.click('#pickPeople .btn-primary');
  await A.waitForSelector('.toast-success');
  await open(B, '#/groups');
  await until(async () => (await B.$$('#invites [data-accept]')).length === 1, 'B is asked: an invitation, not a group that simply appears', 40000);
  assert.match(await B.textContent('#invites'), /Crew/);
  await B.click('#invites [data-accept]');
  await B.waitForSelector('#groupComposer textarea');
  assert.ok((await B.evaluate(() => location.hash)).startsWith('#/group/'), 'yes opens the group');
  await B.waitForSelector('#groupComposer textarea');
  await say(B, 'hello crew', '#groupComposer');
  await until(async () => (await groupMessages(A)).includes('hello crew'), 'B’s message on A', 30000);
  await until(async () => (await A.textContent('#groupMembers')).split(':')[0].trim().startsWith('2'), 'two in, on A', 20000);
  await say(A, 'welcome', '#groupComposer');
  await until(async () => (await groupMessages(B)).join('|') === 'hello crew|welcome', 'A’s answer on B', 30000);
  assert.ok((await texts(B, '#groupMessages .nick')).includes('Ada'), 'under A’s name');
  await act(B, 'welcome', 'reply', '#groupMessages');
  await say(B, 'thanks', '#groupComposer');
  await until(async () => (await A.textContent(`${bubble('thanks', '#groupMessages')} .quote`).catch(() => '')).includes('welcome'), 'a reply in the group', 30000);
  await act(A, 'thanks', 'react=👍', '#groupMessages');
  await until(async () => Boolean(await B.$(`${bubble('thanks', '#groupMessages')} .reaction[data-react="👍"]`)), 'a reaction in the group', 30000);
  await A.click('[data-act=menu]');
  await A.click('.menu [data-act=timer]');
  await A.click('#timerDialog [data-timer="3600"]');
  await until(async () => (await B.getAttribute('#timerBadge', 'data-timer').catch(() => '')) === '3600', 'the host’s timer on B', 30000);
  await A.click('[data-act=menu]');
  await A.click('.menu [data-act=timer]');
  await A.click('#timerDialog [data-timer="0"]');
  await until(async () => (await B.$('#timerBadge')) === null, 'and off again', 30000);
  await open(A2, '#/groups');
  await until(async () => (await texts(A2, '#groupList .conv-name')).includes('Crew'), 'A’s other device has the group', 40000);
  await A2.click('#groupList .conv');
  await until(async () => (await groupMessages(A2)).join('|') === 'hello crew|welcome|thanks', 'and its messages', 30000);
  const groupPub = await A.getAttribute('.group', 'data-group');
  const onRelay = await env.relayEvents([{ kinds: [30720, 7820, 7821] }]);
  assert.ok(onRelay.length >= 4, 'info, two joins, two messages on the relay');
  assert.ok(onRelay.every((e) => e.pubkey.startsWith(groupPub)), 'all under the group’s anonymous key');
  assert.ok(!JSON.stringify(onRelay).includes('hello crew') && !JSON.stringify(onRelay).includes(pkA) && !JSON.stringify(onRelay).includes(pkB), 'the relay sees neither text nor members');

  step('a stranger with the link knocks; the host lets them in; then removes them, and what follows is sealed with a key they never had');
  const link = await A.getAttribute('.group', 'data-invite');
  assert.match(link, /#\/group\/[0-9a-f]{64}\/[0-9a-f]{64}\/[A-Za-z0-9_-]{8,}\//, 'the invite link names the group, the host and a token, never a key');
  const S = await dev('S');
  await S.goto(link);
  await S.waitForSelector('#joinGroup');
  const pkS = await pkOf(S);
  await S.waitForSelector('#joinGroup');
  await S.fill('#joinGroup [name=name]', 'Sam');
  await S.click('#knockBtn');
  await S.waitForSelector('#knockWaiting');
  await until(async () => (await A.$$('#requests [data-admit]')).length === 1, 'the host sees Sam at the door', 40000);
  assert.ok((await A.textContent('#requests')).includes('Sam'));
  await A.click('#requests [data-admit]');
  await S.waitForSelector('#groupComposer textarea', { timeout: 40000 });
  await say(S, 'hi all', '#groupComposer');
  await until(async () => (await groupMessages(A)).includes('hi all'), 'Sam’s message on A', 30000);
  await until(async () => (await A.textContent('#groupMembers')).includes('Sam'), 'Sam is listed', 20000);
  A.removeAllListeners('dialog');
  A.on('dialog', (d) => d.dismiss());
  await A.click(`#groupMembers [data-remove="${pkS}"]`);
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await until(async () => !(await A.textContent('#groupMembers')).includes('Sam'), 'Sam is out on A', 30000);
  await until(async () => (await S.$('#groupComposer')) === null, 'Sam’s device dropped the group', 40000);
  await until(async () => (await texts(S, '#groupList .conv-name')).length === 0 || (await S.$('#joinGroup')) !== null, 'nothing of it left on S', 20000);
  await say(A, 'after the rekey', '#groupComposer');
  await until(async () => (await groupMessages(B)).includes('after the rekey'), 'B reads with the new key', 40000);
  await until(async () => (await groupMessages(A2)).includes('after the rekey'), 'so does A’s other device', 40000);

  step('files: A sends B a photo while B is away, sealed on A’s media server; B sees and saves it later; a file in the group too');
  const groupA = await A.evaluate(() => location.hash);
  const groupB = await B.evaluate(() => location.hash);
  await A.goto(`${SETTINGS}#media`);
  await A.waitForSelector('#mediaForm', { state: 'attached' });
  if (!(await A.$eval('#media details', (d) => d.open))) await A.click('#media details summary');
  await A.fill('#mediaForm textarea', env.blossom.url);
  await A.click('#mediaForm [type=submit]');
  await A.waitForSelector(`#mediaList li[data-server="${env.blossom.url}"]`);
  await B.goto(`${env.base}hub.json`); // B is away: a page of the hub's that runs nothing
  await talk(A, pkB);
  const png = Buffer.from(PNG_1PX, 'base64');
  const before = env.blossom.blobs.size;
  await A.setInputFiles('#composer input[type=file]', { name: 'week3.png', mimeType: 'image/png', buffer: png });
  await until(async () => (await A.$$('#messages .file-card')).length === 1, 'the file in A’s conversation', 30000);
  assert.equal(env.blossom.blobs.size, before + 1, 'one upload');
  const x = await A.getAttribute('#messages .file-card', 'data-file');
  const stored = env.blossom.blobs.get(x);
  assert.ok(stored && !Buffer.from(stored.data).includes(Buffer.from('PNG')), 'the media server holds ciphertext under its hash');
  assert.equal(stored.type, 'application/octet-stream', 'and not the file’s type');
  assert.ok(!JSON.stringify(await env.relayEvents([{ kinds: [1059] }])).includes(x), 'the relays never see where the file is');
  await open(B);
  await until(async () => (await texts(B, '#convs .conv-preview')).some((t) => t.includes('File: week3.png')), 'B’s list says a file came', 30000);
  await talk(B, pkA);
  await until(
    async () => B.$eval('#messages .file-card .file-preview', (img) => img.complete && img.naturalWidth === 1).catch(() => false),
    'the photo shows on B',
    30000,
  );
  const [saved] = await Promise.all([B.waitForEvent('download'), B.click('#messages .file-card [data-act=save-file]')]);
  assert.equal(saved.suggestedFilename(), 'week3.png');
  assert.deepEqual(fs.readFileSync(await saved.path()), png, 'the same bytes as were sent');
  await A.goto(`${APP}${groupA}`);
  await A.waitForSelector('#groupComposer textarea');
  // a page that starts over rebuilds the group from what its device holds: the members are there at once
  await until(
    async () => {
      const line = await A.textContent('#groupMembers');
      if (line.split(':')[0].trim().startsWith('2')) return true;
      throw new Error(line);
    },
    'after a reload, two in on A',
    10000,
  );
  await B.goto(`${APP}${groupB}`);
  await B.waitForSelector('#groupComposer textarea');
  await A.setInputFiles('#groupComposer input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('feed every third day') });
  await until(async () => (await texts(B, '#groupMessages .file-name')).includes('notes.txt'), 'the file in the group on B', 30000);
  const [note] = await Promise.all([B.waitForEvent('download'), B.click('#groupMessages .file-card [data-act=save-file]')]);
  assert.equal(fs.readFileSync(await note.path(), 'utf8'), 'feed every third day');

  step('B leaves; the host closes; every device drops the group');
  await B.click('[data-act=menu]');
  await B.click('.menu button:has-text("Leave the group")');
  await B.waitForSelector('dialog.modal [data-ok]');
  await B.click('dialog.modal [data-ok]');
  await B.waitForSelector('#groupList, #chatTabs');
  await until(async () => (await A.textContent('#groupMembers')).split(':')[0].trim().startsWith('1'), 'only Ada left, on A', 30000);
  await A.click('[data-act=menu]');
  await A.click('.menu button:has-text("Close the group")');
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await A.waitForSelector('.toast-success');
  await until(async () => (await texts(A2, '.toast')).some((x) => /closed/.test(x)) || (await A2.$('#groupComposer')) === null, 'A2 is told and drops it', 40000);
  await open(A2, '#/groups');
  assert.deepEqual(await texts(A2, '#groupList .conv-name'), [], 'no group left on A2');

  step('offline: a group made without a relay exists once and reaches the relay when the relay is back; a message sent meanwhile arrives on return');
  await open(B, '#/groups');
  await B.ctx.setOffline(true);
  await B.click('#newGroup');
  await B.fill('#groupForm [name=name]', 'Offline club');
  await B.fill('#groupForm [name=myName]', 'Bea');
  await B.click('#groupForm [type=submit]');
  await B.waitForSelector('#groupComposer textarea', { timeout: 15000 }); // made here, shown here; no relay is waited for
  const offlinePub = await B.getAttribute('.group', 'data-group');
  await say(B, 'anyone?', '#groupComposer');
  await until(async () => (await groupMessages(B)).includes('anyone?'), 'the message shows at once');
  await talk(A, pkB);
  await say(A, 'while you were away');
  await sleep(1000);
  await B.ctx.setOffline(false);
  await until(async () => (await B.$eval('#sync', (el) => el.dataset.state)) === 'on', 'B is back on the relay', 30000);
  await until(
    async () => (await env.relayEvents([{ kinds: [30720, 7820, 7821] }])).filter((e) => e.pubkey.startsWith(offlinePub)).length >= 3,
    'info, join and message reached the relay from the outbox',
    40000,
  );
  await open(B, '#/groups');
  assert.deepEqual(await texts(B, '#groupList .conv-name'), ['Offline club'], 'made once, whatever the relay did');
  await talk(B, pkA);
  await until(async () => (await messages(B)).includes('while you were away'), 'the message sent meanwhile is here', 30000);

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
  await R2.reload();
  await R2.waitForSelector('#roomComposer textarea');
  assert.ok(await absent(R2, '#enterRoom'), 'a reload puts bob straight back in, no name asked');
  await until(async () => /bob/.test(await R2.textContent('#members')) && /ada/.test(await R2.textContent('#members')), 'bob sees the room again', 20000);
  await sleep(1500);
  assert.equal(((await R1.textContent('#members')).match(/bob/g) || []).length, 1, 'the same bob on R1, not a newcomer beside a ghost');
  await R1.click('#leaveRoom');
  await R1.waitForSelector('#chatTabs');
  await until(async () => !/ada/.test(await R2.textContent('#members')), 'ada is off R2’s list the moment she leaves', 8000);
  assert.ok(/\(2\)/.test(await R2.textContent('.room .who small')), 'the header counts who is here');

  step('a German browser gets the chat in German');
  const G = await dev('G', { locale: 'de-DE' });
  await G.goto(`${APP}#/groups`);
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
