// cards.js: the two larger overlays (quote card, title overlay). Same contract as bars.js: {events, sfx, draw(f)}
// in local beats, E = exit start (undefined = holds to the end and lands the lockup instead).
import { TYPE, fitAt, shift, inkH, life, resting, plate, words, chipLayout, cue, inScene } from './kit.js';

const A0 = -0.25;

/**
 * quote: a pull-quote card. The plate unfolds upwards with its accent bar, a big quote mark pops in the left
 * column, the quote masks in word by word, then a rule draws on under it and the attribution (author, role) lands.
 */
export function quoteCard(G, it, nb, E) {
  const { F, M, T, U, pad, ctx, theme } = G;
  const side = it.side === 'r' ? 'r' : 'l';
  const W = (G.right - G.left) * F.pick({ v: 1, s: 0.9, h: 0.56 });
  const mark0 = fitAt(G, '“', { size: U * 3, width: U * 4 });
  const mw = Math.ceil(mark0.box.w + pad * 0.7);
  const inner = W - G.bar - pad * 2 - mw;
  const q = fitAt(G, it.quote, { size: U * F.pick({ v: 1.25, s: 1.2, h: 1.3 }), width: inner, lines: 5, leading: 1.12 });
  const au = fitAt(G, it.author, { role: 'ui', size: U, width: inner });
  const ro = it.role ? fitAt(G, it.role, { role: 'ui', size: U, width: inner, lines: 2, leading: 1.25 }) : null;
  const rule = Math.max(3, Math.round(4 * F.u));
  const textW = Math.max(q.box.w, au.box.w, ro ? ro.box.w : 0);
  const w = Math.ceil(G.bar + pad * 2 + mw + textW);
  const h = Math.ceil(pad * 1.1 + inkH(q) + G.gap * 1.6 + rule + G.gap * 1.2 + inkH(au) + (ro ? G.gap * 0.5 + inkH(ro) : 0) + pad);
  const x = side === 'l' ? G.left : G.right - w, y = G.floor - h;
  const card = { x, y, w, h };
  const bar = { x: side === 'l' ? x : x + w - G.bar, y, w: G.bar, h };
  const tx = (side === 'l' ? x + G.bar : x) + pad + mw;
  const qFt = shift(q, tx, y + pad * 1.1);
  const ruleY = qFt.box.y + inkH(q) + G.gap * 1.6;
  const auFt = shift(au, tx, ruleY + rule + G.gap * 1.2);
  const roFt = ro ? shift(ro, tx, auFt.box.y + inkH(au) + G.gap * 0.5) : null;
  const markFt = shift(mark0, (side === 'l' ? x + G.bar : x) + pad * 0.8, y + pad * 0.6);
  const nw = it.quote.split(/\s+/).filter(Boolean).length;
  const stagger = Math.min(0.125, Math.max(0.0625, 2.5 / Math.max(1, nw)));
  const wordsAt = A0 + 0.5, wordsEnd = wordsAt + (nw - 1) * stagger;
  const limit = (E ?? nb) - 1;
  const auAt = Math.min(M.quant(wordsEnd + 0.5), Math.max(M.quant(wordsAt + 0.5), M.quant(limit)));
  const X = E === undefined ? {} : { card: E, bar: E + 0.125 };
  const events = [0, auAt, ...(E !== undefined ? [E] : [])].filter(inScene(nb));
  const sfx = [cue(G, 0, 'whoosh', -12), cue(G, 0.25, 'pop', -9), cue(G, auAt, 'tick', -10),
    ...(E !== undefined ? [cue(G, E, 'swish', -14)] : [])].filter(inScene(nb));
  return {
    events, sfx, layout: { card },
    draw(f) {
      const c = plate(G, card, life(G, f, A0, X.card), 'b', G.ink.plate);
      plate(G, bar, life(G, f, A0 + 0.0625, X.bar), 'b', 'accent');
      if (!c) return;
      ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
      if (resting(f, X.card)) T.kinetic(f, markFt, { by: 'line', at: A0 + 0.25, from: 'scale', spring: 'snap', color: G.quoteMark });
      else for (const l of markFt.lines) T.drawText(ctx, theme, l.s, l.x, l.y, { role: 'display', size: markFt.size, color: G.quoteMark, log: false });
      ctx.restore();
      if (f.since(wordsAt) > 0) words(G, f, qFt, c, { at: wordsAt, out: X.card, color: G.ink.ink, stagger });
      const rp = M.clamp(M.sp(f.since(auAt), TYPE));
      if (rp > 0) G.D.fillBox(ctx, { x: tx, y: ruleY, w: Math.max(au.box.w, U * 3) * rp, h: rule }, 'accent');
      if (f.since(auAt) > 0) words(G, f, auFt, c, { at: auAt, out: X.card, color: G.ink.ink, by: 'line' });
      if (roFt && f.since(auAt + 0.25) > 0) words(G, f, roFt, c, { at: auAt + 0.25, out: X.card, color: G.ink.sub, by: 'line' });
    },
  };
}

