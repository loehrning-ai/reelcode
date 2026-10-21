// cursor.js: a planned cursor. plan = [{at, to: capId|[x,y]}, {at, click:true}, {at, drag: capId|[x,y]}]
// Positions are springs between resolved targets, so the cursor is a pure function of local beats.
import { sp, seqv, pulse, loopSeqv, mod } from './motion.js';
import { parseAt } from './beat.js';
import { pathOf } from './draw.js';
import { paint } from './text.js';

const defaultResolve = (to) => {
  if (Array.isArray(to) && to.length === 2) return to;
  throw new Error(`cursor: cannot resolve target ${JSON.stringify(to)}`);
};

/**
 * cursorAt(plan, lb | f, resolve, s='stiff' | {spring, loop}, spb=0.5) -> {x, y, press 0..1, visible, enter}
 * Pass the frame object f instead of lb to use its local beats and tempo.
 * {loop: beats}: the plan repeats with that period; the cursor wraps from its last target back to its first
 * with matching position and velocity (loopSeqv), clicks near the end also show at the start, and it is always visible.
 */
export function cursorAt(plan, lb, resolve = defaultResolve, s = 'stiff', spb = 0.5) {
  let loop = null;
  if (s && typeof s === 'object' && !Array.isArray(s)) { loop = s.loop ?? null; s = s.spring || 'stiff'; }
  if (lb && typeof lb === 'object') { spb = lb.grid.spb; lb = lb.lb; }
  if (!plan || !plan.length) return { x: 0, y: 0, press: 0, visible: false };
  const t = lb * spb;
  const keys = [];
  const presses = [];
  for (const step of plan) {
    const at = parseAt(step.at) * spb;
    if (step.to !== undefined) keys.push([at, resolve(step.to), s]);
    if (step.drag !== undefined) { keys.push([at + 0.08, resolve(step.drag), 'soft']); presses.push([at, at + 0.08 + 0.45]); }
    if (step.click) presses.push([at, at + 0.1]);
  }
  if (!keys.length) throw new Error('cursor: plan needs at least one {to}');
  keys.sort((a, b) => a[0] - b[0]);
  if (loop) {
    const T = loop * spb, tm = mod(t, T);
    const lk = keys.map(([a, v, k]) => [mod(a, T), v, k]).sort((a, b) => a[0] - b[0]);
    const [x, y] = loopSeqv(t, T, lk, s);
    let press = 0;
    for (const [a, b] of presses) for (const tt of [tm, tm + T, tm - T]) {
      const am = mod(a, T), bm = am + (b - a);
      press = Math.max(press, b - a > 0.2 ? sp(tt - am, 'snap') - sp(tt - bm, 'snap') : pulse(tt, am, b - a, 'snap'));
    }
    return { x, y, press: Math.max(0, Math.min(1, press)), visible: true, enter: 1 };
  }
  const start = [[keys[0][0], keys[0][1]]];
  const [x, y] = seqv(t, start.concat(keys.slice(1)), s);
  let press = 0;
  for (const [a, b] of presses) press = Math.max(press, b - a > 0.2 ? sp(t - a, 'snap') - sp(t - b, 'snap') : pulse(t, a, b - a, 'snap'));
  const enter = sp(t - keys[0][0], 'med');
  return { x, y, press: Math.max(0, Math.min(1, press)), visible: t >= keys[0][0], enter };
}

/**
 * Arrow cursor: fg fill with a bg keyline; shrinks a little while pressed.
 * c = {x, y, press?, visible?, enter?}: hidden only when visible === false; enter (0..1, default 1) scales it in.
 */
export function drawCursor(ctx, theme, c, scale = 1) {
  if (c.visible === false) return;
  const s = 64 * scale * (1 - 0.14 * (c.press || 0)) * (c.enter === undefined ? 1 : Math.max(0, c.enter));
  if (s <= 0) return;
  const pts = pathOf.arrow(c.x, c.y, s, 48);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = 5 * scale;
  ctx.strokeStyle = paint(theme, 'bg'); ctx.stroke();
  ctx.fillStyle = paint(theme, 'fg'); ctx.fill();
}

/** SFX markers for every click and drag in the plan: spread them into scene.sfx. */
export const clicks = (plan, gain_db = -6) =>
  (plan || []).filter((p) => p.click || p.drag !== undefined).map((p) => ({ at: p.at, sfx: 'click', gain_db }));
