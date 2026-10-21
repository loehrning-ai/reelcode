// strip.js: the step's diagram shrunk to a one-row caption strip of chips (label pills joined by small chevrons)
// under a hero shot. One chip pops per beat; the focus chip lights in the accent. Labels sit at the readable size R.
import { inkOn } from './ink.js';

/** Width the chips of `nodes` need at size R (one row), or Infinity when they cannot share one row. */
export function chipsWidth(api, nodes, R) {
  const { T, ctx, theme } = api;
  const pad = R * 0.5, gap = R * 0.75;
  return nodes.reduce((a, nd) => a + T.measure(ctx, theme, 'ui', nd.label, R).w + 2 * pad, 0) + gap * (nodes.length - 1);
}

/** planChips(api, diagram, box, R, align) -> chip boxes centred (or left-aligned) on one row at the top of box. */
export function planChips(api, d, box, R, align = 'c') {
  const { T, ctx, theme } = api;
  const pad = R * 0.5, gap = R * 0.75, h = R * 1.75, total = chipsWidth(api, d.nodes, R);
  let x = align === 'c' ? box.x + (box.w - total) / 2 : box.x;
  const chips = d.nodes.map((nd) => {
    const w = T.measure(ctx, theme, 'ui', nd.label, R).w + 2 * pad, b = { x, y: box.y, w, h };
    x += w + gap;
    return { b, label: nd.label, tx: b.x + pad, ty: b.y + h / 2 + R * 0.36 };
  });
  return { chips, R, h, gap, focus: d.focus ?? d.nodes.length - 1,
    ink: { off: inkOn(api, 'fg', 'surface', R), on: inkOn(api, 'bg', 'accent', R) } };
}

/** Chips pop at at(j) (local beats); the focus chip lights at litAt. */
export function drawChips(f, api, pl, at, litAt) {
  const { ctx, D, M, T, theme } = api;
  pl.chips.forEach((c, j) => {
    const open = M.clamp(M.sp(f.since(at(j)), 'snap'), 0, 1.03);
    if (open < 0.3) return;
    const lit = j === pl.focus ? M.clamp(M.sp(f.since(litAt), 'snap')) : 0;
    const [cx, cy] = [c.b.x + c.b.w / 2, c.b.y + c.b.h / 2];
    if (j > 0) {   // chevron from the previous chip
      const x = c.b.x - pl.gap / 2, s = pl.R * 0.22;
      D.line(ctx, [[x - s * 0.6, cy - s], [x + s * 0.4, cy], [x - s * 0.6, cy + s]], { color: 'muted', width: 3 * f.F.u });
    }
    ctx.save(); ctx.translate(cx, cy); ctx.scale(open, open); ctx.translate(-cx, -cy);
    D.fillBox(ctx, c.b, lit > 0 ? theme.mix('surface', 'accent', lit) : 'surface', c.b.h / 2);
    const label = () => T.drawText(ctx, theme, c.label, c.tx, c.ty, { role: 'ui', size: pl.R, color: lit > 0.5 ? pl.ink.on : pl.ink.off, weight: lit > 0.5 ? 700 : undefined });
    if (open < 0.95) T.quiet(label); else label();   // a popping chip is not its resting size: log it once it lands
    ctx.restore();
  });
}
