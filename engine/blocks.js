// blocks.js: shared scene factories. Each returns a Scene {id, beats, draw, events, sfx, transition}.
// Blocks fill their own events and sfx (so cues are derived), and lay out per format via F.pick/split.
// sfx timing depends only on content (never on wrapping), so cues stay identical across formats.
import { sp, seq, clamp, easeOutQuart, drop, quant } from './motion.js';
import { inset, split, place, aspectFit, center } from './layout.js';
import { fitText, kinetic, kineticUnits, drawText, counterText, readable, measure, logRest } from './text.js';
import { fillBox, strokeBox, rrect, line, withClip } from './draw.js';
import { bars, line as lineChart, donut } from './chart.js';
import { cursorAt, drawCursor, clicks } from './cursor.js';
import { screen as getScreen, capRect } from './assets.js';

const fit = (api, str, box, o = {}) => fitText(api.ctx, api.theme, str, { role: 'display', box, max: box.h, min: readable(api.F, 1.1), ...o });
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const scene = (o) => ({ transition: undefined, ...o });
/** Beats used for planning: a 'fill' scene is planned as 8 beats; compile() drops anything past its real end. */
const plan = (beats) => (beats === 'fill' ? 8 : beats);
// Every block takes {spring} for its type entrances (default 'med'; pass 'stiff' or [response, 1] for no overshoot)
// and rounds content-derived marker times to the 1/16 grid (quant), so cues.py never rejects them.
const typeSpring = (o) => o.spring || 'med';

/**
 * Justified type: every line sized to the full box width, then all lines scaled down together (one factor, so they
 * stay equally wide) until the stack fits the box height; centred vertically. maxCapK caps the cap height of a
 * ONE-line block (a lone short word would otherwise fill the frame); it no longer clips short lines of a stack,
 * which left them narrower than the box (ragged "justified" type). -> fit[]
 */
export function justifyFits(api, lines, box, { align = 'l', gapK = 0.2, maxCapK = 0.42 } = {}) {
  const { ctx, theme, F } = api;
  const cap100 = measure(ctx, theme, 'display', 'H', 100).cap / 100;
  const capMax = lines.length === 1 ? (box.h * maxCapK) / cap100 : Infinity;
  let sizes = lines.map((l) => Math.min(box.w / measure(ctx, theme, 'display', l, 100).w * 100, capMax));
  const height = (ss) => ss.reduce((a, x) => a + x * cap100, 0) + (ss.length - 1) * gapK * Math.min(...ss) * cap100;
  const k = Math.min(1, box.h / height(sizes));
  sizes = sizes.map((x) => x * k);
  let y = box.y + (box.h - height(sizes)) / 2;
  return lines.map((l, i) => {
    const h = sizes[i] * cap100;
    const ft = fitText(ctx, theme, l, { role: 'display', box: { x: box.x, y, w: box.w + 0.5, h: h * 1.01 }, lines: 1, max: sizes[i], min: Math.min(sizes[i], readable(F, 1.4)), align });
    y += h + gapK * Math.min(...sizes) * cap100;
    return ft;
  });
}

/**
 * Big type entering word by word (or line/char); an accent word lands one beat after the last unit.
 * fit:'justify' (default) sizes every line to the full width; fit:'block' uses one size for all lines.
 */
