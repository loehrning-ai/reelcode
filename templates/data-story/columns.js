// columns.js: the generic bar shot (used when bar labels are not hour ranges) and the counter shot. Each lays out a
// claim on top and its chart below; they take (api, point, fmt, path) like the other shots.
import { TYPE, UI, numOpts, bigNumber, countTicks, claimBlock } from './lib.js';
import { need, hiIndex } from './charts.js';

/** Claim across the top, the chart box below it. */
export function topClaim(api, pt) {
  const { F, T } = api, S = F.safe;
  const claim = claimBlock(api, pt, { x: S.x, y: S.y, w: S.w * F.pick({ v: 1, s: 1, h: 0.7 }), h: S.h * 0.24 }, { scale: F.pick({ v: 2.3, s: 2.2, h: 2.4 }), valign: 't' });
  const y = claim.box.y + claim.box.h + T.readable(F, 1.2);
  return { claim, box: { x: S.x, y, w: S.w, h: S.y + S.h - y } };
}

export function columns(api, pt, fmt, path) {
  const { claim, box } = topClaim(api, pt);
  const body = columnsIn(api, pt, box, fmt, path);
  return { ...body, draw(f) { claim.draw(f); body.draw(f); } };
}

export function counter(api, pt, fmt, path) {
  const { claim, box } = topClaim(api, pt);
  const body = counterIn(api, pt, box, fmt, path);
  return { ...body, draw(f) { claim.draw(f); body.draw(f); } };
}

/**
 * Growing bars; the highlight turns accent while the rest step back to muted. Columns when every label
 * fits its band at a readable size, otherwise rows (always rows in 9:16). Timing is the same either way.
 */
