// product-launch: problem hook over the real KPI card (wrong numbers scrambling) -> match cut into the UI
// assembling -> 1-3 feature moments (macro on the control, click, whip to the payoff) -> metric counted out of
// the real KPI card, collapsing into the logo mark -> CTA lockup grown from that mark. All copy, colours and data come from
// project.json. UI is only ever cropped/animated captured PNGs (see ui.js / stage.js).
import { TYPE, cardParts } from './stage.js';
import { assembleScene, assemblePlan, valueSlot, drawScramble } from './ui.js';
import { featureScene } from './feature.js';
import { metricScene, ctaScene, ctaLayout } from './finale.js';
import { centreTransitions } from './boundary.js';

const LEAD = 0.16; // seconds: hook words enter this early so frame 0 already shows the first word

/**
 * Hook layout: tries every contiguous regrouping of the content lines (4 lines, 2 lines, ...), justifies each
 * line to the box width, separates lines by the real ink (descender of the line above + ascender overshoot of
 * the line below), and keeps the grouping with the most ink area. 16:9 gets 2 wide lines, 9:16 4 lines spread
 * over the safe height. -> fit[] (one T.fitText per line).
 */
function hookFits(api, lines, box) {
  const { ctx, theme, T, F } = api;
  const groupings = [];
  const rec = (i, acc) => {
    if (i === lines.length) { groupings.push(acc); return; }
    for (let j = i + 1; j <= lines.length; j++) rec(j, [...acc, lines.slice(i, j).join(' ')]);
  };
  rec(0, []);
  const plan = (ls) => {
    let sizes = ls.map((l) => box.w / T.measure(ctx, theme, 'display', l, 100).w * 100);
    if (Math.max(...sizes) / Math.min(...sizes) > 2.1) return null;     // keep the lines one family of sizes
    const metrics = (ss) => ss.map((z, i) => T.measure(ctx, theme, 'display', ls[i], z));
    const gapsOf = (ms) => ms.slice(1).map((m, i) => ms[i].desc + Math.max(0, m.asc - m.cap) + 0.12 * Math.min(...ms.map((q) => q.cap)));
    const height = (ms) => ms.reduce((a, m) => a + m.cap, 0) + gapsOf(ms).reduce((a, g) => a + g, 0);
    const k = Math.min(1, box.h / height(metrics(sizes)));
    sizes = sizes.map((z) => z * k * 0.995);
    const ms = metrics(sizes);
    // Ink area, weighted by how much of the width the block spans (a narrow 4-line tower in 16:9 loses).
    const ink = ms.reduce((a, m) => a + m.w * m.cap, 0) * Math.sqrt(Math.max(...ms.map((q) => q.w)) / box.w);
    return { ls, sizes, ms, gaps: gapsOf(ms), h: height(ms), ink };
  };
  const best = groupings.map(plan).filter(Boolean).sort((a, b) => b.ink - a.ink)[0] || plan(lines);
  // Width-limited (tall frames): spread the spare height between the lines, capped so they stay one block.
  let gaps = best.gaps;
  const spare = box.h * 0.94 - best.h;
  if (spare > 0 && gaps.length) {
    const minCap = Math.min(...best.ms.map((m) => m.cap));
    gaps = gaps.map((g) => g + Math.min(spare / gaps.length, minCap * 1.1));
  }
  const total = best.ms.reduce((a, m) => a + m.cap, 0) + gaps.reduce((a, g) => a + g, 0);
  let y = box.y + (box.h - total) / 2;
  return best.ls.map((l, i) => {
    const cap = best.ms[i].cap;
    const ft = T.fitText(ctx, theme, l, { role: 'display', box: { x: box.x, y, w: box.w + 1, h: cap * 1.02 }, lines: 1,
      max: best.sizes[i], min: Math.min(best.sizes[i] * 0.97, T.readable(F, 1.4)) });
    y += cap + (gaps[i] || 0);
    return ft;
  });
}