export function kineticBlock(api, o) {
  const { F, ctx, theme } = api;
  const { id, lines, beats, by = 'word', from = 'mask', accentWord, transition, align = 'l' } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const stagger = o.stagger ?? (by === 'line' ? 1 : by === 'char' ? 0.125 : 0.5);
  const box = o.box || inset(F.safe, { t: F.safe.h * 0.04, b: F.safe.h * 0.04, l: 0, r: F.safe.w * 0.02 });
  const fits = (o.fit || 'justify') === 'justify' ? justifyFits(api, lines, box, { align })
    : [fit(api, lines.join('\n'), box, { lines: 1, leading: 0.94, align, valign: 'c', min: readable(F, 1.4) })];
  const groups = [];
  let offset = 0;
  for (const ft of fits) { const n = kineticUnits(ctx, theme, ft, by); groups.push({ ft, offset, units: n }); offset += n.length; }
  // Content-derived timing (same in every format): unit index * stagger is fixed by the content lines.
  const units = groups.flatMap((g) => g.units.map((u) => ({ ...u, li: fits.length > 1 ? groups.indexOf(g) : u.li })));
  const lineStart = lines.map((_, li) => units.findIndex((u) => u.li === li)).filter((i) => i >= 0);
  const accentIdx = accentWord ? units.map((u, i) => (norm(u.s) === norm(accentWord) ? i : -1)).filter((i) => i >= 0) : [];
  const accentAt = quant(Math.min(nb - 0.5, (units.length - 1) * stagger + 1));
  // justify: each line is its own group, so its start is snapped to the grid and the pop lands with it.
  const groupAt = (g) => (fits.length > 1 ? quant(g.offset * stagger) : 0);
  const starts = fits.length > 1 ? groups.map(groupAt) : lineStart.map((i) => quant(i * stagger));
  const events = [...starts, ...(accentIdx.length ? [accentAt] : [])].filter((b) => b < nb);
  const sfx = [...starts.map((at) => ({ at, sfx: 'pop', gain_db: -8 })), ...(accentIdx.length ? [{ at: accentAt, sfx: 'thump', gain_db: -4 }] : [])]
    .filter((m) => m.at < nb);
  const all = { x: Math.min(...fits.map((f) => f.box.x)), y: fits[0].box.y, w: Math.max(...fits.map((f) => f.box.x + f.box.w)) - Math.min(...fits.map((f) => f.box.x)), h: fits[fits.length - 1].box.y + fits[fits.length - 1].box.h - fits[0].box.y };
  return scene({ id, beats, transition, events, sfx, draw(f) {
    const punch = accentIdx.length ? f.hit(accentAt, 0.12) * 0.03 : 0;
    const [cx, cy] = center(all);
    ctx.translate(cx, cy); ctx.scale(1 + punch, 1 + punch); ctx.translate(-cx, -cy);
    const lit = f.lb >= accentAt ? accentIdx : [];
    for (const g of groups) kinetic(f, g.ft, { by, at: groupAt(g), stagger, from, spring, accent: lit.map((i) => i - g.offset).filter((i) => i >= 0 && i < g.units.length) });
  } });
}

/** One statement: 'bleed' crops huge type with the frame edge; 'stack' fits it inside safe. */
export function statementBlock(api, o) {
  const { F, ctx, theme } = api;
  const { id, text, sub, beats, layout = 'bleed', transition } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const [main, low] = split(F.safe, sub ? [0.72, 0.28] : [1, 0.0001], { axis: 'y', gap: 24 * F.u });
  const subFit = sub ? fit(api, sub, low, { role: 'ui', lines: 'auto', max: readable(F, 1.25), min: readable(F), leading: 1.3 }) : null;
  const events = [0, ...(sub ? [1] : []), ...(nb >= 4 ? [Math.floor(nb / 2)] : [])];
  const sfx = [{ at: 0, sfx: 'thump', gain_db: -4 }, ...(nb >= 4 ? [{ at: Math.floor(nb / 2), sfx: 'swish', gain_db: -10 }] : [])];
  if (layout === 'stack') {
    const ft = fit(api, text, main, { lines: 'auto', leading: 0.95, valign: 'b' });
    return scene({ id, beats, transition, events, sfx, draw(f) {
      kinetic(f, ft, { by: 'line', at: 0, stagger: 0.5, from: 'mask', spring });
      if (subFit) kinetic(f, subFit, { by: 'line', at: 1, stagger: 0.25, from: 'mask', color: 'muted', spring });
    } });
  }
  const size = Math.min(F.h * 0.42, (F.w * 1.22) / measure(ctx, theme, 'display', text, 100).w * 100);
  const m = measure(ctx, theme, 'display', text, size);
  const baseY = main.y + main.h * 0.5 + m.cap / 2;
  const mid = Math.floor(nb / 2);
  return scene({ id, beats, transition, events, sfx, draw(f) {
    const d = drop(f.since(0), o.spring || 'soft');
    const x = F.cx + seq(f.lt, [[0, 0.06 * F.w], [mid * f.spb, -0.05 * F.w, 'stiff']], 'stiff');
    ctx.save(); ctx.translate(x, baseY); ctx.scale(1 + d.sq * 0.5, 1 - d.sq * 0.8);
    drawText(ctx, theme, text, 0, -(1 - d.p) * F.h * 0.6, { role: 'display', size, align: 'c', bleed: true });
    ctx.restore();
    if (subFit) kinetic(f, subFit, { by: 'line', at: 1, stagger: 0.25, from: 'mask', color: 'muted', spring });
  } });
}

