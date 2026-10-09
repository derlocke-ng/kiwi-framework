// pong in Chromium: practice against the CPU, a direct game with rematch
// and leaving, a game through the gun relay, and joining from the
// open-games lobby.
//
// A distribution runs it against its own site:
//   import { pongSuite } from 'kiwi-framework/test/e2e/pong.mjs';
//   await run('pong', (env) => pongSuite(env, { app: `${env.base}pongjs/` }), { webRoot: site });
// Run directly, it builds a test hub with the app at pong/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run, device, until, sleep, testHub, topBar } from './env.mjs';

const step = (s) => console.log(`• ${s}`);

/**
 * @param {any} env  from env.mjs (run)
 * @param {{ app: string }} where  the app's URL
 */
export async function pongSuite(env, { app }) {
  const init = (relay) => {
    localStorage.setItem('pong.relays', JSON.stringify([relay]));
    localStorage.setItem('pong.mute', 'true');
    globalThis.__pongTest = {};
  };
  const state = (p) => p.evaluate(() => {
    const S = globalThis.__pongTest.session;
    return S && { mode: S.mode, kind: S.ch?.kind || null, s: { ...S.s }, snapN: S.snap?.n ?? -1, rtt: S.rtt, names: S.names };
  });
  const player = async (name, query = '') => {
    const p = await device(env, name, init, env.relayUrl);
    await p.goto(`${app}${query}`);
    await p.fill('#name', name);
    return p;
  };

  step('practice against the CPU');
  const P = await player('SOLO');
  await P.click('#cpuBtn');
  await P.waitForSelector('#game:not([hidden])');
  const s0 = (await state(P)).s;
  await sleep(1500);
  const s1 = (await state(P)).s;
  assert.equal(s1.ph, 'play');
  assert.notEqual(s1.bx, s0.bx, 'the ball moves');
  await P.keyboard.down('ArrowDown');
  await sleep(400);
  await P.keyboard.up('ArrowDown');
  assert.ok((await state(P)).s.l > s1.l + 50, 'keys move the paddle');
  await P.ctx.close();

  step('host and guest connect directly from a link');
  const H = await player('ANN');
  await H.click('#hostBtn');
  await H.waitForSelector('#wait:not([hidden])');
  const link = await H.inputValue('#link');
  const G = await player('BOB');
  await G.goto(link);
  await G.waitForSelector('#game:not([hidden])', { timeout: 30000 });
  await H.waitForSelector('#game:not([hidden])');
  assert.equal(await G.textContent('#leftName'), 'ANN');
  assert.equal(await H.textContent('#rightName'), 'BOB');
  await until(async () => (await state(G)).snapN > 20, 'snapshots reach the guest');
  assert.equal((await state(G)).kind, 'direct');
  await until(async () => (await G.textContent('#netInfo')).match(/DIRECT · \d+ MS/), 'ping shown');

  step('the guest’s paddle moves on the host');
  const before = (await state(H)).s.r;
  await G.keyboard.down('ArrowUp');
  await sleep(500);
  await G.keyboard.up('ArrowUp');
  await until(async () => (await state(H)).s.r < before - 60, 'host sees the guest paddle move');

  step('the game ends at 7 and a rematch starts over');
  await H.evaluate(() => {
    const s = globalThis.__pongTest.session.s;
    Object.assign(s, { ls: 6, ph: 'play', bx: 760, by: 10, vx: 900, vy: 0, r: 400 });
    globalThis.__pongTest.session.remoteY = 400;
  });
  await until(async () => (await H.textContent('#overlay')).includes('YOU WIN'), 'host wins');
  await until(async () => (await G.textContent('#overlay')).includes('ANN WINS'), 'guest sees the result');
  await G.click('#overlay [data-act=rematch]');
  await until(async () => (await H.$('#overlay[hidden]')) && (await state(H)).s.ls === 0, 'host restarted');
  await until(async () => (await G.$('#overlay[hidden]')) === null || (await state(G)).s.ls === 0, 'guest restarted');

  step('when the guest leaves, the host can wait for someone new');
  await G.ctx.close();
  await until(async () => (await H.textContent('#overlay')).includes('OPPONENT LEFT'), 'host notices', 20000);
  await H.click('#overlay [data-act=wait]');
  const G2 = await player('CAT');
  await G2.goto(link);
  await G2.waitForSelector('#game:not([hidden])', { timeout: 30000 });
  await until(async () => (await H.textContent('#rightName')) === 'CAT', 'new opponent on the host');
  await H.ctx.close();
  await G2.ctx.close();

  step('a game through the gun relay');
  const RH = await player('RELAYHOST', '?relay');
  await RH.click('#hostBtn');
  await RH.waitForSelector('#wait:not([hidden])');
  const RG = await player('RELAYGUEST', '?relay');
  await RG.goto(await RH.inputValue('#link'));
  await RG.waitForSelector('#game:not([hidden])', { timeout: 30000 });
  await until(async () => (await state(RG)).snapN > 10, 'snapshots over the relay', 15000);
  assert.equal((await state(RG)).kind, 'relay');
  assert.match(await RG.textContent('#netInfo'), /VIA RELAY/);
  await RH.ctx.close();
  await RG.ctx.close();

  step('joining from the open-games lobby');
  const LH = await player('LOBBYHOST');
  await LH.click('#hostBtn');
  await LH.waitForSelector('#wait:not([hidden])');
  await LH.check('#listPublic');
  const LG = await player('LOBBYGUEST');
  await until(async () => (await LG.textContent('#lobby')).includes('LOBBYHOST'), 'game listed', 15000);
  await LG.click('#lobby button:has-text("LOBBYHOST")');
  await LG.waitForSelector('#game:not([hidden])', { timeout: 30000 });
  await until(async () => !(await LG.textContent('#lobby')).includes('LOBBYHOST'), 'game unlisted once it started', 15000);

  step('the suite’s top bar, exactly as on the hub: place, size and type');
  assert.deepEqual(await topBar(env, app), await topBar(env, env.base));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const site = await testHub([{ app: 'pong', name: 'pong', icon: 'gamepad-2' }]);
  await run('pong', (env) => pongSuite(env, { app: `${env.base}pong/` }), { webRoot: site });
}
