// middle.js: the showreel's middle-act techniques, built for scale and a different verb per shot (r2 critique).
//  slam    : echo rows of a word slam together into ONE full-width row, which is sliced by an accent band whose
//            opening reveals the second word at the same scale (a match cut on the slice); the band then floods.
//  montage : one capability word per beat, each fitted to the frame, hard-cut on the beat with the colour field
//            flipping on every cut (bg / accent / fg); the payoff phrase lands as the last cut of the sequence.
import { fieldInk } from './ink.js';

/** True for a line that ends in a number, with or without a unit (+105 %, −20 %, 3,8 %, 2026, 10x, 4 Mio): a full stop
 *  after it reads as punctuation ("−20 %.") or, in German, as an ordinal ("3."), so the montage drops its dot there. */
export const endsInNumber = (line) =>
  /\p{N}(?:[\s\u00A0\u202F]?(?:%|‰|°|×|x|k|m|mio|mrd|bn|€|\$|£|¥|h|s|ms|min|pt|px))?$/iu.test(String(line).trim());

const SLAM = [0.24, 1]; // critically damped and fast: a slam lands in ~0.15 s without overshoot
const FIELDS = ['bg', 'accent', 'fg'];

export function middleTech(E) {
  const { api, F, S, T, M, L, D, B, ctx, theme, R, period, room, fitD, dsec, need, q, TYPE, UI } = E;
  const after = (lb, at, s = TYPE) => Math.max(0, M.sp(dsec(lb, at), s));
  const lerpPt = (a, b, p) => [M.lerp(a[0], b[0], p), M.lerp(a[1], b[1], p), M.lerp(a[2], b[2], p)];
  /** Draw a fit scaled by k about c; logged only when at rest (k ~ 1). */
  const drawScaled = (ft, c, k, color) => {
    const fn = () => T.drawFit(ctx, theme, ft, { color, bleed: k > 1.002 });
    ctx.save(); ctx.translate(c[0], c[1]); ctx.scale(k, k); ctx.translate(-c[0], -c[1]);
    if (Math.abs(k - 1) > 0.002) T.quiet(fn); else fn();
    ctx.restore();
  };
  return {
    slam(s, i, nb) {
      const word = need(s, i, 'text'), rev = need(s, i, 'sub');
      const big = fitD(word, { x: S.x, y: S.y + S.h * 0.2, w: S.w - room, h: S.h * 0.6 }, { valign: 'c', align: 'c', max: S.h * 0.6 });
      // as many echo rows as fit at (near) the full-width size, so the rows fill the safe area edge to edge
      const n = Math.max(3, Math.min(7, Math.floor(S.h / (big.cap * 1.22)))), acc = Math.floor(n / 2);
      const rows = L.split(S, Array(n).fill(1), { axis: 'y', gap: S.h * 0.02 });
      const fits = rows.map((r) => fitD(word, { x: S.x, y: r.y, w: S.w - room, h: r.h }, { valign: 'c', align: 'c' }));
      const bl = big.lines[0], mid = bl.y - big.cap / 2, bc = [bl.x + bl.w / 2, mid];
      // the revealed word at the same scale; portrait splits it into two full-width lines (SYS / TEMS)
      const cut = Math.floor(rev.length / 2);
      const revFits = F.orient === 'v' && rev.length >= 6 && !/\s/.test(rev)
        ? B.justifyFits(api, [rev.slice(0, cut), rev.slice(cut)], { x: S.x, y: mid - S.h * 0.27, w: S.w - room, h: S.h * 0.54 }, { align: 'c' })
        : [fitD(rev, { x: S.x, y: mid - big.cap / 2, w: S.w - room, h: big.cap * 1.01 }, { valign: 'c', align: 'c', max: big.size })];
      const rTop = Math.min(...revFits.map((f) => f.box.y)), rBot = Math.max(...revFits.map((f) => f.box.y + f.box.h));
      const pad = big.cap * 0.32, band = { x: 0, y: rTop - pad, w: F.w, h: rBot - rTop + 2 * pad }, bmid = band.y + band.h / 2;
      const slamAt = 1, sliceAt = Math.min(2, nb - 1.5), floodAt = Math.min(3, nb - 0.75);
      const g = (lb) => M.clamp(after(lb, slamAt, SLAM)), sl = (lb) => M.clamp(after(lb, sliceAt));
      const fl = (lb) => M.clamp(after(lb, floodAt, UI));
      return {
        pre: 0.5, // hard cut: four rows already up on the cut frame
        events: [0, slamAt, sliceAt, floodAt],
        sfx: [0, 1, 2, 3].map((r) => ({ at: q(r * 0.25), sfx: 'tick', gain_db: -16 })).concat(
          { at: slamAt, sfx: 'thump', gain_db: -4 }, { at: sliceAt, sfx: 'swish', gain_db: -8 }, { at: sliceAt, sfx: 'thump', gain_db: -3 }, { at: floodAt, sfx: 'swish', gain_db: -10 }),
        draw(f) {
          const gg = g(f.lb), p = sl(f.lb);
          if (gg <= 0) { // rows mask in, every one at full safe width
            fits.forEach((ft, r) => T.kinetic(f, ft, { by: 'line', at: r * 0.125, from: 'mask', spring: TYPE, color: r === acc ? 'accent' : 'fg' }));
            return;
          }
          if (gg < 0.999) { // the rows converge on the centre and grow into the one big row (in flight: unlogged)
            [...fits.keys()].sort((a, b) => Math.abs(b - acc) - Math.abs(a - acc)).forEach((r) => {
              const ft = fits[r], l = ft.lines[0], c = [l.x + l.w / 2, l.y - ft.cap / 2], k = M.lerp(1, big.size / ft.size, gg);
              ctx.save(); ctx.translate(M.lerp(c[0], bc[0], gg), M.lerp(c[1], bc[1], gg)); ctx.scale(k, k);
              T.drawText(ctx, theme, l.s, 0, ft.cap / 2, { role: 'display', size: ft.size, align: 'c', color: r === acc ? 'accent' : 'fg', log: false });
              ctx.restore();
            });
            return;
          }
          if (p <= 0.002) { T.drawFit(ctx, theme, big, { color: 'fg' }); return; }
          // the slice: the halves leave the frame and the band opens from the cut line, revealing the second word
          const o = p * F.h * 0.62, row = () => T.drawText(ctx, theme, bl.s, bl.x, bl.y, { role: 'display', size: big.size, color: 'fg', log: false });
          D.withClip(ctx, (c) => c.rect(0, 0, F.w, mid - o), () => { ctx.translate(0, -o); row(); });
          D.withClip(ctx, (c) => c.rect(0, mid + o, F.w, F.h), () => { ctx.translate(0, o); row(); });
          const h = band.h * p, cy = M.lerp(mid, bmid, p), open = { x: 0, y: cy - h / 2, w: F.w, h };
          const bb = L.lerpBox(open, F.full, fl(f.lb));
          D.fillBox(ctx, bb, 'accent');
          const show = () => revFits.forEach((ft) => T.drawFit(ctx, theme, ft, { color: 'bg' }));
          D.withClip(ctx, (c) => c.rect(bb.x, bb.y, bb.w, bb.h), () => (p > 0.98 ? show() : T.quiet(show)));
        },
        dot: (lb) => {
          const a = period(fits[acc]), b = period(big), last = period(revFits[revFits.length - 1]);
          const pre = lerpPt(a, b, g(lb)), hop = M.sp(dsec(lb, sliceAt + 0.25), UI);
          const pt = lerpPt([pre[0], pre[1] + sl(lb) * F.h * 0.62, pre[2]], last, M.clamp(hop));
          return [...pt, hop > 0.5 ? 'bg' : 'accent'];
        },
      };
    },
    montage(s, i, nb) {
      const words = need(s, i, 'lines'), pay = s.text, n = words.length, box = L.inset(S, { r: room });
      const payBeats = pay ? nb - n : 0;
      if (payBeats < (pay ? 1 : 0) || (!pay && nb < n)) throw new Error(`showreel: shots[${i}] montage needs ${n} beats (one per word)${pay ? ' + at least 1 for the payoff' : ''}, has ${nb}`);
      const stacked = (lines, align) => fitD(lines.join('\n'), box, { leading: 0.86, align, valign: 'c', max: S.h, min: R(1.4) });
      const cover = (ft) => ft.lines.reduce((a, l) => a + l.w, 0) * ft.cap;
      const layout = (w) => { // the fit that inks the most of the safe area; portrait may bleed one letter per row
        const c = [T.tryFit(ctx, theme, w, { role: 'display', box, valign: 'c', max: S.h, min: R(1.4) })];
        const len = [...w].length;
        if (F.orient !== 'h' && len >= 7) { const k = Math.ceil(len / 2); c.push(stacked([w.slice(0, k), w.slice(k)], 'l')); }
        if (F.orient === 'v' && len > 1 && len <= 5 && !/\s/.test(w)) c.push(stacked([...w], 'c'));
        const best = c.reduce((a, b) => (cover(b) > cover(a) ? b : a));
        return best === c[0] ? fitD(w, box, { valign: 'c', max: S.h, min: R(1.4) }) : best;
      };
      const fits = words.map(layout), fieldOf = (k) => FIELDS[k % FIELDS.length];
      const stops = words.map((w) => (endsInNumber(w) ? 0 : 1)), payStop = pay && endsInNumber(pay) ? 0 : 1; // no dot after a number
      const payFits = pay ? B.justifyFits(api, pay.split(/\s+/), box, { align: 'l' }) : [];
      const payAt = (j) => n + Math.min(j * 0.5, Math.max(0, payBeats - 1)), dotAt = pay ? payAt(payFits.length - 1) + 0.5 : 0;
      const ctr = (ft) => [ft.box.x + ft.box.w / 2, ft.box.y + ft.box.h / 2];
      const curOf = (lb) => Math.max(0, Math.min(pay ? n : n - 1, Math.floor(lb + 1e-6)));
      return {
        pre: 0, // every word is a hard cut ON the beat; the cut frame is the slam's first frame
        jump: true,
        events: [...words.map((_, k) => k), ...payFits.map((_, j) => payAt(j))],
        sfx: [...words.map((_, k) => ({ at: k, sfx: 'pop', gain_db: -11 + k * 1.5 })), ...words.map((_, k) => ({ at: k, sfx: 'tick', gain_db: -12 })),
          ...payFits.map((_, j) => ({ at: q(payAt(j)), sfx: j ? 'pop' : 'thump', gain_db: j ? -6 : -4 }))],
        draw(f) {
          const cur = curOf(f.lb), C = fieldInk(api, fieldOf(cur));
          D.fillBox(ctx, F.full, C.field);
          if (cur < n) { const ft = fits[cur]; drawScaled(ft, ctr(ft), 1 + 0.12 * (1 - M.clamp(after(f.lb, cur, SLAM))), C.ink); return; }
          payFits.forEach((ft, j) => { if (f.lb >= payAt(j)) drawScaled(ft, ctr(ft), 1 + 0.12 * (1 - M.clamp(after(f.lb, payAt(j), SLAM))), C.ink); });
        },
        dot: (lb) => {
          const cur = curOf(lb), C = fieldInk(api, fieldOf(cur));
          if (cur < n) { // the full stop scales with the word's slam
            const ft = fits[cur], c = ctr(ft), k = 1 + 0.12 * (1 - M.clamp(after(lb, cur, SLAM))), [x, y, r] = period(ft);
            return [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k, r * k * stops[cur], C.dot];
          }
          const [x, y, r] = period(payFits[payFits.length - 1]);
          return [x, y, r * M.clamp(after(lb, dotAt, UI), 0, 1.1) * payStop, C.dot];
        },
      };
    },
  };
}