/**
 * Product UI from a captured screen: pieces assemble on the beats, then a punch-in to a rect, with a cursor.
 * slots (default true): the screen shows from the first beat with an empty slot where each piece will land.
 * from: 'fly' (default; pieces rise from below inside the panel) | 'mask' (each piece rises inside its own slot).
 * swaps: [{at, screen}] change to another captured screen (e.g. on a click) with a short wipe up.
 */
export function uiShotBlock(api, o) {
  const { F, ctx, theme } = api;
  const { id, beats, assemble = [], zoom, cursor, label, transition, slots = true, from = 'fly', swaps = [] } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const s = getScreen(o.screen);
  const [labBox, uiBox] = label ? split(F.safe, F.pick({ v: [0.2, 0.8], s: [0.2, 0.8], h: [0.32, 0.68] }), { axis: 'long', gap: 48 * F.u }) : [null, F.safe];
  const sAsp = s.w / s.h, fAsp = Math.max(uiBox.w / uiBox.h, F.pick({ v: 0.95, s: 1.3, h: sAsp }));
  const fb = aspectFit(uiBox, Math.min(sAsp, fAsp));
  const zr = zoom ? capRect(s, zoom) : null;
  const focus = zr ? [(zr.x + zr.w / 2) / s.w, (zr.y + zr.h / 2) / s.h] : [0.5, 0.5];
  const vw = Math.min(s.w, s.h * (fb.w / fb.h)), vh = vw / (fb.w / fb.h);
  const v0 = { x: clamp(focus[0] * s.w - vw / 2, 0, s.w - vw), y: clamp(focus[1] * s.h - vh / 2, 0, s.h - vh), w: vw, h: vh };
  let v1 = v0;
  if (zr) {
    const w1 = Math.min(vw, Math.max(zr.w * 1.5, (zr.h * 1.5) * (fb.w / fb.h))), h1 = w1 / (fb.w / fb.h);
    v1 = { x: clamp(zr.x + zr.w / 2 - w1 / 2, 0, s.w - w1), y: clamp(zr.y + zr.h / 2 - h1 / 2, 0, s.h - h1), w: w1, h: h1 };
  }
  const pieces = assemble.map((c) => ({ c, r: capRect(s, c) }));
  const doneAt = pieces.length ? pieces.length * 0.5 + 0.5 : 0;
  const zoomAt = zr ? Math.max(doneAt + 1, Math.round(nb / 2)) : null;
  const sw = swaps.map((x) => ({ at: quant(api.G.parseAt(x.at, api.grid)), s: getScreen(x.screen) })).sort((p, q) => p.at - q.at);
  const labFit = label ? fit(api, label, labBox, { lines: 'auto', leading: 0.95, max: F.pick({ v: labBox.h, s: labBox.h, h: labBox.h * 0.3 }), valign: F.pick({ v: 'b', s: 'b', h: 'c' }) }) : null;
  const clickBeats = (cursor || []).filter((p) => p.click || p.drag !== undefined).map((p) => api.G.parseAt(p.at, api.grid));
  const events = [0, ...(pieces.length ? [doneAt] : []), ...(zoomAt !== null ? [zoomAt] : []), ...clickBeats, ...sw.map((x) => x.at)].filter((b) => b < nb);
  const sfx = [...pieces.map((_, i) => ({ at: i * 0.5, sfx: 'pop', gain_db: -10 })),
    ...(zoomAt !== null ? [{ at: zoomAt, sfx: 'swish', gain_db: -8 }] : []), ...clicks(cursor),
    ...sw.map((x) => ({ at: x.at, sfx: 'swish', gain_db: -10 }))].filter((m) => m.at < nb);
  // A screen of another size keeps the same relative viewport.
  const viewOf = (scr, v) => (scr === s ? v : { x: v.x * scr.w / s.w, y: v.y * scr.h / s.h, w: v.w * scr.w / s.w, h: v.h * scr.h / s.h });
  return scene({ id, beats, transition, events, sfx, draw(f) {
    const z = zoomAt !== null ? clamp(sp(f.since(zoomAt), 'stiff'), 0, 1.04) : 0;
    const v = { x: v0.x + (v1.x - v0.x) * z, y: v0.y + (v1.y - v0.y) * z, w: v0.w + (v1.w - v0.w) * z, h: v0.h + (v1.h - v0.h) * z };
    const k = fb.w / v.w;
    const map = (r) => ({ x: fb.x + (r.x - v.x) * k, y: fb.y + (r.y - v.y) * k, w: r.w * k, h: r.h * k });
    const rise = sp(f.since(0), 'stiff');
    const panel = { ...fb, y: fb.y + (1 - rise) * F.h * 0.2 };
    const shot = (scr) => { const vv = viewOf(scr, v); ctx.drawImage(scr.img, vv.x, vv.y, vv.w, vv.h, fb.x, fb.y, fb.w, fb.h); };
    fillBox(ctx, panel, 'surface', theme.radius);
    withClip(ctx, (c) => { rrect(c, panel, theme.radius); }, () => {
      ctx.translate(0, panel.y - fb.y);
      const assembling = f.lb < doneAt;
      if (!assembling || slots) {
        shot(s);
        if (assembling) for (const { r } of pieces) fillBox(ctx, inset(map(r), 2 * F.u), 'surface', Math.min(theme.radius * 0.4, map(r).h / 2));
      }
      pieces.forEach(({ r }, i) => {
        const p = sp(f.since(i * 0.5), spring);
        if (p <= 0 || f.lb >= doneAt + 1) return;
        const m = map(r);
        if (from === 'mask') withClip(ctx, (c) => c.rect(m.x, m.y, m.w, m.h), () => ctx.drawImage(s.img, r.x, r.y, r.w, r.h, m.x, m.y + (1 - p) * m.h, m.w, m.h));
        else ctx.drawImage(s.img, r.x, r.y, r.w, r.h, m.x, m.y + (1 - p) * F.h * 0.12, m.w, m.h);
      });
      for (const x of sw) {
        const p = clamp(sp(f.since(x.at), 'stiff'));
        if (p <= 0) continue;
        withClip(ctx, (c) => c.rect(fb.x, fb.y + fb.h * (1 - p), fb.w, fb.h * p), () => shot(x.s));
      }
      if (zr && z > 0.5) strokeBox(ctx, inset(map(zr), -6 * F.u), 'accent', 5 * F.u, theme.radius * 0.4);
    });
    if (labFit) kinetic(f, labFit, { by: 'word', at: 0.5, stagger: 0.25, from: 'mask', spring });
    if (cursor && cursor.length) {
      const rectOf = (to) => {
        const scr = [s, ...sw.map((x) => x.s)].find((q) => q.rects && q.rects[to]) || s, r = capRect(scr, to);
        return map(scr === s ? r : { x: r.x * s.w / scr.w, y: r.y * s.h / scr.h, w: r.w * s.w / scr.w, h: r.h * s.h / scr.h });
      };
      const resolve = (to) => Array.isArray(to) ? [fb.x + to[0] * fb.w, fb.y + to[1] * fb.h] : center(rectOf(to));
      drawCursor(ctx, theme, cursorAt(cursor, f, resolve), F.u * 1.1);
    }
  } });
}

