// data-story: an animated data story built entirely from content (docs/TEMPLATES.md).
// hero growth spine (start number -> end number) -> one shot per point -> kinetic end lockup.
// The shots do not share a header template: each point sets its own claim and frame. Every cut after the hero is a
// data hand-off with identity: the outgoing shot's last data mark (a shape: bar, dot or wedge) is drawn by the
// INCOMING shot as its own first mark, morphing from where it was into where it belongs (a dot stretches into a track,
// tracks bend into clock wedges, a wedge flattens into the lockup underline). No overlay slab, and the incoming
// shot's headline lands one beat in, after the mark has settled, so the moving mark never crosses text.
import { TYPE, smooth, numOpts, checkLocale, makeFmt, accentUnits, pill, pillBox, drawShape, morphShape } from './lib.js';
import { race, lineChart } from './charts.js';
import { compare, bars } from './shots.js';
import { counter } from './columns.js';
import { endScene } from './end.js';

const BUILDERS = { bars, race, line: lineChart, compare, counter };
const MORPH = 0.4; // seconds the hand-off morph takes

/**
 * Opening: the growth spine. An accent bar (the spine) runs from the frame edge; its head carries the numbers.
 * Shot A (beats 0-2): the spine is already growing on frame 0 and stops at from/value of its length, where "1.6M /
 * 2021" sits. Hard cut on beat 2: the head shoots on to full length (value/from = 2.6x longer) and "4.2M / 2025"
 * slams in at the new head in the accent while the start number stays as the reference. Tall and square frames run
 * the spine down the left edge (start number in the top half, end number in the bottom half); 16:9 runs it left to
 * right (start number over the left third, end number over the right). Number, period and copy agree on every frame.
 */
