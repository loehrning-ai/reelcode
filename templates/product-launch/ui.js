// ui.js: the product-launch assemble scene (the UI builds itself from captured cards) plus the helpers the hook
// shares with it: the grid plan (so the hook's KPI card can fly into its exact cell) and the masked value slot
// (the metric's real number is hidden until the metric scene; wrong numbers scramble in its place).
import { inkOn } from './ink.js';
import { POP, TYPE, layoutCard, samplePx } from './stage.js';

/** Name over tagline; the tagline starts below the name's real descender, never through it. */
function titleBlock(api, product, box, valign) {
  const { ctx, theme, T, F } = api;
  const tagS = T.readable(F, F.pick({ v: 1.0, s: 1.1, h: 1.3 }));
  const tagProbe = product.tagline ? T.fitText(ctx, theme, product.tagline, { role: 'ui', box, lines: 'auto', leading: 1.25, max: tagS, min: T.readable(F) }) : null;
  const tagH = tagProbe ? tagProbe.box.h + tagS * 0.3 : 0;
  const gap = tagProbe ? tagS * 0.55 : 0;
  // Fit the name to the space left; reserve 0.32 of its cap height for descenders (y, p, g).
  const nameRoom = { x: box.x, y: box.y, w: box.w, h: Math.max(T.readable(F, 1.4), (box.h - tagH - gap) / 1.32) };
  const name = T.fitText(ctx, theme, product.name, { role: 'display', box: nameRoom, lines: 'auto', leading: 0.95, valign: 't',
    max: F.pick({ v: nameRoom.h, s: nameRoom.h, h: Math.min(nameRoom.h, box.w * 0.3) }) * 1.4, min: T.readable(F, 1.4) });
  const desc = T.measure(ctx, theme, 'display', 'gyp', name.size).desc;
  const blockH = name.box.h + desc + gap + tagH;
  const dy = valign === 'c' ? (box.h - blockH) / 2 : valign === 'b' ? box.h - blockH : 0;
  const nameFit = T.fitText(ctx, theme, product.name, { role: 'display', box: { ...name.box, x: box.x, y: name.box.y + dy, w: box.w, h: name.box.h + 0.5 },
    lines: 'auto', leading: 0.95, max: name.size, min: name.size, valign: 't' });
  const tagFit = tagProbe ? T.fitText(ctx, theme, product.tagline, { role: 'ui', box: { x: box.x, y: nameFit.box.y + nameFit.box.h + desc + gap, w: box.w, h: tagH + 1 },
    lines: 'auto', leading: 1.25, max: tagProbe.size, min: tagProbe.size }) : null;
  return { nameFit, tagFit };
}

/**
 * Assemble grid: the title block plus a 2x2 grid of the pieces (2 columns everywhere). 9:16 fills 0.25-0.85H
 * at the full safe width; 1:1 sits under a short title; 16:9 puts the title in a left column and gives the
 * grid ~62% of the frame width and the full safe height.
 */
export function assembleLayout(api, n) {
  const { F, L } = api;
  const gap = 28 * F.u;
  let tBox, gBox;
  if (F.orient === 'h') [tBox, gBox] = L.split(F.safe, [0.27, 0.73], { axis: 'x', gap: 56 * F.u });
  else {
    const top = F.pick({ v: 0.25, s: 0.24 }) * F.h, bot = F.pick({ v: 0.85, s: 1 }) * F.h;
    tBox = { x: F.safe.x, y: F.safe.y, w: F.safe.w, h: top - F.safe.y - gap };
    gBox = { x: F.safe.x, y: top, w: F.safe.w, h: Math.min(bot, F.safe.y + F.safe.h + (F.orient === 'v' ? 150 : 0)) - top };
  }
  const cols = Math.min(2, n), rows = Math.ceil(n / cols);
  const cw = (gBox.w - gap * (cols - 1)) / cols, ch = (gBox.h - gap * (rows - 1)) / rows;
  const cells = Array.from({ length: n }, (_, k) => ({ x: gBox.x + (k % cols) * (cw + gap), y: gBox.y + Math.floor(k / cols) * (ch + gap), w: cw, h: ch }));
  return { tBox, gBox, cells };
}