function counterDraw(api, { value, from = 0, fmt = 'int', decimals = 0, unit = '', prefix = '', locale, currency, spring = 'med' }, box, countAt, countBeats) {
  const { F, ctx, theme } = api;
  const nf = { from, fmt, decimals, suffix: unit, prefix, ...(locale ? { locale } : {}), ...(currency ? { currency } : {}) };
  const final = counterText(value, 1, nf);
  // Fit 6% narrow so the landing punch (scale about the centre) stays inside the box.
  const ft = fit(api, final, inset(box, { l: box.w * 0.03, r: box.w * 0.03 }), { lines: 1, valign: 'b', min: readable(F, 2) });
  const draw = (f) => {
    const p = easeOutQuart(f.since(countAt) / (countBeats * f.spb));
    const landed = f.since(countAt + countBeats);
    const txt = counterText(value, p, nf);
    const rise = sp(f.since(0), spring), punch = landed > 0 ? f.hit(countAt + countBeats, 0.1) * 0.05 : 0;
    const { x, y } = ft.lines[0];
    withClip(ctx, (c) => c.rect(F.full.x, ft.box.y - ft.size * 0.3, F.full.w, ft.box.h + ft.size * 0.62), () => {
      const cx = x + ft.lines[0].w / 2;
      ctx.translate(cx, y + (1 - rise) * ft.size); ctx.scale(1 + punch, 1 + punch);
      drawText(ctx, theme, txt, x - cx, 0, { role: 'display', size: ft.size, color: landed > 0 ? 'accent' : 'fg', log: false });
    });
    // Log the resting slot (the number rises into it from below the clip; lint checks where it lands).
    logRest(ctx, theme, txt, x, y, { role: 'display', size: ft.size });
    if (landed > 0) line(ctx, [[x, y + ft.size * 0.24], [x + ft.lines[0].w, y + ft.size * 0.24]], { color: 'accent', width: 10 * F.u, progress: sp(landed, 'stiff'), cap: 'butt' });
    return ft;
  };
  return { draw, ft, below: ft.box.y + ft.box.h + ft.size * 0.36 };
}