function heroScene(api, fmt) {
  const { F, ctx, theme, T, M, D, data } = api;
  const h = data.hero, o = numOpts(h), S = F.safe, from = h.from ?? 0;
  // a decline (from > value) mirrors the spine: it starts at full length and retracts onto the end number
  const down = from > 0 && h.value < from;
  const frac = down ? M.clamp(h.value / from, 0.3, 1) : h.value ? M.clamp(from / h.value, 0.12, 1) : 0.4;
  const sA = fmt(from, o), sB = fmt(h.value, o);
  const hasYr = h.fromLabel !== undefined && h.toLabel !== undefined;
  const capK = T.measure(ctx, theme, 'display', '0', 100).cap / 100;
  const w100 = (s2) => T.measure(ctx, theme, 'display', s2, 100).w / 100;
  const chipSize = T.readable(F, 1.25), labSize = T.readable(F, F.pick({ v: 1.6, s: 1.4, h: 1.4 }));
  const wide = F.orient === 'h';
  const cutAt = 2, ratioAt = 3, pushAt = 4, beats = h.beats || 5;
  const change = down ? `\u2212${fmt((1 - h.value / from) * 100, { fmt: 'pct' })}` : fmt(h.value / from, { fmt: 'x', decimals: 1 });
  const ratio = from > 0 && h.delta !== 'none' ? `${change}${h.deltaLabel ? ` ${h.deltaLabel}` : ''}` : '';
  const sw = Math.max(16 * F.u, Math.min(S.w, S.h) * 0.055); // spine thickness
  // a number block: numeral (size N), then the period as a display numeral at yrK·N, then (B only) the label
  const yrK = 0.4, gapK = 0.16;
  const blockH = (N, lab) => N * capK + (hasYr ? N * gapK + N * yrK * capK : 0) + (lab ? labSize * 1.7 : 0);
  let L, A, B, spine;
  if (!wide) {
    const x0 = S.x + sw + T.readable(F, 1.0), avail = S.x + S.w - x0;
    const yB = S.y + S.h - labSize * 0.35, len = yB - S.y, yA = S.y + len * frac, k = capK + (hasYr ? gapK + yrK * capK : 0);
    if (!down) {
      const NA = Math.min(avail * 0.9 / w100(sA), (yA - S.y - T.readable(F, 0.6)) / k);
      const NB = Math.min(avail * 0.9 / w100(sB), (yB - yA - T.readable(F, 1.2) - labSize * 1.7) / k);
      A = { N: NA, x: x0, top: yA - blockH(NA, false), align: 'l' };
      B = { N: NB, x: x0, top: yB - blockH(NB, true), align: 'l' };
    } else {
      // decline: the end number (with its label) sits above the short head, the start number above the full length
      const NB = Math.min(avail * 0.9 / w100(sB), (yA - S.y - T.readable(F, 0.6) - labSize * 1.7) / k);
      const NA = Math.min(avail * 0.9 / w100(sA), (yB - yA - T.readable(F, 1.2)) / k);
      A = { N: NA, x: x0, top: yB - blockH(NA, false), align: 'l' };
      B = { N: NB, x: x0, top: yA - blockH(NB, true), align: 'l' };
    }
    spine = (len2) => ({ x: S.x, y: F.full.y, w: sw, h: S.y - F.full.y + len2 });
    L = { yA, yB, len, head: (len2) => [S.x + sw / 2, S.y + len2] };
  } else {
    // 16:9: the spine runs left to right through the middle; the start number hangs under the spine's left part
    // (ending at the 2021 head), the end number stands on the spine's right part (ending at the 2025 head)
    // (a decline swaps the parts: the end number stands on the short left part, the start number hangs under the rest)
    const len = S.w, xA = S.x + len * frac, gap = T.readable(F, 1.2);
    const NA = down ? Math.min((S.x + S.w - xA - gap) / w100(sA), S.h * 0.3 / capK) : Math.min((xA - S.x - gap * 0.5) / w100(sA), S.h * 0.3 / capK);
    const NB = down ? Math.min((xA - S.x - gap * 0.5) / 1.1 / w100(sB), S.h * 0.46 / capK) : Math.min((S.x + S.w - xA - gap) / w100(sB), S.h * 0.46 / capK);
    const above = NB * capK + gap * 0.6;
    const below = sw + gap * 0.6 + Math.max(NA * capK + (hasYr ? NA * gapK + NA * yrK * capK : 0), (hasYr ? NB * yrK * capK : 0) + labSize * 1.9);
    const spineY = S.y + (S.h - above - below) * 0.5 + above;
    const under = spineY + sw + gap * 0.6;
    A = { N: NA, x: down ? S.x + S.w : xA - gap * 0.5, base: under + NA * capK, yrBase: under + NA * capK + NA * gapK + NA * yrK * capK, yrN: NA * yrK, align: 'r' };
    B = { N: NB, x: down ? xA - gap * 0.5 : S.x + S.w, base: spineY - gap * 0.6, yrBase: under + NB * yrK * capK, yrN: NB * yrK, align: 'r' };
    spine = (len2) => ({ x: F.full.x, y: spineY, w: S.x - F.full.x + len2, h: sw });
    L = { xA, len, head: (len2) => [S.x + len2, spineY + sw / 2] };
  }
  const lenA = L.len * frac, lenS = down ? L.len : lenA, lenE = down ? lenA : L.len;
  const grow = smooth(0.55);
  const spineLen = (f) => f.since(cutAt) < 0 ? lenS * (0.55 + 0.45 * M.clamp(M.sp(f.since(0) + 0.05, grow)))
    : lenS + (lenE - lenS) * M.clamp(M.sp(f.since(cutAt), smooth(0.35)), 0, 1.02);
  // the label sits under the end number; the stamp (kicker) and the growth chip share the start number's period row
  const labFit = (x, y, w, align) => h.label ? T.fitText(ctx, theme, h.label, { role: 'ui', lines: 1, max: labSize, min: T.readable(F, 1.0), weight: 700,
    align, box: { x, y: y - labSize, w, h: labSize * 1.2 }, valign: 'b' }) : null;
  let lab, stampBox, ratioBox;
  const chipH = chipSize * 2.1;
  if (!wide) {
    const by = B.top + blockH(B.N, true);
    lab = labFit(B.x, by, S.x + S.w - B.x, 'l');
    const yrA = A.top + A.N * capK + A.N * gapK + A.N * yrK * capK;
    const ax = A.x + (hasYr ? w100(String(h.fromLabel)) * A.N * yrK + chipSize : 0);
    stampBox = data.kicker ? pillBox(api, data.kicker, chipSize, ax, yrA - A.N * yrK * capK / 2) : null;
    const bx = B.x + (hasYr ? w100(String(h.toLabel)) * B.N * yrK + chipSize : 0);
    const yrB = B.top + B.N * capK + B.N * gapK + B.N * yrK * capK;
    const rb = ratio ? pillBox(api, ratio, chipSize, bx, yrB - B.N * yrK * capK / 2) : null;
    ratioBox = rb && rb.x + rb.w <= S.x + S.w ? rb : rb ? pillBox(api, ratio, chipSize, B.x, B.top - chipH * 0.7) : null;
  } else {
    // the label and the chip stay in the end number's part of the spine, the stamp in the start number's part
    const endL = down ? S.x : L.xA + T.readable(F, 0.6), endR = down ? B.x : S.x + S.w, startL = down ? L.xA + T.readable(F, 0.6) : S.x;
    lab = labFit(endL, B.yrBase + labSize * 1.7, endR - endL, 'r');
    const yw = (pd, n) => (hasYr ? w100(String(pd)) * n : 0);
    stampBox = data.kicker ? pillBox(api, data.kicker, chipSize, 0, A.yrBase - A.yrN * capK / 2) : null;
    if (stampBox) stampBox.x = Math.max(startL, A.x - yw(h.fromLabel, A.yrN) - chipSize - stampBox.w);
    // no room left of the period (a short start part): the stamp moves above the spine's start part, which the end
    // number never uses
    if (stampBox && stampBox.x + stampBox.w > A.x - yw(h.fromLabel, A.yrN) - chipSize * 0.5) {
      const cy = B.base - chipH / 2;
      stampBox = pillBox(api, data.kicker, chipSize, 0, cy);
      stampBox.x = down ? A.x - stampBox.w : S.x;
    }
    const rb = ratio ? pillBox(api, ratio, chipSize, 0, B.yrBase - B.yrN * capK / 2) : null;
    ratioBox = rb ? { ...rb, x: B.x - yw(h.toLabel, B.yrN) - chipSize - rb.w } : null;
    if (ratioBox && ratioBox.x < endL) ratioBox = { ...ratioBox, x: endL };
  }
  // too small a change leaves no room for one of the two numbers (or the label): say so instead of failing lint with layout errors
  const minN = T.readable(F, 1.6);
  if (!(A.N >= minN && B.N >= minN) || (lab && lab.overflow)) {
    const pct = from > 0 ? Math.round(Math.abs(h.value / from - 1) * 100) : 0;
    throw new Error(`content.hero: ${sA} -> ${sB} (${down ? '-' : '+'}${pct}%) is too small a change to draw as a spine in ${F.fmt}; `
      + 'the spine needs about +40% or more (or -20% or more for a decline); for a smaller change omit content.hero and open on a "counter" point');
  }
  const accent = lab ? accentUnits(api, lab, h.accent) : [];
  const events = [cutAt, ...(ratio ? [ratioAt] : []), pushAt];
  const sfx = [{ at: 0, sfx: 'pop', gain_db: -8 }, { at: cutAt, sfx: 'thump', gain_db: -2 }, ...(ratio ? [{ at: ratioAt, sfx: 'pop', gain_db: -6 }] : []),
    { at: pushAt, sfx: 'riser', gain_db: -13, dur: beats - pushAt }];
  // the end number swells into the cut under the riser (the hero never cuts on a still)
  const swell = (f) => 1 + 0.035 * M.easeInOutCubic(M.clamp((f.lb - pushAt) / (beats - pushAt)));
  const block = (f, Bk, str, period, color, yrColor, at, grow = 1) => {
    const N = Bk.N, punch = (at === undefined ? 1 : 1 + 0.06 * (1 - M.clamp(M.sp(f.since(at), 'snap')))) * grow;
    if (!wide) {
      const nb = Bk.top + N * capK, yb = nb + N * gapK + N * yrK * capK;
      ctx.save(); ctx.translate(Bk.x, nb); ctx.scale(punch, punch); ctx.translate(-Bk.x, -nb);
      T.drawText(ctx, theme, str, Bk.x, nb, { role: 'display', size: N, color });
      ctx.restore();
      if (hasYr) T.drawText(ctx, theme, String(period), Bk.x, yb, { role: 'display', size: N * yrK, color: yrColor });
    } else {
      ctx.save(); ctx.translate(Bk.x, Bk.base); ctx.scale(punch, punch); ctx.translate(-Bk.x, -Bk.base);
      T.drawText(ctx, theme, str, Bk.x, Bk.base, { role: 'display', size: N, color, align: 'r' });
      ctx.restore();
      if (hasYr) T.drawText(ctx, theme, String(period), Bk.x, Bk.yrBase, { role: 'display', size: Bk.yrN, color: yrColor, align: 'r' });
    }
  };
  return { id: 'hero', beats, events, sfx, draw(f) {
    const isB = f.since(cutAt) >= 0, len = spineLen(f);
    // the reference tick where the start value ends stays on the spine after the cut
    if (isB && down) D.fillBox(ctx, spine(lenS), 'muted'); // a decline keeps the start length as a muted ghost
    D.fillBox(ctx, spine(len), isB ? 'accent' : 'fg');
    if (isB && !down) { const [hx, hy] = L.head(lenA); D.fillBox(ctx, wide ? { x: hx - sw * 0.15, y: hy - sw, w: sw * 0.3, h: sw * 2 } : { x: hx - sw, y: hy - sw * 0.15, w: sw * 2, h: sw * 0.3 }, 'bg'); }
    block(f, A, sA, h.fromLabel, isB ? 'muted' : 'fg', isB ? 'muted' : 'fg');
    if (isB) block(f, B, sB, h.toLabel, 'accent', 'fg', cutAt, swell(f));
    if (lab && isB) T.kinetic(f, lab, { by: 'word', at: cutAt, stagger: 0, from: 'mask', spring: TYPE, accent });
    if (stampBox) pill(api, f, stampBox, data.kicker, chipSize, -1, { fill: 'fg', ink: 'bg' });
    if (ratioBox) pill(api, f, ratioBox, ratio, chipSize, ratioAt);
  } };
}