/**
 * Hook layout: the scrambling value is the HERO object: native display digits as large as the frame allows
 * (width-limited in tall frames, ~55% of the height in 16:9), centred on the safe area. The hook lines split into
 * two groups that slam OVER the digits' top and bottom edges (each word on a dark plate). -> {digits, boxes[]}.
 */
function hookLayout(api, lines, decoys) {
  const { F, ctx, theme, T } = api;
  const widest = decoys.reduce((a, d) => (T.measure(ctx, theme, 'display', d, 100).w > T.measure(ctx, theme, 'display', a, 100).w ? d : a), decoys[0]);
  const m = T.measure(ctx, theme, 'display', widest, 100);
  const size = Math.min((F.safe.w * F.pick({ v: 0.96, s: 0.9, h: 0.8 })) / m.w * 100, (F.h * F.pick({ v: 0.3, s: 0.42, h: 0.55 })) / m.cap * 100);
  const cap = (m.cap * size) / 100, w = (m.w * size) / 100;
  const cy = F.safe.y + F.safe.h * 0.5;
  const digits = { size, cap, w, x: F.cx - w / 2, base: cy + cap / 2 };
  const over = cap * 0.06;   // the word plates just overlap the digits' edges
  const topBox = { x: F.safe.x, y: F.safe.y, w: F.safe.w, h: cy - cap / 2 + over - F.safe.y };
  const botBox = { x: F.safe.x, y: cy + cap / 2 - over, w: F.safe.w, h: F.safe.y + F.safe.h - (cy + cap / 2 - over) };
  const half = Math.ceil(lines.length / 2);
  const groups = lines.length > 1 ? [lines.slice(0, half), lines.slice(half)] : [lines];
  return { digits, boxes: lines.length > 1 ? [topBox, botBox] : [topBox], groups };
}

/**
 * Scene 1 (4 beats): starts mid-action. Frame 0 is the scrambling value full-bleed (the metric card's interior,
 * blown up so its number is the hero) with the first word slammed over it. Words slam in on the half beats, each
 * on a dark plate; the digits FREEZE when the accent word lands. On the last beat the words drop out while the
 * card shrinks around its frozen number into its exact assemble cell: one hero object in every frame, a match cut.
 */