const tickSfx = (from, to) => {
  const out = [];
  for (let b = from + 0.25; b < to - 1e-9; b += 0.25) out.push({ at: +b.toFixed(4), sfx: 'tick', gain_db: -16, tier: Math.abs((b * 2) % 1) < 1e-9 ? undefined : 'busy' });
  return out;
};

/**
 * A number that counts up on the beat, lands with a thump, and gets underlined; label reveals beneath.
 * The number + label group is centred in the safe area (valign:'c', default) or kept at the top ('t').
 */
export function metricBlock(api, o) {
  const { F } = api;
  const { id, label, beats, transition, valign = 'c' } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const countAt = 0.25, countBeats = Math.min(2, nb - 1.5);
  const layoutAt = (dy) => {
    const area = { ...F.safe, y: F.safe.y + dy };
    const [numBox, labBox] = split(area, F.pick({ v: [0.56, 0.44], s: [0.6, 0.4], h: [0.62, 0.38] }), { axis: 'y', gap: 36 * F.u });
    const num = counterDraw(api, { ...o, spring }, numBox, countAt, countBeats);
    const lab = { x: labBox.x, y: num.below, w: labBox.w, h: Math.max(readable(F, 1.2), labBox.y + labBox.h - num.below) };
    const labFit = label ? fit(api, label, lab, { role: 'ui', lines: 'auto', max: readable(F, 1.5), min: readable(F), leading: 1.25 }) : null;
    return { num, labFit };
  };
  let L0 = layoutAt(0);
  if (valign === 'c') {
    const top = L0.num.ft.box.y, bot = L0.labFit ? L0.labFit.box.y + L0.labFit.box.h : L0.num.ft.box.y + L0.num.ft.box.h;
    const dy = F.safe.y + (F.safe.h - (bot - top)) / 2 - top;
    if (dy > 1) L0 = layoutAt(Math.min(dy, F.safe.y + F.safe.h - bot));
  }
  const { num, labFit } = L0;
  const end = countAt + countBeats;
  const events = [0, 1, end].filter((b) => b < nb);
  const sfx = [{ at: 0, sfx: 'pop', gain_db: -8 }, ...tickSfx(countAt, end), { at: end, sfx: 'thump', gain_db: -3 }];
  return scene({ id, beats, transition, events, sfx, draw(f) {
    num.draw(f);
    if (labFit) kinetic(f, labFit, { by: 'word', at: 1, stagger: 0.25, from: 'mask', color: 'muted', spring });
  } });
}

