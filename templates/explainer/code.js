// code.js: the seek(t) source as a picture. The cold open opens on it full bleed (so "This is code." is a true
// statement) and the recap's chain reaction starts from it. The highlighted line is the one the ball drops out of.
import { inkOn } from './ink.js';

export const SOURCE = [
  'function seek(t) {',
  '  clear(ctx);',
  "  word('CODE');",
  '  ball.x = cross(t);',
  '  ball.y = bounce(t);',
  '  draw(ball, shadow);',
  '}',
];
export const HI = 4;

/** planCode(api, box, {max, min, lines}) -> text fits for the plain lines and the highlighted line, plus the plate. */
export function planCode(api, box, { max, min, lines = SOURCE, hi = HI, bg = 'fg' }) {
  const { T, ctx, theme } = api;
  const longest = lines.reduce((a, s) => (s.length > a.length ? s : a));
  const m100 = T.measure(ctx, theme, 'ui', longest, 100);
  const size = Math.max(min, Math.min(max, (box.w * 0.92 * 100) / m100.w, box.h / (lines.length * 1.5)));
  const m = T.measure(ctx, theme, 'ui', 'M', size), lh = size * 1.5, cap = m.cap;
  const y0 = box.y + (box.h - lh * (lines.length - 1) - cap) / 2 + cap;
  const lineOf = (s, i) => {
    const ind = s.length - s.trimStart().length, x = box.x + T.measure(ctx, theme, 'ui', ' '.repeat(ind) + 'x', size).w - T.measure(ctx, theme, 'ui', 'x', size).w;
    const t = s.trim();
    return { s: t, x, y: y0 + i * lh, w: T.measure(ctx, theme, 'ui', t, size).w };
  };
  const all = lines.map(lineOf);
  const fit = (ls) => Object.freeze({ size, cap, lh, lines: ls, overflow: false, role: 'ui', weight: undefined, box });
  const h = all[hi], pad = size * 0.35;
  return {
    size, lh, all, hiLine: h,
    plain: fit(all.filter((_, i) => i !== hi)), hiFit: fit([h]),
    plate: { x: h.x - pad, y: h.y - cap - pad, w: h.w + 2 * pad, h: cap + 2 * pad },
    ink: inkOn(api, 'bg', bg, size), hiInk: inkOn(api, 'fg', 'accent', size),
    end: [h.x + h.w + size * 0.9, h.y - cap / 2],     // where the ball sits before it drops
  };
}

/** Lines mask in from `at` (one line per 0.12 beat); the highlight plate opens on `hiAt`. quiet: nothing logged. */
export function drawCode(f, api, pl, { at = -4, hiAt = 0, quiet = false } = {}) {
  const { T, D, M, ctx } = api;
  const run = () => {
    T.kinetic(f, pl.plain, { by: 'line', at, stagger: 0.08, from: 'mask', spring: 'stiff', color: pl.ink });
    const open = M.clamp(M.sp(f.since(hiAt), 'snap'), 0, 1.04);
    if (open > 0) {
      const p = pl.plate;
      D.fillBox(ctx, { ...p, w: p.w * open }, 'accent', p.h * 0.18);
    }
    T.kinetic(f, pl.hiFit, { by: 'line', at, from: 'mask', spring: 'stiff', color: open > 0.5 ? pl.hiInk : pl.ink });
  };
  if (quiet) T.quiet(run); else run();
}
