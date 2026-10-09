// The framework's widgets in a real browser, on the gallery page (built only
// for tests and development): the markdown editor with drafts and conflicts,
// task lists, checklists and inventories, the collection, the feed against a
// relay (paging, live, blocked people) and the modal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { nip19 } from 'nostr-tools';
import { run, device, until, sleep, root } from './env.mjs';
import { assemble } from '../../scripts/build-site.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const { out: site } = await assemble({ distribution: root, out: fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-widgets-')), legacy: false, gallery: true });

await run(
  'widgets',
  async (env) => {
    const init = (relay) => {
      localStorage.setItem('wjs.relays', JSON.stringify([relay]));
      localStorage.setItem('wjs.lang', JSON.stringify('en'));
    };
    // Twelve notes from two people, a minute apart, published before the page opens.
    const ann = generateSecretKey();
    const bob = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);
    const relay = await Relay.connect(env.nostrUrl);
    const note = (sk, n, at) => finalizeEvent({ kind: 1, created_at: at, tags: [], content: `note ${n}` }, sk);
    for (let n = 1; n <= 12; n++) await relay.publish(note(n % 4 === 0 ? bob : ann, n, now - 60 * (13 - n)));

    const W = await device(env, 'W', init, env.nostrUrl);
    const GALLERY = `${env.base}widgets.html`;
    await W.goto(GALLERY);
    await W.waitForSelector('#editor .md-input');

    step('the editor saves after a pause and keeps the toolbar’s edits in the text');
    const ta = '#editor .md-input';
    await W.fill(ta, 'hello');
    await until(async () => (await W.textContent('#editor .save-state')) === 'Editing…', 'editing state');
    await until(async () => (await W.textContent('#savedText')) === 'hello', 'saved after the pause', 6000);
    assert.equal(await W.textContent('#editor .save-state'), 'Saved');
    await W.focus(ta);
    await W.keyboard.press('Control+A');
    await W.click('#editor [data-cmd=bold]');
    assert.equal(await W.inputValue(ta), '**hello**');
    await W.keyboard.press('Control+S');
    await until(async () => (await W.textContent('#savedText')) === '**hello**', 'Ctrl+S saves at once');
    assert.equal(await W.textContent('#editor .stats'), '1 word');

    step('a change from another device is taken when nothing is unsaved, and asked about when something is');
    await W.click('#remoteEdit');
    await until(async () => (await W.inputValue(ta)).includes('A line from another device.'), 'the remote text arrives in the editor');
    await W.fill(ta, 'mine');
    await W.click('#remoteEdit');
    await W.waitForSelector('#editor .alert:not([hidden])');
    await W.click('#editor [data-act=mine]');
    await until(async () => (await W.textContent('#savedText')) === 'mine', 'keep mine saves the local text');
    await W.fill(ta, 'mine again');
    await W.click('#remoteEdit');
    await W.waitForSelector('#editor .alert:not([hidden])');
    await W.click('#editor [data-act=theirs]');
    assert.equal(await W.inputValue(ta), 'mine\nA line from another device.\n', 'load theirs takes the other device’s text');
    assert.ok(await W.$('#editor .alert[hidden]'), 'the question goes away');

    step('on a phone the preview is its own pane; Done shows the note with clickable tasks');
    await W.fill(ta, '- [ ] alpha\n- [ ] beta');
    await W.click('#editor [data-pane=preview]');
    assert.ok(await W.isVisible('#editor .md-preview'));
    assert.ok(!(await W.isVisible(ta)), 'the text pane is hidden on a narrow screen');
    assert.equal((await W.$$('#editor .md-preview input[type=checkbox]')).length, 2);
    await W.click('#editor [data-act=done]');
    await W.waitForSelector('#mdView');
    await until(async () => (await W.textContent('#savedText')) === '- [ ] alpha\n- [ ] beta', 'Done saves first');
    await W.check('#mdView input[data-task="1"]');
    await until(async () => (await W.textContent('#savedText')) === '- [ ] alpha\n- [x] beta', 'ticking a task in the note saves the source');

    step('checklist: typing, quantities, sections, pasting several lines');
    const C = '#checklist';
    assert.deepEqual(await texts(W, `${C} [data-part=active] .text`), ['milk', 'Dairy', 'eggs']);
    assert.ok(await W.$(`${C} li.is-header`), 'a "# " line is a section header');
    assert.equal(await W.textContent(`${C} .list-meta`), '1 of 3 done', 'headers do not count');
    await W.fill(`${C} .add-item input`, '3x apples');
    await W.press(`${C} .add-item input`, 'Enter');
    await until(async () => (await texts(W, `${C} [data-part=active] .text`)).includes('apples'), 'apples added');
    assert.equal(await W.textContent(`${C} li:has-text("apples") .qty`), '×3');
    await W.$eval(`${C} .add-item input`, (input) => {
      const data = new DataTransfer();
      data.setData('text', 'pears\nplums');
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await until(async () => (await texts(W, `${C} [data-part=active] .text`)).join('|').endsWith('apples|pears|plums'), 'pasted lines become items, in order');
    await W.waitForSelector('.toast-success');

    step('checklist: ticking off, the done section, unchecking all');
    await W.check(`${C} li:has-text("eggs") .check input`, { force: true });
    await until(async () => (await texts(W, `${C} [data-part=done] .text`)).sort().join('|') === 'butter|eggs', 'eggs moved to done');
    await W.click(`${C} [data-act=uncheck]`);
    await until(async () => !(await texts(W, `${C} [data-part=done] .text`)).length, 'everything unchecked');
    assert.ok(await W.$(`${C} .done-box[hidden]`), 'the done section hides when empty');

    step('checklist: editing in place, deleting with undo');
    await W.click(`${C} li:has-text("milk") .text`);
    await W.fill(`${C} .edit-input`, 'oat milk x4');
    await W.press(`${C} .edit-input`, 'Enter');
    await until(async () => (await texts(W, `${C} [data-part=active] .text`)).includes('oat milk'), 'edited');
    assert.equal(await W.textContent(`${C} li:has-text("oat milk") .qty`), '×4');
    await W.click(`${C} li:has-text("plums") [data-act=delete]`);
    await W.waitForSelector('.toast .toast-action');
    assert.ok(!(await texts(W, `${C} [data-part=active] .text`)).includes('plums'));
    await W.click('.toast:has-text("plums") .toast-action');
    await until(async () => (await texts(W, `${C} [data-part=active] .text`)).includes('plums'), 'undo puts it back');

    step('checklist: reordering with Alt+arrows and by dragging');
    const order = () => texts(W, `${C} [data-part=active] .text`);
    const first = (await order())[0];
    await W.focus(`${C} [data-part=active] li:first-child .check input`);
    await W.keyboard.press('Alt+ArrowDown');
    await until(async () => (await order())[1] === first, 'Alt+↓ moves the row down');
    const before = await order();
    const last = before.at(-1);
    const grip = await W.$(`${C} [data-part=active] li:last-child .grip`);
    const top = await W.$(`${C} [data-part=active] li:first-child`);
    const g = await grip.boundingBox();
    const tb = await top.boundingBox();
    await W.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await W.mouse.down();
    for (let y = g.y + g.height / 2; y > tb.y; y -= 10) await W.mouse.move(g.x + g.width / 2, y);
    await W.mouse.move(g.x + g.width / 2, tb.y - 5);
    await W.mouse.up();
    await until(async () => (await order())[0] === last, `dragging puts "${last}" first`);

    step('checklist: dragging down, and holding at the bottom edge of a small screen, where the page scrolls');
    const listAt = (y) => W.$eval(`${C} [data-part=active]`, (el, at) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - at), y);
    const mid = async (sel) => {
      const b = await (await W.$(sel)).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height };
    };
    await listAt(200);
    const firstNow = (await order())[0];
    let from = await mid(`${C} [data-part=active] li:nth-child(1) .grip`);
    const second = await mid(`${C} [data-part=active] li:nth-child(2)`);
    await W.mouse.move(from.x, from.y);
    await W.mouse.down();
    for (let y = from.y; y < second.y + 12; y += 6) await W.mouse.move(from.x, y);
    await W.mouse.move(from.x, second.y + 12);
    await W.mouse.up();
    await until(async () => (await order())[1] === firstNow, 'dragging down moves the row down one place');
    await W.setViewportSize({ width: 420, height: 320 });
    await listAt(90);
    const topNow = (await order())[0];
    from = await mid(`${C} [data-part=active] li:nth-child(1) .grip`);
    await W.mouse.move(from.x, from.y);
    await W.mouse.down();
    for (let y = from.y; y < 300; y += 10) await W.mouse.move(from.x, y);
    for (let t = 0; t < 2500; t += 50) {
      await W.mouse.move(from.x, 300 + (t % 100 ? 1 : 0));
      await sleep(50);
    }
    await W.mouse.up();
    await until(async () => (await order()).at(-1) === topNow, 'held at the bottom edge, the page scrolls and the row goes last');
    assert.equal(await W.evaluate(() => document.documentElement.classList.contains('wjs-dragging')), false, 'nothing left over from the drag');
    await W.setViewportSize({ width: 420, height: 900 });

    step('checklist: clearing done items asks first');
    await W.check(`${C} li:has-text("pears") .check input`, { force: true });
    await until(async () => (await texts(W, `${C} [data-part=done] .text`)).includes('pears'), 'pears done');
    await W.click(`${C} [data-act=clear]`);
    await W.waitForSelector('dialog.modal [data-ok]');
    await W.click('dialog.modal [data-ok]');
    await until(async () => !(await texts(W, `${C} .text`)).includes('pears'), 'cleared');

    step('inventory: counting up and down; read-only lists cannot be changed');
    const I = '#inventory';
    assert.ok(await W.$(`${I} li.is-zero:has-text("soap")`), 'zero stock is marked');
    await W.click(`${I} li:has-text("soap") [data-step="1"]`);
    await until(async () => (await W.textContent(`${I} li:has-text("soap") .count`)) === '1', 'counted up');
    assert.equal(await W.$(`${I} li.is-zero`), null);
    await W.click(`${I} li:has-text("rice") [data-step="-1"]`);
    await until(async () => (await W.textContent(`${I} li:has-text("rice") .count`)) === '2', 'counted down');
    assert.equal(await W.$('#readonly .add-item'), null, 'no add form when read only');
    assert.ok(await W.$eval('#readonly .check input', (i) => i.disabled), 'checkboxes are disabled when read only');

    step('collection: pinned first, pinning, search');
    const P = '#collection';
    assert.deepEqual(await texts(W, `${P} [data-part=pinned] .collection-body`), ['Gem store']);
    assert.deepEqual(await texts(W, `${P} [data-part=others] .collection-body`), ['Book swap', 'Seedbank', 'Tool shed']);
    await W.click(`${P} li[data-key=seeds] .pin-btn`);
    await until(async () => (await texts(W, `${P} [data-part=pinned] .collection-body`)).join('|') === 'Gem store|Seedbank', 'pinned');
    assert.equal(await W.getAttribute(`${P} li[data-key=seeds] .pin-btn`, 'aria-pressed'), 'true');
    await W.fill(`${P} .collection-search`, 'tool');
    assert.deepEqual(await texts(W, `${P} .collection-body`), ['Tool shed']);
    await W.fill(`${P} .collection-search`, 'zzz');
    assert.equal(await W.textContent(`${P} .collection-empty`), 'Nothing matches “zzz”.');
    await W.fill(`${P} .collection-search`, '');

    step('feed: newest first, five at a time, then the end');
    const F = '#feed';
    const notes = () => texts(W, `${F} .gallery-note`);
    await until(async () => (await notes()).length === 5, 'the first page', 15000);
    assert.deepEqual(await notes(), ['note 12', 'note 11', 'note 10', 'note 9', 'note 8']);
    await W.click(`${F} [data-act=more]`);
    await until(async () => (await notes()).length === 10, 'the second page', 15000);
    await W.click(`${F} [data-act=more]`);
    await until(async () => (await notes()).length === 12, 'the rest', 15000);
    await W.click(`${F} [data-act=more]`);
    await W.waitForSelector(`${F} .feed-end`, { timeout: 15000 });
    assert.equal((await notes()).at(-1), 'note 1');

    step('feed: a new note shows up live, at the top');
    await relay.publish(note(ann, 13, now));
    await until(async () => (await notes())[0] === 'note 13', 'live note on top', 15000);

    step('feed: blocking someone in the settings takes their notes out of every feed');
    await W.goto(`${env.base}settings.html`);
    await W.waitForSelector('#blockForm');
    await W.fill('#blockForm [name=who]', nip19.npubEncode(getPublicKey(bob)));
    await W.click('#blockForm .btn');
    await until(async () => (await texts(W, '#blockedList li')).length === 1 && !(await texts(W, '#blockedList li'))[0].includes('No one'), 'bob blocked');
    await W.goto(GALLERY);
    await W.waitForSelector(`${F} .gallery-note`, { timeout: 15000 });
    await W.$eval(F, (el) => el.scrollIntoView());
    await W.check('#autoLoad', { force: true });
    await W.waitForSelector(`${F} .feed-end`, { timeout: 20000 });
    const shown = await notes();
    assert.equal(shown.length, 10, `ann's ten notes, loaded by scrolling: ${shown.join(', ')}`);
    assert.ok(!shown.some((x) => ['note 4', 'note 8', 'note 12'].includes(x)), 'none of bob’s');

    step('modal: opens, and Escape closes it');
    await W.click('#openModal');
    await W.waitForSelector('#demoModal[open]');
    await W.keyboard.press('Escape');
    await until(async () => !(await W.$('#demoModal')), 'closed');
    relay.close();
  },
  { webRoot: site },
);