/**
 * title: a title overlay. A kicker chip, then one plate per title line stepping in (each line's words mask up
 * inside its plate), then the sub on the second tier. As the last graphic it holds and lands a lockup: an accent
 * underline slams across the title block (thump) two beats before the end.
 */
export function titleCard(G, it, nb, E) {
  const { F, M, U, pad } = G;
  const W = (G.right - G.left) * F.pick({ v: 1, s: 0.92, h: 0.64 });
  const size = U * F.pick({ v: 2.0, s: 1.9, h: 2.2 });
  const ft = fitAt(G, it.title, { size, width: W - pad * 2, lines: 3, leading: 1.0 });
  const sub = it.sub ? fitAt(G, it.sub, { role: 'ui', size: U, width: W - pad * 2, lines: 2, leading: 1.25 }) : null;
  const step = Math.max(2, Math.round(G.bar * 0.6));
  const lineH = Math.ceil(ft.cap + ft.size * 0.24 + pad * 1.2);
  const subH = sub ? Math.ceil(inkH(sub) + pad * 1.1) : 0;
  const lock = E === undefined ? Math.max(G.bar, Math.round(12 * F.u)) : 0;
  let y = G.floor - subH - (sub ? step : 0) - lock - (lock ? step : 0);
  const subBox = sub ? { x: G.left, y: G.floor - subH, w: Math.ceil(sub.box.w + pad * 2), h: subH } : null;
  const lines = ft.lines.slice().reverse().map((l) => {
    y -= lineH;
    const box = { x: G.left, y, w: Math.ceil(l.w + pad * 2), h: lineH };
    const one = Object.freeze({ ...ft, lines: [{ ...l, x: G.left + pad, y: y + pad * 0.6 + ft.cap }], box: { x: G.left + pad, y: y + pad * 0.6, w: l.w, h: ft.cap } });
    y -= step;
    return { box, ft: one };
  }).reverse();
  const subFt = sub ? shift(sub, subBox.x + pad, subBox.y + pad * 0.55) : null;
  const lockBox = lock ? { x: G.left, y: lines[lines.length - 1].box.y + lineH + step, w: Math.max(...lines.map((l) => l.box.w), subBox ? subBox.w : 0), h: lock } : null;
  const probe = it.kicker ? chipLayout(G, it.kicker, 0, 0) : null;
  const kick = probe ? chipLayout(G, it.kicker, G.left, lines[0].box.y - G.gap - probe.box.h) : null;
  // Line plates share a fixed window so the cues do not depend on how a format wrapped the title.
  const lineAt = (i) => A0 + 0.25 + (i * 0.5) / Math.max(1, lines.length - 1);
  const subAt = 1;
  const hit = lock ? M.quant(Math.max(subAt + 1, nb - 2)) : null;
  const X = E === undefined ? {} : { sub: E, line: (i) => E + 0.0625 * (lines.length - i), kick: E + 0.0625 * (lines.length + 1) };
  const outLine = (i) => (X.line ? X.line(i) : undefined);
  const events = [0, M.quant(subAt), ...(hit !== null ? [hit] : []), ...(E !== undefined ? [E] : [])].filter(inScene(nb));
  const sfx = [cue(G, 0, 'swish', -12), cue(G, 0.25, 'pop', -12),
    ...(sub ? [cue(G, subAt, 'tick', -12)] : []), ...(hit !== null ? [cue(G, hit, 'thump', -4)] : []),
    ...(E !== undefined ? [cue(G, E, 'swish', -14)] : [])].filter(inScene(nb));
  return {
    events, sfx, layout: { lines: lines.map((l) => l.box), sub: subBox, kick: kick && kick.box, lock: lockBox },
    draw(f) {
      if (kick) {
        const k = plate(G, kick.box, life(G, f, A0, X.kick), 'b', G.chip.plate);
        if (k && f.since(A0 + 0.25) > 0) words(G, f, kick.ft, k, { at: A0 + 0.25, out: X.kick, color: G.chip.ink, by: 'line' });
      }
      lines.forEach((l, i) => {
        const p = plate(G, l.box, life(G, f, lineAt(i), outLine(i)), 'l', G.ink.plate);
        if (p && f.since(lineAt(i) + 0.25) > 0) words(G, f, l.ft, p, { at: lineAt(i) + 0.25, out: outLine(i), color: G.ink.ink });
      });
      if (subBox) {
        const s = plate(G, subBox, life(G, f, subAt, X.sub), 'l', G.tier);
        if (s && f.since(subAt + 0.25) > 0) words(G, f, subFt, s, { at: subAt + 0.25, out: X.sub, color: G.ink.ink, by: 'line' });
      }
      if (lockBox) plate(G, lockBox, life(G, f, hit), 'l', 'accent');
    },
  };
}