/** One captured card in its grid cell: sampled frame, then the real head/tail crops. */
export function drawCard(api, img, lay) {
  const { ctx, theme, D, F } = api;
  const r = theme.radius * 0.6;
  if (lay.bg) D.fillBox(ctx, lay.frame, lay.bg, r);
  for (const { src, dst } of lay.draws) ctx.drawImage(img, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
  if (lay.border) D.strokeBox(ctx, lay.frame, lay.border, Math.max(1.5, 2 * F.u), r);
}

/** The assemble grid as planned for this format: the cards and cells the hook flies into. */
export function assemblePlan(api, a) {
  const s = api.A.screen(a.screen);
  const ids = a.pieces || [];
  const pieces = ids.map((id) => api.A.capRect(s, id));
  const { tBox, cells } = assembleLayout(api, pieces.length);
  return { s, ids, pieces, tBox, cells, cards: pieces.map((q, k) => layoutCard(s.img, q, cells[k])) };
}

const VAL0 = [0.04, 0.3, 0.44, 0.37];
/** The metric card's value slot (screenshot px) and its sampled fill. */
export function valueSlot(s, card, val = VAL0) {
  return { r: { x: card.x + val[0] * card.w, y: card.y + val[1] * card.h, w: val[2] * card.w, h: val[3] * card.h },
    fill: samplePx(s.img, card.x + card.w * 0.5, card.y + card.h * 0.5) };
}

/**
 * Cover the value slot wherever it shows in the card's draws ({src, dst} crops) and scramble a wrong number
 * in it (one per half beat), so the real value is revealed once, in the metric scene.
 */
export function drawScramble(api, f, draws, slot, decoys, rate = 2, fixed = null) {
  const { ctx, theme, T, D } = api;
  for (const { src, dst } of draws) {
    const x0 = Math.max(src.x, slot.r.x), y0 = Math.max(src.y, slot.r.y);
    const x1 = Math.min(src.x + src.w, slot.r.x + slot.r.w), y1 = Math.min(src.y + src.h, slot.r.y + slot.r.h);
    if (x1 <= x0 || y1 <= y0) continue;
    const k = dst.w / src.w;
    const b = { x: dst.x + (x0 - src.x) * k, y: dst.y + (y0 - src.y) * k, w: (x1 - x0) * k, h: (y1 - y0) * k };
    if (slot.fill) D.fillBox(ctx, b, slot.fill);
    const lead = 0.15;   // beats: each value lands just before its grid line, so the beat frame shows it settled
    const n = Math.floor(Math.max(0, f.lb + lead) * rate + 1e-6), txt = fixed ?? decoys[n % decoys.length];
    const size = b.h * 0.62;
    const roll = fixed !== null ? 0 : 1 - api.M.clamp(api.M.sp((f.lb + lead - n / rate) * f.spb, 'snap'));   // each new value rolls up into place
    D.withClip(ctx, (g) => g.rect(b.x, b.y, b.w, b.h), () =>
      T.drawText(ctx, theme, txt, b.x + b.h * 0.08, b.y + b.h * 0.78 + roll * b.h * 0.5, { role: 'display', size, color: 'fg', log: false }));
  }
}

/**
 * Scene 2 (4 beats): name and tagline land while the grid builds fast. The metric card is already in its cell
 * (the hook flew it there: a match cut), the other cards land one per half beat from alternating directions,
 * then `zoom` lifts with an accent ring. The metric card's value keeps scrambling (wrong numbers).
 */
export function assembleScene(api, a, product, beats, { held = null, slot = null, decoys = [] } = {}) {
  const { F, ctx, theme, T, L, M, D } = api;
  const { s, ids, pieces, tBox, cells, cards } = assemblePlan(api, a);
  const { nameFit, tagFit } = titleBlock(api, product, tBox, F.pick({ v: 'b', s: 'b', h: 'c' }));
  const hk = held ? ids.indexOf(held) : -1;
  const zi = a.zoom ? ids.indexOf(a.zoom) : -1;
  const order = pieces.map((_, k) => k).filter((k) => k !== hk);
  const landAt = (k) => (k === hk ? -1 : 0.25 + 0.5 * order.indexOf(k));   // the first is already in flight on frame 0
  const DIRS = [[-1, 0], [1, 0], [0, 1], [0, -1]];
  const lastLand = Math.max(0, ...order.map(landAt));
  const zoomAt = zi >= 0 ? Math.min(beats - 1, lastLand + 1) : null;
  const events = [0, ...(tagFit ? [0.25] : []), ...order.map(landAt), ...(zoomAt !== null ? [zoomAt] : [])].filter((b, k, arr) => b >= 0 && b < beats && arr.indexOf(b) === k);
  const sfx = [...order.map((k) => ({ at: landAt(k), sfx: 'pop', gain_db: -10 })), ...(zoomAt !== null ? [{ at: zoomAt, sfx: 'swish', gain_db: -9 }] : [])]
    .filter((m) => m.at >= 0 && m.at < beats);
  const slotCol = theme.mix('bg', 'surface', 0.7);
  return { id: 'assemble', beats, events, sfx, transition: { type: 'cut' }, draw(f) {
    const z = zoomAt !== null ? M.clamp(M.sp(f.since(zoomAt), 'soft')) : 0;
    cells.forEach((d, k) => {
      const [cx, cy] = L.center(d);
      const lift = k === zi ? z : 0;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(1 + 0.04 * lift, 1 + 0.04 * lift); ctx.translate(-cx, -cy);
      if (f.lb < landAt(k) + 0.25) D.fillBox(ctx, d, slotCol, theme.radius * 0.6);
      // In flight: arrives from its own side with an overshoot (the held card is already home).
      const p = k === hk ? 1 : M.sp(f.since(landAt(k) - 0.5), POP);
      if (p > 0) {
        const [dx, dy] = DIRS[order.indexOf(k) % DIRS.length] || [0, 1];
        const k2 = 0.8 + 0.2 * p;
        ctx.save();
        ctx.translate(cx + (1 - p) * dx * F.w * 0.6, cy + (1 - p) * dy * F.h * 0.35); ctx.scale(k2, k2); ctx.translate(-cx, -cy);
        D.withClip(ctx, (c) => D.rrect(c, d, theme.radius * 0.6), () => {
          drawCard(api, s.img, cards[k]);
          if (k === hk && slot) drawScramble(api, f, cards[k].draws, slot, decoys);
        });
        ctx.restore();
      }
      if (lift > 0.02) D.strokeBox(ctx, L.inset(d, -8 * F.u), 'accent', 5 * F.u * lift, theme.radius * 0.7);
      ctx.restore();
    });
    T.kinetic(f, nameFit, { by: 'word', at: -0.35, stagger: 0.2, from: 'mask', spring: TYPE });
    if (tagFit) T.kinetic(f, tagFit, { by: 'line', at: 0.25, stagger: 0.25, from: 'mask', spring: TYPE, color: inkOn(api, 'muted', 'bg', tagFit.size) });
  } };
}