const toSeries = (data) => data.map((d, i) => (Array.isArray(d) ? d : [i, d.value]));

/** A claim plus a chart on the long axis; the highlight lands one beat after the chart finishes. */
export function chartBlock(api, o) {
  const { F } = api;
  const { id, chart, claim, beats, transition } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const nf = { ...(chart.locale ? { locale: chart.locale } : {}), ...(chart.currency ? { currency: chart.currency } : {}) };
  const [cBox, gBox] = split(F.safe, F.pick({ v: [0.3, 0.7], s: [0.3, 0.7], h: [0.38, 0.62] }), { axis: 'long', gap: 56 * F.u });
  const claimFit = fit(api, claim, cBox, { lines: 'auto', leading: 1.0, max: F.pick({ v: cBox.h, s: cBox.h, h: cBox.h * 0.45 }), valign: F.pick({ v: 'b', s: 'b', h: 'c' }) });
  const n = Array.isArray(chart.data) ? chart.data.length : 1;
  const chartAt = 1, stg = 0.5;
  const doneAt = chart.type === 'bars' ? chartAt + stg * (n - 1) + 1 : chartAt + 3;
  const hiAt = Math.min(nb - 0.5, doneAt + 0.5);
  const drawCounter = chart.type === 'counter' ? counterDraw(api, { ...chart.data, ...nf, spring, unit: chart.unit || chart.data.unit || '' }, gBox, chartAt, 2).draw : null;
  const events = [0, chartAt, ...(chart.highlight !== undefined ? [hiAt] : []), ...(chart.type === 'bars' && n > 4 ? [chartAt + stg * (n - 1)] : [])].filter((b) => b < nb);
  const sfx = [{ at: 0, sfx: 'pop', gain_db: -8 }, { at: chartAt, sfx: 'whoosh', gain_db: -10 },
    ...(chart.type === 'bars' ? Array.from({ length: n }, (_, i) => ({ at: chartAt + i * stg, sfx: 'tick', gain_db: -14 })) : []),
    ...(chart.highlight !== undefined ? [{ at: hiAt, sfx: 'thump', gain_db: -4 }] : [])].filter((m) => m.at < nb);
  return scene({ id, beats, transition, events, sfx, draw(f) {
    kinetic(f, claimFit, { by: 'word', at: 0, stagger: 0.2, from: 'mask', accent: [], spring });
    const hl = f.lb >= hiAt ? chart.highlight : undefined;
    if (chart.type === 'bars') bars(f, { data: chart.data, box: gBox, at: chartAt, stagger: stg, highlight: hl, unit: chart.unit, fmt: chart.fmt, decimals: chart.decimals, ...nf });
    else if (chart.type === 'line') lineChart(f, { series: toSeries(chart.data), box: gBox, at: chartAt, beats: 3, highlight: hl, unit: chart.unit, fmt: chart.fmt, decimals: chart.decimals, ...nf });
    else if (chart.type === 'donut') {
      const d = donut(f, { data: chart.data, box: gBox, at: chartAt, beats: 2, highlight: hl });
      if (hl !== undefined) {
        const total = chart.data.reduce((a, x) => a + x.value, 0) || 1;
        const item = typeof hl === 'number' ? chart.data[hl] : chart.data.find((x) => x.label === hl);
        if (item) {
          const ft = fit(api, counterText((item.value / total) * 100, 1, { fmt: 'pct', ...nf }), place(gBox, { w: d.r * 1.3, h: d.r * 0.7 }), { lines: 1, align: 'c', valign: 'c', min: readable(F) });
          kinetic(f, ft, { by: 'line', at: hiAt, from: 'scale', spring: 'snap', color: 'accent' });
        }
      }
    } else if (drawCounter) drawCounter(f);
    else throw new Error(`chartBlock: unknown chart type "${chart.type}"`);
  } });
}

