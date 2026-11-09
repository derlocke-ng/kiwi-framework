// A hub whose relay lets only its members write (kiwi-modules' members relay, handoffs/kiwi-modules-relay-
// members.md): the relay challenges every connection (NIP-42), takes writes from a connection that proved a
// member's key whoever signed them (a board's own key), refuses the rest, and takes a gift wrap to a member from
// anyone. A company's hub locks its relays and proves the key at once; an open hub proves it only when the relay
// refuses something, then sends it again. Someone new registers: the account entry carries the proof of work the
// hub asks for (policy.registerPow), the relay takes it as the sign-up, and from then on the key writes.
import assert from 'node:assert/strict';
import { getPow } from 'nostr-tools/nip13';
import { startRelay } from '../../scripts/nostr-relay.mjs';
import { bytesToHex, generateSecretKey, getPublicKey, hexToBytes } from '../../shared/nostr.mjs';
import { device, freePort, run, startBoard, testHub, until } from './env.mjs';

const step = (s) => console.log(`• ${s}`);
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const keys = (alias) => {
  const sk = bytesToHex(generateSecretKey());
  return { sk, pk: getPublicKey(hexToBytes(sk)), alias, created: Date.now() };
};

const port = await freePort();
const RELAY = `ws://localhost:${port}`;
const members = new Set();
const POW = 8;
const relay = await startRelay({ port, name: 'members relay', auth: { allow: (pk) => members.has(pk), register: (pk) => members.add(pk), registerPow: POW, serviceUrl: RELAY } });
const apps = [
  { app: 'boards', name: 'Boards', icon: 'list-checks' },
  { app: 'chat', name: 'Chat', icon: 'message-circle' },
];
const company = await testHub(apps, { id: 'company', name: 'Company', relays: [RELAY], policy: { relays: 'locked', registerPow: POW } });
const open = await testHub(apps, { id: 'open', name: 'Open', relays: [RELAY] });
const BOARDS = [30700, 30701, 30702, 30703];
const boardsOnRelay = () => relay.store.query([{ kinds: BOARDS }]);

await run(
  'members',
  async (env) => {
    const init = (identity) => localStorage.setItem('wjs.identity', JSON.stringify(identity));
    const dev = (name, identity) => device(env, name, init, identity);
    const makeBoard = async (page, base, title) => {
      await page.goto(`${base}boards/`);
      await page.waitForSelector('.home');
      await startBoard(page, 'check');
      await page.fill('#newBoard input[name=title]', title);
      await page.click('#newBoard [type=submit]');
      await page.waitForSelector('#boardName', { timeout: 15000 });
    };

    step('someone who is not a member writes on the company hub: the relay refuses, the board stays on their device');
    const bea = keys('bea');
    const B = await dev('B', bea);
    await makeBoard(B, env.base, 'Not on the relay');
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(boardsOnRelay().length, 0, 'nothing of it on the relay');

    step('a member on the company hub (relays locked): the page proves its key at once; the board, signed by its own key, is on the relay');
    const ada = keys('ada');
    members.add(ada.pk);
    const A = await dev('A', ada);
    await makeBoard(A, env.base, 'Shift plan');
    await until(() => boardsOnRelay().length > 0, 'the board on the relay', 15000);
    assert.ok(
      boardsOnRelay().some((e) => e.pubkey !== ada.pk),
      'signed by the board’s key, not the member’s: the connection is the member’s',
    );

    step('an open hub on the same relay: the page proves its key only when the relay refuses, then sends it again');
    const openBase = await env.serve(open);
    const cid = keys('cid');
    members.add(cid.pk);
    const before = boardsOnRelay().length;
    const C = await dev('C', cid);
    await makeBoard(C, openBase, 'Garden');
    await until(() => boardsOnRelay().length > before, 'the open hub’s board on the relay after the refusal', 20000);

    step('someone new registers on the company hub: the entry carries the work the hub asks for, the relay takes it as the sign-up, then their boards');
    const dan = keys('dan');
    const D = await dev('D', dan);
    await D.goto(`${env.base}settings.html`);
    await D.waitForSelector('#authForm');
    await D.check('input[name=authTab][value=create]', { force: true });
    await D.fill('#authForm [name=alias]', 'dan_members');
    await D.fill('#authForm [name=pass]', 'a long enough password');
    await D.fill('#authForm [name=pass2]', 'a long enough password');
    await D.click('#authBtn');
    await until(async () => (await D.textContent('#accountBody')).includes('dan_members'), 'the account is created', 60000);
    const entry = relay.store.query([{ kinds: [30790], authors: [dan.pk] }])[0];
    assert.ok(entry, 'the account entry is on the relay');
    assert.ok(getPow(entry.id) >= POW, 'with the proof of work');
    assert.ok(members.has(dan.pk), 'the relay took it as the sign-up');
    const had = boardsOnRelay().length;
    await makeBoard(D, env.base, 'First week');
    await until(() => boardsOnRelay().length > had, 'the new member’s board on the relay', 15000);

    step('a fresh device signs into a member’s account: its connection proved the device’s own key first, and is made anew for the member’s');
    const E = await device(env, 'E', (relay) => localStorage.setItem('wjs.relays', JSON.stringify([relay])), RELAY);
    await E.goto(`${env.base}settings.html`);
    await E.waitForSelector('#authForm');
    const deviceKey = await E.evaluate(() => JSON.parse(localStorage.getItem('wjs.identity')).pk);
    // the device key's first writes: the relay asks who writes, the page answers with the device's key
    await until(() => relay.authedAs(deviceKey), 'the device key proven on its connection', 15000);
    await E.check('input[name=authTab][value=signin]', { force: true });
    await E.fill('#authForm [name=alias]', 'dan_members');
    await E.fill('#authForm [name=pass]', 'a long enough password');
    await E.click('#authBtn');
    await until(async () => (await E.textContent('#accountBody')).includes('dan_members'), 'signed in', 60000);
    // on the same page, without a new one: the account's language goes to the relay as the member's
    const since = Math.floor(Date.now() / 1000);
    const pageId = await E.evaluate(() => performance.timeOrigin);
    await E.evaluate(() => {
      location.hash = '#device';
    });
    await E.waitForSelector('#langSelect');
    await E.selectOption('#langSelect', 'de');
    await until(
      () => relay.store.query([{ kinds: [30791], authors: [dan.pk], '#d': ['suite'] }]).some((e) => e.created_at >= since),
      'the member’s settings, written right after signing in, on the relay',
      20000,
    );
    assert.equal(await E.evaluate(() => performance.timeOrigin), pageId, 'all on the page the person signed in on');
    await E.selectOption('#langSelect', 'en');

    step('a message to a member from someone who is not one goes through: a gift wrap to a member is taken from anyone');
    await B.goto(`${env.base}chat/#/dm/${ada.pk}`);
    await B.waitForSelector('#composer textarea');
    await B.fill('#composer textarea', 'hello from outside');
    await B.press('#composer textarea', 'Enter');
    await A.goto(`${env.base}chat/#/dm/${bea.pk}`);
    await A.waitForSelector('#composer textarea');
    await until(async () => (await texts(A, '#messages .msg p')).includes('hello from outside'), 'the message reaches the member', 20000);
  },
  { webRoot: company },
).finally(() => relay.close());