function hookScene(api, h, beats, card, decoys) {
  const { F, ctx, theme, T, L, M, D } = api;
  const lay = hookLayout(api, h.lines, decoys);
  const fits = lay.groups.flatMap((g, k) => hookFits(api, g, L.inset(lay.boxes[k], { t: lay.boxes[k].h * 0.04, b: lay.boxes[k].h * 0.04 })));
  const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const units = fits.flatMap((ft, li) => T.kineticUnits(ctx, theme, ft, 'word').map((u) => ({ ...u, li, ft })));
  const stagger = 0.5;
  const exitAt = beats - 1;
  const isAccent = units.map((u) => !!h.accent && norm(u.s) === norm(h.accent));
  const hasAcc = isAccent.some(Boolean);
  const accentAt = hasAcc ? isAccent.indexOf(true) * stagger : exitAt;
  const wordAt = units.map((_, k) => k * stagger);
  const events = [...wordAt, exitAt].filter((b, k, a) => b < beats && a.indexOf(b) === k);
  const flick = Array.from({ length: Math.ceil(accentAt * 2) }, (_, k) => k / 2).filter((b) => !wordAt.includes(b));
  const sfx = [...wordAt.map((b, k) => ({ at: b, sfx: isAccent[k] ? 'thump' : 'pop', gain_db: isAccent[k] ? -3 : -8 })),
    ...flick.map((b) => ({ at: b, sfx: 'tick', gain_db: -15 })), { at: exitAt, sfx: 'whoosh', gain_db: -9 }].filter((m) => m.at < beats);
  const dg = lay.digits;
  const fill = card && card.slot.fill ? card.slot.fill : 'surface';
  // The card rect whose value slot holds the giant digits (drawScramble geometry: size = slot.h * 0.62).
  let R0 = null, k0 = 1;
  if (card) {
    const sl = card.slot.r, bh = dg.size / 0.62;
    k0 = bh / sl.h;
    const bx = dg.x - bh * 0.08, by = dg.base - bh * 0.78;
    R0 = { x: bx - (sl.x - card.hs.x) * k0, y: by - (sl.y - card.hs.y) * k0, w: card.hs.w * k0, h: card.hs.h * k0 };
  }
  const frozenAt = (lb) => Math.min(lb, accentAt);
  const valueAt = (lb) => decoys[Math.floor(Math.max(0, frozenAt(lb) + 0.15) * 2 + 1e-6) % decoys.length];
  return { id: 'hook', beats, events, sfx, draw(f) {
    const out = M.clamp(M.sp(f.since(exitAt), TYPE));
    const fly = card ? M.clamp(M.sp(f.since(exitAt), [0.28, 0.88])) : 0;
    const txt = valueAt(f.lb);
    const snapK = f.lb >= accentAt ? 1 + 0.06 * f.hit(accentAt, 0.12) : 1;
    if (!card || fly <= 0) {
      // Full-bleed: the card's interior with its (wrong) number at hero size.
      D.fillBox(ctx, F.full, fill);
      const n = Math.floor(Math.max(0, frozenAt(f.lb) + 0.15) * 2 + 1e-6);
      const roll = f.lb < accentAt ? 1 - M.clamp(M.sp((f.lb + 0.15 - n / 2) * f.spb, 'snap')) : 0;
      ctx.save(); ctx.beginPath(); ctx.rect(0, dg.base - dg.cap * 1.25, F.w, dg.cap * 1.5); ctx.clip();
      ctx.translate(F.cx, dg.base - dg.cap / 2); ctx.scale(snapK, snapK); ctx.translate(-F.cx, -(dg.base - dg.cap / 2));
      T.drawText(ctx, theme, txt, dg.x, dg.base + roll * dg.cap * 0.7, { role: 'display', size: dg.size, color: f.lb >= accentAt ? 'accent' : 'fg', log: false });
      ctx.restore();
    } else {
      // The fly: the card shrinks (geometric zoom) around its frozen number into its assemble cell.
      const b = card.dst1, k1 = b.w / card.hs.w, k = k0 * Math.pow(k1 / k0, fly);
      const sl = card.slot.r;
      const c0 = [R0.x + (sl.x + sl.w * 0.3 - card.hs.x) * k0, R0.y + (sl.y + sl.h / 2 - card.hs.y) * k0];
      const c1 = [b.x + (sl.x + sl.w * 0.3 - card.hs.x) * k1, b.y + (sl.y + sl.h / 2 - card.hs.y) * k1];
      const ax = c0[0] + (c1[0] - c0[0]) * fly, ay = c0[1] + (c1[1] - c0[1]) * fly;
      const cur = { x: ax - (sl.x + sl.w * 0.3 - card.hs.x) * k, y: ay - (sl.y + sl.h / 2 - card.hs.y) * k, w: card.hs.w * k, h: card.hs.h * k };
      D.withClip(ctx, (g) => D.rrect(g, cur, theme.radius * 0.6 * fly), () => {
        D.fillBox(ctx, cur, fill);
        ctx.drawImage(card.s.img, card.hs.x, card.hs.y, card.hs.w, card.hs.h, cur.x, cur.y, cur.w, cur.h);
        card.scramble(f, [{ src: card.hs, dst: cur }], txt);
      });
    }
    units.forEach((u, k) => {
      const dt = f.since(wordAt[k]) + LEAD;
      if (dt <= 0 || out >= 0.97) return;
      const { ft } = u, acc = isAccent[k];
      const pin = M.sp(dt, 'snap');
      const slot = { x: u.x, y: u.y - ft.cap, w: u.w, h: ft.cap };
      T.logText(ctx, u.s, slot, ft.size, 'display');
      // Slam: each word lands from 1.5x onto its slot, on a dark plate; on the exit every word drops out of the frame.
      const sc = 1 + 0.5 * (1 - pin) + (acc ? 0.05 * f.hit(accentAt, 0.12) : 0);
      const [cx, cy] = L.center(slot);
      const pad = ft.cap * 0.16, desc = ft.size * 0.2;
      ctx.save();
      ctx.translate(cx, cy + out * F.h * 0.6); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      D.fillBox(ctx, { x: u.x - pad, y: u.y - ft.cap - pad, w: u.w + pad * 2, h: ft.cap + desc + pad * 2 }, 'bg', pad * 0.6);
      T.drawText(ctx, theme, u.s, u.x, u.y, { role: 'display', size: ft.size, color: acc ? 'accent' : 'fg', log: false });
      ctx.restore();
    });
  } };
}