/**
 * End card: logo (or a display wordmark) assembles on the downbeat, the CTA pill wipes in, then the URL.
 * wordmark:false (or no name) with a logo: the logo already contains the name, so it is drawn alone and large.
 */
export function logoCtaBlock(api, o) {
  const { F, ctx, theme } = api;
  const { id, name, cta, url, beats, transition } = o;
  const nb = plan(beats), spring = o.spring;
  const logo = o.logo === undefined ? api.assets.logo : o.logo ? api.assets.image(o.logo) : null;
  const showName = !!name && !(logo && o.wordmark === false);
  if (!logo && !name) throw new Error(`logoCtaBlock "${id}": needs a logo or a name`);
  const [top, bottom] = split(F.safe, F.pick({ v: [0.55, 0.45], s: [0.55, 0.45], h: [0.55, 0.45] }), { axis: 'long', gap: 48 * F.u });
  const markBox = logo ? inset(top, { l: Math.min(top.w, top.h) * 0.62 }) : top;
  const la = logo ? (logo.naturalWidth || 1) / (logo.naturalHeight || 1) : 1;
  const logoBox = !logo ? null : showName ? place(top, { w: Math.min(top.w, top.h) * 0.5, h: Math.min(top.w, top.h) * 0.5 }, F.pick({ v: 'sw', s: 'sw', h: 'w' }))
    : aspectFit(inset(top, F.pick({ v: { t: top.h * 0.2 }, s: { t: top.h * 0.1 }, h: { t: top.h * 0.2, b: top.h * 0.2 } })), la, F.pick({ v: 'sw', s: 'sw', h: 'w' }));
  const nameFit = showName ? fit(api, name, markBox, { lines: 1, valign: F.pick({ v: 'b', s: 'b', h: 'c' }) }) : null;
  const pillH = Math.min(readable(F, 2.6), bottom.h * 0.4);
  const ctaSize = Math.max(readable(F), Math.min(pillH * 0.42, (bottom.w - pillH * 0.9) / measure(ctx, theme, 'ui', cta, 100, 700).w * 100));
  const ctaW = measure(ctx, theme, 'ui', cta, ctaSize, 700).w + pillH * 0.9;
  const pill = place(bottom, { w: Math.min(bottom.w, ctaW), h: pillH }, F.pick({ v: 'nw', s: 'nw', h: 'w' }));
  const urlFit = url ? fit(api, url, { x: pill.x, y: pill.y + pill.h + pillH * 0.4, w: bottom.w, h: readable(F, 1.3) }, { role: 'ui', lines: 1, min: readable(F) }) : null;
  const events = [0, 1.5, ...(url ? [2.5] : []), ...(nb >= 6 ? [4] : [])].filter((b) => b < nb);
  const sfx = [{ at: 0, sfx: 'thump', gain_db: -3 }, { at: 1.5, sfx: 'pop', gain_db: -6 }, ...(nb >= 6 ? [{ at: 4, sfx: 'click', gain_db: -8 }] : [])].filter((m) => m.at < nb);
  return scene({ id, beats, transition, events, sfx, draw(f) {
    if (logo) {
      const p = sp(f.since(0), 'snap');
      const b = { x: logoBox.x + logoBox.w * (1 - p) / 2, y: logoBox.y + logoBox.h * (1 - p) / 2, w: logoBox.w * p, h: logoBox.h * p };
      if (p > 0) ctx.drawImage(logo, ...Object.values(aspectFit(b, (logo.naturalWidth || 1) / (logo.naturalHeight || 1))));
    }
    if (nameFit) kinetic(f, nameFit, { by: 'char', at: 0, stagger: 0.08, from: 'drop', ...(spring ? { spring } : {}) });
    const wp = sp(f.since(1.5), 'stiff');
    if (wp > 0) {
      const press = nb >= 6 ? f.hit(4, 0.1) * 0.06 : 0;
      const pb = { x: pill.x + pill.w * press / 2, y: pill.y + pill.h * press / 2, w: pill.w * clamp(wp, 0, 1.03) * (1 - press), h: pill.h * (1 - press) };
      fillBox(ctx, pb, 'accent', pill.h / 2);
      withClip(ctx, (c) => c.rect(pb.x, pb.y, pb.w, pb.h), () => drawText(ctx, theme, cta, pill.x + pillH * 0.45, pill.y + pill.h / 2 + ctaSize * 0.36, { role: 'ui', size: ctaSize, weight: 700, color: 'bg' }));
    }
    if (urlFit) kinetic(f, urlFit, { by: 'char', at: 2.5, stagger: 0.03, from: 'below', color: 'muted', ...(spring ? { spring } : {}) });
  } });
}