const asList = (h) => (!h ? [] : Array.isArray(h) ? h : [h]);

/**
 * Wrap a shot. When the previous shot hands over marks (handOut) and this shot takes them (handIn(f) -> shapes), the
 * first MORPH seconds draw each carried shape morphing from where it was into this shot's own mark; the body hides
 * that mark until the morph lands (body.draw(f, p)). Morph boxes are logged as 'handoff' for check.mjs.
 */
function shot(api, id, body, prevHand, hasNext) {
  const { M } = api;
  const from = asList(prevHand);
  return { id, beats: body.beats, events: (b) => [0, ...(typeof body.events === 'function' ? body.events(b) : body.events)].filter((e) => e <= b),
    sfx: body.sfx, handOut: hasNext ? body.handOut : null, draw(f) {
      const take = from.length && body.handIn;
      const p = take ? M.clamp(M.sp(f.since(0), smooth(MORPH))) : 1;
      body.draw(f, p);
      if (take && p < 0.995) {
        const to = asList(body.handIn(f));
        to.forEach((t, k) => { if (from[k]) drawShape(api, morphShape(from[k], t, p), t.color || 'accent', true); });
      }
    } };
}

export default {
  id: 'data-story',
  build(api) {
    const { data, grid } = api;
    const fmt = makeFmt(checkLocale(data.locale || 'en-US'));
    const bodies = [];
    if (data.hero) bodies.push({ id: 'hero', body: heroScene(api, fmt) });
    data.points.forEach((pt, i) => {
      const build = BUILDERS[pt.type];
      if (!build) throw new Error(`content.points[${i}].type: "${pt.type}" is not one of ${Object.keys(BUILDERS).join(', ')}`);
      const prev = bodies.length ? bodies[bodies.length - 1].body.handOut : null;
      const body = build(api, pt, fmt, `content.points[${i}]`, prev);
      bodies.push({ id: `p${i + 1}-${pt.type}`, body: pt.beats ? { ...body, beats: pt.beats } : body });
    });
    const fixed = bodies.reduce((a, b) => a + b.body.beats, 0);
    if (fixed + 5 > grid.totalBeats) {
      const need = Math.ceil(((fixed + 6) * 60) / grid.bpm);
      throw new Error(`data-story: content needs ${fixed} beats plus >= 5 for the end card, the project has ${grid.totalBeats}; set duration >= ${need} s (or fewer points / shorter beats)`);
    }
    bodies.push({ id: 'end', body: endScene(api, fmt, bodies[bodies.length - 1].body.handOut) });
    const scenes = [];
    bodies.forEach(({ id, body }, i) => {
      const prev = scenes[i - 1];
      scenes.push(shot(api, id, body, prev ? prev.handOut : null, i < bodies.length - 1));
    });
    return { scenes, persistent: [], poster: grid.totalBeats - 0.25 };
  },
};