export default {
  id: 'product-launch',
  build(api) {
    const { data, grid, A, T } = api;
    const tm = { hook: 4, assemble: 4, metric: 8, cta: 4, ...(data.timing || {}) };
    const feats = data.features;
    const featBeats = tm.feature || Math.max(4, Math.floor((grid.totalBeats - tm.hook - tm.assemble - tm.metric - tm.cta) / feats.length));
    const m = data.metric;
    // The metric card (when it is one of the assembled pieces) opens the film and is the hook->assemble match cut.
    const plan = assemblePlan(api, data.assemble);
    const hk = m.card && m.screen === data.assemble.screen ? plan.ids.indexOf(m.card) : -1;
    const fmt = { from: 0, fmt: m.fmt || 'int', decimals: m.decimals || 0, suffix: m.unit || '', prefix: m.prefix || '' };
    const decoys = data.hook.decoys || [0.69, 0.92, 0.81, 1.12].map((r) => T.counterText(m.value * r, 1, fmt));
    let card = null, slot = null;
    if (hk >= 0) {
      const q = plan.pieces[hk], parts = cardParts(q);
      const hs = parts && q.w / q.h >= 2.2 ? { x: q.x + parts.head[0] * q.w, y: q.y + parts.head[1] * q.h, w: parts.head[2] * q.w, h: parts.head[3] * q.h } : q;
      const d = plan.cards[hk].draws.find((x) => x.src.x <= hs.x + 1 && x.src.y <= hs.y + 1 && x.src.x + x.src.w >= hs.x + hs.w - 1 && x.src.y + x.src.h >= hs.y + hs.h - 1) || plan.cards[hk].draws[0];
      const kk = d.dst.w / d.src.w;
      slot = valueSlot(plan.s, q, m.cardValue);
      card = { s: plan.s, hs, slot, dst1: { x: d.dst.x + (hs.x - d.src.x) * kk, y: d.dst.y + (hs.y - d.src.y) * kk, w: hs.w * kk, h: hs.h * kk },
        scramble: (f, draws, fixed = null) => drawScramble(api, f, draws, slot, decoys, 2, fixed) };
    }
    const hook = hookScene(api, data.hook, tm.hook, card, decoys);
    const assemble = assembleScene(api, data.assemble, data.product, tm.assemble, { held: hk >= 0 ? m.card : null, slot, decoys });
    const features = feats.map((ft, i) => featureScene(api, ft, i, feats.length, featBeats));
    const logo = data.cta.logo ? api.assets.image(data.cta.logo) : api.assets.logo;
    const lay = ctaLayout(api, data.product, data.cta, logo);
    const metric = metricScene(api, m, tm.metric, lay.mark);
    const ctaBeats = grid.totalBeats - tm.hook - tm.assemble - featBeats * feats.length - tm.metric;
    const cta = ctaScene(api, data.cta, logo, ctaBeats, lay, metric);
    const scenes = centreTransitions(api, [hook, assemble, ...features, metric, cta]);
    // Build-time QA facts for templates/product-launch/check.mjs (camera zoom vs measured glyph height per feature).
    globalThis.__productLaunchQA = { features: features.map((s) => s.qa) };
    return { scenes };
  },
};
