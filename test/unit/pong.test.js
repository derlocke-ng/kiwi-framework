import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H, PH, PX, PW, BALL, WIN, newGame, step, serve, reflectY, predictY, cpuMove, snapshot, extrapolate } from '../../apps/pong/game.js';

const run = (s, seconds, dt = 1 / 120) => {
  for (let t = 0; t < seconds; t += dt) step(s, dt);
};

test('serves after a pause, towards the given side', () => {
  const s = newGame(1);
  assert.equal(s.ph, 'serve');
  run(s, 0.5);
  assert.equal(s.ph, 'serve');
  run(s, 0.5);
  assert.equal(s.ph, 'play');
  assert.ok(s.vx > 0);
});

test('bounces off the walls', () => {
  const s = newGame(1);
  Object.assign(s, { ph: 'play', bx: W / 2, by: 2, vx: 100, vy: -400 });
  step(s, 0.02);
  assert.ok(s.vy > 0 && s.by >= 0);
  assert.equal(s.walls, 1);
});

test('a paddle returns the ball faster, even at speeds that would tunnel', () => {
  const s = newGame(-1);
  Object.assign(s, { ph: 'play', bx: PX + PW + 5, by: s.l + PH / 2 - BALL / 2, vx: -3000, vy: 0 });
  step(s, 1 / 60); // 50 px in one step: further than the paddle is wide
  assert.ok(s.vx > 0, 'reflected');
  assert.equal(s.hits, 1);
  assert.equal(s.bx, PX + PW);
});

test('the hit position steers the ball', () => {
  const s = newGame(1);
  Object.assign(s, { ph: 'play', bx: W - PX - PW - BALL - 1, by: s.r, vx: 400, vy: 0 });
  step(s, 1 / 60);
  assert.ok(s.vx < 0 && s.vy < 0, 'top of the paddle sends it up');
});

test('missing the ball scores and the loser receives the serve', () => {
  const s = newGame(1);
  Object.assign(s, { ph: 'play', bx: W - 2, by: 0, r: H - PH, vx: 600, vy: 0 });
  run(s, 0.1);
  assert.equal(s.ls, 1);
  assert.equal(s.ph, 'serve');
  assert.equal(s.dir, 1);
});

test('first to seven wins', () => {
  const s = newGame(1);
  s.rs = WIN - 1;
  Object.assign(s, { ph: 'play', bx: 1, by: 0, l: H - PH, vx: -600, vy: 0 });
  run(s, 0.1);
  assert.equal(s.ph, 'over');
  assert.equal(s.w, 'r');
  run(s, 2);
  assert.equal(s.ph, 'over', 'nothing moves after the end');
  serve(s, 1);
  assert.equal(s.ph, 'serve');
});

test('prediction folds off walls; extrapolation follows it', () => {
  const span = H - BALL;
  assert.equal(reflectY(-10), 10);
  assert.equal(reflectY(span + 10), span - 10);
  assert.equal(reflectY(2 * span + 5), 5);
  const s = { bx: 100, by: 50, vx: 100, vy: -100 };
  assert.equal(predictY(s, 200), 50);
  assert.equal(predictY({ ...s, vx: -100 }, 200), null);
  const snap = snapshot({ ...newGame(1), ph: 'play', bx: 100, by: 50, vx: 100, vy: -100 }, 1);
  assert.deepEqual(extrapolate(snap, 1000), { bx: 125, by: 25 }, 'capped at 250 ms ahead');
});

test('the practice CPU moves towards the ball but not instantly', () => {
  const s = newGame(1);
  Object.assign(s, { ph: 'play', bx: W / 2, by: 20, vx: 400, vy: 0, r: H - PH });
  cpuMove(s, 1 / 60);
  assert.ok(s.r < H - PH && s.r > H - PH - 20);
});
