// The notices app (Armory mounts it as DevBoard) in Chromium: notes with
// proof of work, votes, saving and filters, editing and deleting, reports,
// blocking, the cap of three live notes per person, the app's settings,
// friends and languages, on several devices against a local relay.
//
// A distribution runs it against its own site:
//   import { noticesSuite } from 'kiwi-framework/test/e2e/notices.mjs';
//   await run('devboard', (env) => noticesSuite(env, { app: `${env.base}devboard/`, settings: `${env.base}settings.html`, name: 'DevBoard' }), { webRoot: site });
// Run directly, it builds a test hub with the app at notices/.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { run, device, until, testHub } from './env.mjs';
import { nip13 } from '../../shared/nostr.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const POW = 8; // leading zero bits for the test: instant, still verified by every reader

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string, settings: string, name: string }} where  the app's URL, the hub's settings page, the mount's name
 */
export async function noticesSuite(env, { app, settings, name }) {
  const init = ({ relay, pow }) => {
    localStorage.setItem('wjs.relays', JSON.stringify([relay]));
    localStorage.setItem('devboard.pow', String(pow));
  };
  const dev = (name, options) => device(env, name, init, { relay: env.nostrUrl, pow: POW }, options);
  const BOARD = app;
  const titles = (page) => texts(page, '.note h3');
  const noteOn = (page, title) => page.locator('.note', { has: page.locator('h3', { hasText: title }) });

  async function open(page) {
    await page.goto(BOARD);
    await page.waitForSelector('#postBtn');
    await until(async () => (await page.$eval('#sync', (el) => el.dataset.state)) === 'on', 'connected to the relay', 15000);
  }

  async function pin(page, { type = 'hiring', title, text = 'Short and concrete.', tags = '', rate = '', contact = 'me@example.com' }) {
    await page.click('#postBtn');
    await page.waitForSelector('#compose');
    await page.check(`#compose input[name=type][value=${type}]`, { force: true });
    await page.fill('#compose [name=title]', title);
    await page.fill('#compose [name=text]', text);
    await page.fill('#compose [name=tags]', tags);
    await page.fill('#compose [name=rate]', rate);
    await page.fill('#compose [name=contact]', contact);
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

  step('the board starts empty; a note is pinned with proof of work and reaches the relay');
  const A = await dev('A');
  await open(A);
  assert.match(await A.textContent('#board'), /Nothing here yet/);
  assert.ok(await A.$('#accountLink .icon'), 'the account button is in the top bar');
  await pin(A, { title: 'React dev wanted', text: 'Shop relaunch, 3 months, remote.', tags: 'React, Node.js', rate: '€60/h', contact: 'jobs@example.com' });
  assert.ok(await A.$('.note.mine.hiring'), 'own hiring note is marked');
  assert.match(await A.textContent('#stats'), /1 live note/);
  assert.ok(await A.$('.note [data-act=up][disabled]'), 'no voting on your own note');
  const onRelay = await env.relayEvents([{ kinds: [30810] }]);
  assert.equal(onRelay.length, 1, 'the note reached the relay');
  const note = onRelay[0];
  assert.ok(nip13.getPow(note.id) >= POW, 'the note carries proof of work');
  assert.ok(note.tags.some((x) => x[0] === 'nonce' && Number(x[2]) >= POW), 'the nonce tag states the difficulty');
  const exp = Number(note.tags.find((x) => x[0] === 'expiration')?.[1]);
  assert.ok(exp > note.created_at + 6 * 86400 && exp <= note.created_at + 7 * 86400, 'the note expires in a week');
  assert.ok(note.tags.some((x) => x[0] === 't' && x[1] === 'react'), 'skills are t tags');
  assert.equal(JSON.parse(note.content).contact, 'jobs@example.com');

  step('another device sees the note, votes, saves it and finds it by filter, search and skill');
  const B = await dev('B');
  await open(B);
  await until(async () => (await titles(B)).includes('React dev wanted'), 'the note reaches B', 20000);
  assert.equal(await B.$('.note.mine'), null, 'not B’s note');
  const bNote = noteOn(B, 'React dev wanted');
  await bNote.locator('[data-act=up]').click();
  await until(async () => (await bNote.locator('.score').textContent()) === '+1', 'B’s vote counts on B', 15000);
  await until(async () => (await A.textContent('.note .score')) === '+1', 'B’s vote reaches A', 20000);
  await bNote.locator('[data-act=down]').click();
  await until(async () => (await A.textContent('.note .score')) === '-1', 'changing the vote replaces it', 20000);
  const reactions = await env.relayEvents([{ kinds: [7] }]);
  assert.ok(reactions.length >= 2, 'votes are on the relay');
  assert.ok(reactions.every((r) => nip13.getPow(r.id) >= Math.min(12, POW) && r.tags.some((x) => x[0] === 'a')), 'votes carry proof of work and point at the note');
  await bNote.locator('[data-act=save]').click();
  await B.check('input[name=filter][value=saved]', { force: true });
  await until(async () => (await titles(B)).join() === 'React dev wanted', 'the saved filter shows the note');
  await B.check('input[name=filter][value=available]', { force: true });
  await until(async () => /No notes match/.test(await B.textContent('#board')), 'nothing is available yet');
  await B.check('input[name=filter][value=all]', { force: true });
  await B.fill('#search', 'python');
  await until(async () => /No notes match/.test(await B.textContent('#board')), 'search misses');
  await B.fill('#search', 'relaunch');
  await until(async () => (await titles(B)).length === 1, 'search finds the text');
  await B.fill('#search', '');
  await B.click('#tagbar [data-tag="node.js"]');
  await until(async () => (await B.$('#tagbar .chip.on')) && (await titles(B)).length === 1, 'a skill chip filters');
  await B.click('#tagbar [data-tag="node.js"]');
  await until(async () => !(await B.$('#tagbar .chip.on')), 'chip off again');

  step('contact details open on request; the author edits and then deletes the note everywhere');
  await bNote.locator('[data-act=contact]').click();
  await B.waitForSelector('dialog.modal .contact');
  assert.equal((await B.textContent('dialog.modal .contact')).trim(), 'jobs@example.com');
  await B.click('dialog.modal .modal-actions [data-close]');
  await until(async () => !(await B.$('dialog.modal')), 'contact dialog closed');
  await menu(A, 'React dev wanted', 'Edit');
  await A.waitForSelector('#compose');
  assert.equal(await A.inputValue('#compose [name=title]'), 'React dev wanted');
  await A.fill('#compose [name=title]', 'Senior React dev wanted');
  await A.click('#compose .btn-primary');
  await until(async () => (await titles(A)).join() === 'Senior React dev wanted', 'edited title on A', 30000);
  await until(async () => (await titles(B)).join() === 'Senior React dev wanted', 'edited title on B', 20000);
  assert.equal(await A.textContent('.note .score'), '-1', 'votes survive an edit');
  await menu(A, 'Senior React dev wanted', 'Delete…');
  await A.waitForSelector('dialog.modal [data-ok]');
  await A.click('dialog.modal [data-ok]');
  await until(async () => (await A.$$('.note')).length === 0, 'deleted on A', 30000);
  await until(async () => (await B.$$('.note')).length === 0, 'deleted on B', 20000);

  step('a report goes to the relay signed; blocking hides a person on the spot');
  await pin(A, { type: 'available', title: 'Available: Rust backend', text: 'Open from November.', tags: 'Rust, PostgreSQL', contact: 'npub1example' });
  await until(async () => (await titles(B)).includes('Available: Rust backend'), 'the new note reaches B', 20000);
  await menu(B, 'Available: Rust backend', 'Report…');
  await B.waitForSelector('#reportForm');
  await B.selectOption('#reportForm [name=type]', 'spam');
  await B.fill('#reportForm [name=text]', 'looks automated');
  await B.click('#reportForm .btn-danger');
  await until(async () => !(await B.$('#reportForm')), 'report sent', 30000);
  const reports = await env.relayEvents([{ kinds: [1984] }]);
  assert.equal(reports.length, 1, 'one report on the relay');
  assert.ok(reports[0].tags.some((x) => x[0] === 'p' && x[1] === note.pubkey && x[2] === 'spam'), 'the report names the author and the reason');
  assert.ok(reports[0].tags.some((x) => x[0] === 'a' && x[1].startsWith(`30810:${note.pubkey}:`)), 'the report points at the note');
  await menu(B, 'Available: Rust backend', 'Block this person');
  await until(async () => (await B.$$('.note')).length === 0, 'the blocked person’s note is gone on B', 15000);
  await B.waitForSelector('.toast-success');
  const mute = await env.relayEvents([{ kinds: [10000] }]);
  assert.equal(mute.length, 1, 'the block list is on the relay');
  assert.ok(!JSON.stringify(mute[0]).includes(note.pubkey), 'the relay cannot see who is blocked');
  assert.deepEqual(await titles(A), ['Available: Rust backend'], 'A still sees its own note');

  step('three live notes per person, no more; a reload keeps the deleted note gone');
  await pin(A, { title: 'Second note', contact: 'x@example.com' });
  await pin(A, { title: 'Third note', contact: 'x@example.com' });
  await A.click('#postBtn');
  await A.waitForSelector('.toast-error');
  assert.match(await A.textContent('.toast-error'), /Three live notes per person/);
  assert.equal(await A.$('#compose'), null, 'no compose form over the limit');
  assert.match(await A.textContent('#stats'), /3 live notes/);
  await A.reload();
  await A.waitForSelector('#postBtn');
  await until(async () => (await titles(A)).length === 3, 'three notes after a reload', 15000);
  assert.ok(!(await titles(A)).includes('Senior React dev wanted'), 'the tombstone holds after a reload');

  step('the app’s own settings: defaults for new notes and collapsed notes');
  await B.click('#accountLink');
  await B.waitForSelector('#defaultsForm');
  assert.ok(B.url().includes('#/settings'), 'the account button opens the app’s settings');
  assert.ok(await B.$('a[href="../settings.html#account"]'), 'the site settings are one link away');
  assert.ok(await B.$('#how'), 'How it works sits in the settings, as in every app');
  const how = await B.$$eval('#how li', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(how.length, 5);
  assert.ok(how.every((x) => x.length > 40 && !/^(how|db)\./.test(x)), `DevBoard's own lines and the framework's topics, translated: ${how.join(' | ')}`);
  assert.equal(await B.$('#board #how'), null);
  await B.check('#defaultsForm input[name=type][value=available]', { force: true });
  await B.waitForSelector('.toast-success');
  await B.fill('#defaultsForm [name=contact]', 'hello@example.com');
  await B.press('#defaultsForm [name=contact]', 'Tab');
  await B.selectOption('#defaultsForm [name=days]', '3');
  await B.reload();
  await B.waitForSelector('#defaultsForm');
  assert.equal(await B.inputValue('#defaultsForm [name=contact]'), 'hello@example.com', 'defaults survive a reload');
  await B.click('.page-head .back');
  await B.waitForSelector('#postBtn');
  await B.click('#postBtn');
  await B.waitForSelector('#compose');
  assert.ok(await B.isChecked('#compose input[name=type][value=available]'), 'the default type is preselected');
  assert.equal(await B.inputValue('#compose [name=contact]'), 'hello@example.com', 'the default contact is filled in');
  assert.equal(await B.inputValue('#compose [name=days]'), '3', 'the default duration is selected');
  await B.click('#compose .modal-actions [data-close]');
  await until(async () => !(await B.$('#compose')), 'compose closed');

  step('a note’s author can be added as a friend; friends get a tag and their own filter');
  const F = await dev('F');
  await open(F);
  await until(async () => (await titles(F)).length === 3, 'F sees A’s notes', 20000);
  await menu(F, 'Second note', 'Add as friend');
  await F.waitForSelector('.toast-success');
  await A.goto(settings);
  await A.waitForSelector('#requestList [data-accept]', { timeout: 30000 });
  await A.click('#requestList [data-accept]');
  await until(async () => (await F.$$('.note .friend-tag')).length === 3, 'A’s notes carry the friend tag on F', 30000);
  await F.check('input[name=filter][value=friends]', { force: true });
  await until(async () => (await titles(F)).length === 3, 'the friends filter shows A’s notes');
  await menu(F, 'Second note', 'Report…'); // the menu no longer offers to add a friend
  assert.equal(await F.$('.menu'), null);
  await F.click('dialog.modal .modal-actions [data-close]');

  step('a German browser gets the board in German');
  const D = await dev('D', { locale: 'de-DE' });
  await D.goto(BOARD);
  await D.waitForSelector('#postBtn');
  assert.equal(await D.getAttribute('html', 'lang'), 'de');
  assert.equal((await D.textContent('#postBtn')).trim(), 'Notiz anpinnen');
  assert.equal(await D.title(), name, 'the tab says the name the hub mounts the app under');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const site = await testHub([{ app: 'notices', name: 'Notices', icon: 'sticky-note' }]);
  await run('notices', (env) => noticesSuite(env, { app: `${env.base}notices/`, settings: `${env.base}settings.html`, name: 'Notices' }), { webRoot: site });
}
