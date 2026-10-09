// Pong rules and physics on a fixed 800×500 field, independent of screen
// size. The host runs step(); the guest only draws snapshots and predicts the
// ball between them.

export const W = 800;
export const H = 500;
export const PW = 12; // paddle width
export const PH = 90; // paddle height
export const PX = 24; // paddle distance from the edge
export const BALL = 12;
export const WIN = 7;
export const PADDLE_SPEED = 560; // px/s
const START_SPEED = 360;
const MAX_SPEED = 980;
const SPEEDUP = 1.06;
const MAX_ANGLE = Math.PI * 0.3;
const SERVE_DELAY = 900; // ms

export const clampPaddle = (y) => Math.max(0, Math.min(H - PH, y));

export function newGame(dir = Math.random() < 0.5 ? -1 : 1) {
  const s = { l: (H - PH) / 2, r: (H - PH) / 2, ls: 0, rs: 0, w: null, hits: 0, walls: 0, points: 0 };
  serve(s, dir);
  return s;
}

/** Put the ball in the middle; it leaves towards `dir` (-1 left, 1 right) after a pause. */
export function serve(s, dir) {
  s.bx = W / 2 - BALL / 2;
  s.by = H / 2 - BALL / 2;
  s.vx = 0;
  s.vy = 0;
  s.dir = dir;
  s.ph = 'serve';
  s.serveIn = SERVE_DELAY;
}

const hitsPaddle = (ballY, padY) => ballY + BALL >= padY && ballY <= padY + PH;

/** Fold a y position into the field, bouncing off top and bottom. */
export function reflectY(y) {
  const span = H - BALL;
  let m = ((y % (2 * span)) + 2 * span) % (2 * span);
  if (m > span) m = 2 * span - m;
  return m;
}

function bounce(s, side, ballY) {
  const pad = side === 'l' ? s.l : s.r;
  const rel = (ballY + BALL / 2 - (pad + PH / 2)) / (PH / 2 + BALL / 2);
  const angle = Math.max(-1, Math.min(1, rel)) * MAX_ANGLE;
  const speed = Math.min(MAX_SPEED, Math.hypot(s.vx, s.vy) * SPEEDUP);
  s.vx = Math.cos(angle) * speed * (side === 'l' ? 1 : -1);
  s.vy = Math.sin(angle) * speed;
  s.hits++;
}

function point(s, scorer) {
  if (scorer === 'l') s.ls++;
  else s.rs++;
  s.points++;
  if (s.ls >= WIN || s.rs >= WIN) {
    serve(s, 0);
    s.ph = 'over';
    s.w = scorer;
    return;
  }
  // The ball goes to the player who lost the point.
  serve(s, scorer === 'l' ? 1 : -1);
}

/** Advance the game by dt seconds (use small fixed steps). */
export function step(s, dt) {
  if (s.ph === 'over') return;
  if (s.ph === 'serve') {
    s.serveIn -= dt * 1000;
    if (s.serveIn <= 0) {
      const a = (Math.random() * 2 - 1) * Math.PI * 0.12;
      s.vx = Math.cos(a) * START_SPEED * s.dir;
      s.vy = Math.sin(a) * START_SPEED;
      s.ph = 'play';
    }
    return;
  }
  const px = s.bx;
  const py = s.by;
  let nx = px + s.vx * dt;
  let ny = py + s.vy * dt;
  if (ny < 0) {
    ny = -ny;
    s.vy = Math.abs(s.vy);
    s.walls++;
  } else if (ny > H - BALL) {
    ny = 2 * (H - BALL) - ny;
    s.vy = -Math.abs(s.vy);
    s.walls++;
  }
  // Swept test against each paddle face, so fast balls can't tunnel through.
  const leftFace = PX + PW;
  const rightFace = W - PX - PW - BALL;
  if (s.vx < 0 && px >= leftFace && nx < leftFace) {
    const t = (px - leftFace) / (px - nx);
    const yAt = py + (ny - py) * t;
    if (hitsPaddle(yAt, s.l)) {
      bounce(s, 'l', yAt);
      s.bx = leftFace;
      s.by = yAt;
      return;
    }
  } else if (s.vx > 0 && px <= rightFace && nx > rightFace) {
    const t = (rightFace - px) / (nx - px);
    const yAt = py + (ny - py) * t;
    if (hitsPaddle(yAt, s.r)) {
      bounce(s, 'r', yAt);
      s.bx = rightFace;
      s.by = yAt;
      return;
    }
  }
  s.bx = nx;
  s.by = ny;
  if (s.bx + BALL < 0) point(s, 'r');
  else if (s.bx > W) point(s, 'l');
}

/** Where the ball will cross x (ignoring paddles), or null if it's moving away. */
export function predictY(s, x) {
  if (!s.vx || (x - s.bx) / s.vx < 0) return null;
  return reflectY(s.by + s.vy * ((x - s.bx) / s.vx));
}

/** Practice opponent on the right: tracks where the ball will land, with a speed cap and a little error. */
export function cpuMove(s, dt, skill = 0.82) {
  const face = W - PX - PW - BALL;
  const landing = s.vx > 0 ? predictY(s, face) : null;
  const target = landing == null ? H / 2 - PH / 2 : landing + BALL / 2 - PH / 2 + (s.hits % 3 - 1) * PH * 0.18;
  const max = PADDLE_SPEED * skill * dt;
  const diff = target - s.r;
  if (Math.abs(diff) > 2) s.r = clampPaddle(s.r + Math.max(-max, Math.min(max, diff)));
}

const r1 = (v) => Math.round(v * 10) / 10;

/** The host's state as sent to the guest (~100 bytes). */
export function snapshot(s, n) {
  return { t: 's', n, l: r1(s.l), r: r1(s.r), bx: r1(s.bx), by: r1(s.by), vx: r1(s.vx), vy: r1(s.vy), ls: s.ls, rs: s.rs, ph: s.ph, w: s.w, h: s.hits, k: s.walls, p: s.points };
}

/** Ball position `ms` after a snapshot, for drawing between snapshots. */
export function extrapolate(snap, ms) {
  if (snap.ph !== 'play') return { bx: snap.bx, by: snap.by };
  const t = Math.min(ms, 250) / 1000;
  return { bx: Math.max(-BALL, Math.min(W, snap.bx + snap.vx * t)), by: reflectY(snap.by + snap.vy * t) };
}