/** Explainer step: a numeral slams in, earlier steps sit on a rail, title and body reveal beside it. */
export function stepBlock(api, o) {
  const { F, ctx, theme } = api;
  const { id, n, total = n, title, body, beats, transition } = o;
  const nb = plan(beats), spring = typeSpring(o);
  const [numBox, txtBox] = split(F.safe, F.pick({ v: [0.36, 0.64], s: [0.34, 0.66], h: [0.36, 0.64] }), { axis: 'long', gap: 48 * F.u });
  const railH = readable(F, 1.1);
  const numFit = fit(api, String(n).padStart(2, '0'), inset(numBox, { t: railH * 2 }), { lines: 1, valign: F.pick({ v: 'b', s: 'b', h: 'c' }) });
  const [tBox, bBox] = split(txtBox, [0.45, 0.55], { axis: 'y', gap: 24 * F.u });
  const titleFit = fit(api, title, tBox, { lines: 'auto', leading: 0.98, valign: 'b' });
  // The body starts below the title's descenders, not at a fixed gap.
  const bTop = titleFit.box.y + titleFit.box.h + titleFit.size * 0.34;
  const bodyBox = { x: bBox.x, y: bTop, w: bBox.w, h: Math.max(readable(F, 1.4), bBox.y + bBox.h - bTop) };
  const bodyFit = body ? fit(api, body, bodyBox, { role: 'ui', lines: 'auto', max: readable(F, 1.3), min: readable(F), leading: 1.3 }) : null;
  const events = [0, 0.5, ...(body ? [1.5] : [])].filter((b) => b < nb);
  const sfx = [{ at: 0, sfx: 'thump', gain_db: -4 }, ...(body ? [{ at: 1.5, sfx: 'pop', gain_db: -10 }] : [])];
  return scene({ id, beats, transition, events, sfx, draw(f) {
    for (let i = 1; i <= total; i++) {
      const x = numBox.x + (i - 1) * railH * 2.2, p = sp(f.since(0) - i * 0.03, 'stiff');
      drawText(ctx, theme, String(i).padStart(2, '0'), x, numBox.y + railH + (1 - p) * railH, { role: 'ui', size: railH, color: i === n ? 'accent' : i < n ? 'fg' : 'muted', weight: i === n ? 700 : undefined, rest: [x, numBox.y + railH] });
    }
    kinetic(f, numFit, { by: 'line', at: 0, from: 'drop', color: 'accent', ...(o.spring ? { spring } : {}) });
    kinetic(f, titleFit, { by: 'word', at: 0.5, stagger: 0.2, from: 'mask', spring });
    if (bodyFit) kinetic(f, bodyFit, { by: 'line', at: 1.5, stagger: 0.25, from: 'mask', color: 'muted', spring });
  } });
}