function columnsIn(api, pt, box, fmt, path) {
  const { F, ctx, theme, T, M, D, C } = api;
  const data = pt.data || [];
  need(data.length >= 2 && data.length <= 8 && data.every((d) => d.label !== undefined && typeof d.value === 'number'), path, 'bars needs data:[{label, value}] (2-8 items)');
  const o = numOpts(pt), n = data.length, hi = hiIndex(data.map((d) => d.label), pt.highlight);
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const tall = F.orient === 'v';
  const labSize = T.readable(F, tall ? 1.15 : 1.0), r1 = T.readable(F);
  const band = C.scaleBand(data.map((d) => d.label), [box.x, box.x + box.w], 0.28);
  const wordW = Math.max(...data.flatMap((d) => String(d.label).split(/\s+/).map((w) => T.measure(ctx, theme, 'ui', w, r1).w)));
  const rows = F.orient === 'v' || wordW > band.step * 0.96;
  const valW = (size) => Math.max(...data.map((d) => T.measure(ctx, theme, 'ui', fmt(d.value, o), size, 700).w));
  const at0 = 1, stg = n > 5 ? 0.25 : 0.5, done = at0 + stg * (n - 1), hiAt = Math.ceil(done + 1);
  const beats = Math.max(6, Math.ceil(hiAt + 3));
  const events = [at0, ...(n > 3 ? [done] : []), ...(hi !== undefined ? [hiAt] : [])];
  const sfx = [...data.map((_, i) => ({ at: at0 + i * stg, sfx: 'tick', gain_db: -13 })), ...(hi !== undefined ? [{ at: hiAt, sfx: 'thump', gain_db: -5 }] : [])];
  let geo;
  if (rows) {
    const valSize = T.readable(F, tall ? 1.3 : 1.15);
    const labW = Math.min(box.w * 0.36, Math.max(...data.map((d) => T.measure(ctx, theme, 'ui', String(d.label), labSize).w)) + labSize);
    const plotX = box.x + labW, plotW = box.w - labW - valW(valSize) - labSize * 0.6;
    const rowH = Math.min(box.h / n, labSize * (tall ? 4.4 : 4.0)), barH = Math.min(rowH * 0.62, labSize * (tall ? 2.6 : 2.2));
    const y0 = box.y + (box.h - rowH * n) * 0.35;
    const labs = data.map((d, i) => T.fitText(ctx, theme, String(d.label), { role: 'ui', lines: 1, max: labSize, min: r1,
      box: { x: box.x, y: y0 + i * rowH + rowH / 2 - labSize * 0.72, w: labW - labSize * 0.6, h: labSize * 1.4 }, valign: 'c' }));
    geo = { axis: [[plotX, y0], [plotX, y0 + rowH * n]], labs, valSize,
      bar: (i, p) => ({ x: plotX, y: y0 + i * rowH + (rowH - barH) / 2, w: plotW * (data[i].value / max) * p, h: barH }),
      track: (i) => ({ x: plotX, y: y0 + i * rowH + (rowH - barH) / 2, w: plotW, h: barH }),
      val: (r) => [r.x + r.w + labSize * 0.5, r.y + r.h / 2 + valSize * 0.36, 'l'] };
  } else {
    const valSize = Math.max(r1, Math.min(T.readable(F, 1.4), band.step * 0.94 / valW(100) * 100));
    const labH = labSize * 2.5;
    const plot = { x: box.x, y: box.y + valSize * 1.8, w: box.w, h: box.h - valSize * 1.8 - labH - labSize * 0.7 };
    const base = plot.y + plot.h;
    const labs = data.map((d, i) => T.fitText(ctx, theme, String(d.label), { role: 'ui', lines: 'auto', leading: 1.15, align: 'c', max: labSize, min: r1,
      box: { x: band.pos(i) + band.bw / 2 - band.step * 0.48, y: base + labSize * 0.7, w: band.step * 0.96, h: labH } }));
    geo = { axis: [[box.x, base], [box.x + box.w, base]], labs, valSize,
      bar: (i, p) => { const h = plot.h * (data[i].value / max) * p; return { x: band.pos(i), y: base - h, w: band.bw, h }; },
      track: (i) => ({ x: band.pos(i), y: plot.y, w: band.bw, h: plot.h }),
      val: (r) => [r.x + r.w / 2, r.y - valSize * 0.5, 'c'] };
  }
  return { beats, events, sfx, draw(f) {
    // Axis and labels are set on the cut; only the bars (the data) grow.
    D.line(ctx, geo.axis, { color: 'muted', width: 3 * F.u, cap: 'butt' });
    const hp = hi !== undefined ? M.clamp(M.sp(f.since(hiAt), UI)) : 0;
    // Tracks (full-scale slots) are part of the composed cut frame; the bars grow into them.
    data.forEach((_, i) => { const r = geo.track(i); D.fillBox(ctx, r, 'surface', Math.min(Math.min(r.w, r.h) * 0.2, theme.radius * 0.3)); });
    data.forEach((d, i) => {
      const lab = geo.labs[i];
      lab.lines.forEach((l) => T.drawText(ctx, theme, l.s, l.x, l.y, { role: 'ui', size: lab.size, weight: i === hi ? 700 : undefined, color: i === hi ? theme.mix('muted', 'fg', hp) : 'muted' }));
      const p = M.sp(f.since(at0 + i * stg), UI);
      if (p <= 0) return;
      const r = geo.bar(i, p);
      const col = i === hi ? theme.mix('fg', 'accent', hp) : theme.mix('fg', 'muted', hp);
      D.fillBox(ctx, r, col, Math.min(Math.min(r.w, r.h) * 0.2, theme.radius * 0.3));
      const [vx, vy, al] = geo.val(r), [rx, ry] = geo.val(geo.bar(i, 1));
      T.drawText(ctx, theme, fmt(d.value * M.clamp(p), o), vx, vy, { role: 'ui', size: geo.valSize, weight: 700, align: al, rest: [rx, ry], color: i === hi ? theme.mix('fg', 'accent', hp) : 'fg' });
    });
  } };
}

/** A single counting number inside the chart box (counter point). */
function counterIn(api, pt, box, fmt, path) {
  need(typeof pt.value === 'number', path, 'counter needs value (and optional from, label)');
  const { F, T } = api;
  const [nBox, lBox] = api.L.split(box, [0.62, 0.38], { axis: 'y', gap: 24 * F.u });
  const num = bigNumber(api, { ...numOpts(pt), value: pt.value, from: pt.from }, nBox, fmt, { at: 1, beats: 3, valign: 'b' });
  const lab = pt.label ? T.fitText(api.ctx, api.theme, pt.label, { role: 'ui', lines: 'auto', leading: 1.25, max: T.readable(F, 1.4), min: T.readable(F),
    box: { x: lBox.x, y: num.ft.box.y + num.ft.box.h + num.ft.size * 0.45, w: lBox.w, h: Math.max(T.readable(F, 1.4), lBox.y + lBox.h - num.ft.box.y - num.ft.box.h - num.ft.size * 0.45) } }) : null;
  return { beats: 7, events: [1, num.land, ...(lab ? [num.land + 1] : [])],
    sfx: [{ at: 1, sfx: 'pop', gain_db: -9 }, ...countTicks(1, num.land), { at: num.land, sfx: 'thump', gain_db: -3 }],
    draw(f) { num.draw(f); if (lab) T.kinetic(f, lab, { by: 'word', at: num.land + 1, stagger: 0.12, from: 'mask', spring: TYPE, color: 'muted' }); } };
}
