// showreel: a kinetic-type studio reel. Every shot is a different technique, cut fast on the beat. An accent dot
// (the motif) travels across every cut: it is the full stop, the bullet, the band's leading edge. The film loops:
// the end card pushes up and out as shot 1 pushes in on the loop point. All copy, data and colours come from content.
import { fieldInk } from './ink.js';
import { moreTech, maskUnit } from './shots.js';
import { middleTech } from './middle.js';
import { finaleTech } from './finale.js';
const TYPE = [0.35, 1]; // critically damped: type never overshoots
const UI = [0.28, 0.8];   // about 1.5 % overshoot: tiles, pills and the dot settle with a tiny bounce
const AUTO = ['push', 'cut', 'wipe', 'cut', 'slats', 'cut', 'iris', 'cut'];
const DIRS = ['l', 'u', 'r', 'd'];
const q = (b) => Math.round(b * 4) / 4; // sfx land on 1/4 beats so cues.py never sees an off-grid hit
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export default {
  id: 'showreel',
  build(api) {
    const { F, data, theme, ctx, grid, M, L, T, D, B } = api;
    const spb = grid.spb, S = F.safe, R = (k) => T.readable(F, k);
    const capR = T.measure(ctx, theme, 'display', 'H', 100).cap / 100;
    const motif = (data.motif || 'dot') === 'dot';
    const need = (s, i, key) => {
      const v = s[key];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) throw new Error(`showreel: shots[${i}] (${s.technique}) needs "${key}"`);
      return v;
    };
    const dotR = (size) => Math.max(10 * F.u, size * capR * 0.15);
    /** The dot as a full stop after line li of a fit: [x, y, r]. */
    const period = (ft, li = ft.lines.length - 1) => { const l = ft.lines[li], r = dotR(ft.size); return [l.x + l.w + r * 1.5, l.y - r, r]; };
    const room = S.w * 0.08; // right-hand space kept free for the full stop
    const fitD = (str, box, o = {}) => T.fitText(ctx, theme, str, { role: 'display', box, max: box.h, min: R(1.2), lines: 1, ...o });
    const dsec = (lb, at) => (lb - at) * spb;
    const hide = (pt) => [pt[0], pt[1], 0];
    const BLOCKS = new Set(['statement', 'chart', 'steps', 'uiShot']);
    // E: the build environment shared with shots.js. sources/mini let the formats shot replay earlier shots live.
    const E = { api, data, F, S, T, M, L, D, B, ctx, theme, spb, R, capR, dotR, period, room, fitD, dsec, need, norm, q, TYPE, UI,
      sources: (i, n) => { // up to n earlier custom shots, spread evenly through the film so far
        const c = data.shots.map((s, j) => j).filter((j) => j < i && !BLOCKS.has(data.shots[j].technique) && data.shots[j].technique !== 'formats');
        return c.length <= n ? c : Array.from({ length: n }, (_, k) => c[Math.round((k * (c.length - 1)) / (n - 1))]);
      },
      mini: (j, f, t) => { // shot j drawn at its own clock, t beats into its replay, into the current transform, unlogged
        const b = built[j], lb = Math.min(pre[j] + b.nb * 0.4 + Math.max(0, t), pre[j] + b.nb - 0.3);
        T.quiet(() => { D.fillBox(ctx, F.full, b.C.field); b.draw(shift(f, lb - f.lb)); });
      } };
    E.mask = (u, ft, pIn, pOut, color) => maskUnit(E, u, ft, pIn, pOut, color);
    const tech = {
      stack(s, i, nb) { // the word echoed down the frame; rows mask in, then shear apart on the beat
        const word = need(s, i, 'text'), n = F.pick({ v: 7, s: 5, h: 4 }), acc = Math.floor(n / 2);
        const rows = L.split(S, Array(n).fill(1), { axis: 'y', gap: S.h * 0.02 });
        const fits = rows.map((r) => fitD(word, { x: S.x + S.w * 0.1, y: r.y, w: S.w * 0.8, h: r.h }, { valign: 'c' }));
        // back half: the echoes leave up through their masks (outward from the middle) and the accent row grows to
        // ~90 % of the frame width: a single-word scale punch that hands off into the next shot
        const shAt = Math.min(1, nb - 1.5), exAt = Math.max(shAt + 0.75, nb - 1);
        const grow = (lb) => Math.max(0, M.sp(dsec(lb, exAt + 0.25), TYPE));
        const shear = (lb, r) => (r % 2 ? 1 : -1) * S.w * 0.1 * M.sp(dsec(lb, shAt), TYPE) * (r === acc ? 1 - grow(lb) : 1);
        const out = (lb, r) => Math.max(0, M.sp(dsec(lb, exAt + Math.abs(r - acc) * 0.0625), TYPE));
        const af = fits[acc], al = af.lines[0], ac = [al.x + al.w / 2, al.y - af.cap / 2];
        const kTo = Math.min((F.w * 0.9) / al.w, (S.h * 0.45) / af.cap), kOf = (lb) => 1 + (kTo - 1) * grow(lb);
        return {
          pre: 0.5, // enters on a hard cut: half a beat of pre-roll puts 4+ rows on the cut frame
          events: [0, shAt, exAt], sfx: [0, 1, 2, 3].map((r) => ({ at: q(r * 0.125), sfx: 'tick', gain_db: -16 })).concat({ at: shAt, sfx: 'thump', gain_db: -4 }, { at: exAt, sfx: 'swish', gain_db: -8 }), // same in every format
          draw(f) {
            fits.forEach((ft, r) => {
              if (r === acc) return;
              const o = out(f.lb, r), col = r % 2 ? 'fg' : 'muted';
              ctx.save(); ctx.translate(shear(f.lb, r), 0);
              if (o <= 0) T.kinetic(f, ft, { by: 'line', at: r * 0.125, from: 'mask', spring: TYPE, color: col });
              else maskUnit(E, ft.lines[0], ft, 1, o, col);
              ctx.restore();
            });
            const g = grow(f.lb), k = kOf(f.lb);
            if (g <= 0) {
              ctx.save(); ctx.translate(shear(f.lb, acc), 0);
              T.kinetic(f, af, { by: 'line', at: acc * 0.125, from: 'mask', spring: TYPE, color: 'accent' });
              ctx.restore();
            } else T.drawText(ctx, theme, al.s, ac[0] + shear(f.lb, acc), ac[1] + (af.cap * k) / 2, { role: 'display', size: af.size, sx: k, sy: k, align: 'c', color: 'accent', bleed: true, log: g > 0.999 });
          },
          dot: (lb) => { const [x, y, r] = period(af), k = kOf(lb), dx = shear(lb, acc); return [ac[0] + dx + (x - ac[0]) * k, ac[1] + (y - ac[1]) * k, r * k]; },
        };
      },
      split(s, i, nb) { // the word is sliced at its cap-middle; the halves part and a full-bleed accent band opens in the gap, carrying the sub in bg
        const word = need(s, i, 'text'), sub = need(s, i, 'sub');
        // the closed word is centred in safe; once open, cap + gap stays inside safe and the gap is about one cap tall
        const box = L.place(L.inset(S, { r: room }), { w: S.w - room, h: S.h * F.pick({ v: 0.3, s: 0.34, h: 0.4 }) }, 'w');
        const ft = fitD(word, box, { valign: 'c' }), mid = ft.lines[0].y - ft.cap / 2;
        // the halves part further than the band opens: a strip of bg (>= 0.15 cap) shows between each cut edge and
        // the band, so the shot reads as a word sliced and pulled apart, not a bar laid over a word
        const part = Math.min(ft.cap * 1.25, (S.h - ft.cap) * 0.92), bandH = Math.min(ft.cap * 0.7, part - ft.cap * 0.3);
        if (bandH < ft.cap * 0.45 || (part - bandH) / 2 < ft.cap * 0.1) api.warn(`showreel: shots[${i}] split has no room to part (band ${Math.round(bandH)}px, cap ${Math.round(ft.cap)}px)`);
        const subFit = fitD(sub, { x: S.x + room / 2, y: mid - bandH * 0.3, w: S.w - room, h: bandH * 0.6 }, { valign: 'c', align: 'c', min: R(1.5) });
        const at = Math.min(1.5, nb - 1.5), pOpen = (lb) => Math.max(0, M.sp(dsec(lb, at), TYPE));
        const open = (lb) => (pOpen(lb) * part) / 2, bandO = (lb) => (pOpen(lb) * bandH) / 2;
        const subAt = at + 0.375; // TYPE reaches 0.8 at ~0.34 beat: the sub rises only once the band is almost open
        return {
          pre: 0.75, // the word is up and whole on the cut frame and reads whole for ~3/4 beat before it slices
          jump: true, // the dot parks on the full stop on the cut (the stack hands over an enlarged dot that would overlap the word)
          events: [0, at], sfx: [{ at: 0, sfx: 'pop', gain_db: -8 }, { at, sfx: 'thump', gain_db: -4 }],
          draw(f) {
            const o = open(f.lb), bo = bandO(f.lb), word = () => T.kinetic(f, ft, { by: 'char', at: 0, stagger: 0.06, from: 'mask', spring: TYPE });
            if (o <= 0.5) { word(); return; }
            // while the halves part they are in flight: unlogged (their glyph boxes sweep over the opening band)
            const half = pOpen(f.lb) < 0.98 ? (fn) => T.quiet(fn) : (fn) => fn();
            D.withClip(ctx, (c) => c.rect(0, 0, F.w, mid - o), () => { ctx.translate(0, -o); half(word); });
            D.withClip(ctx, (c) => c.rect(0, mid + o, F.w, F.h), () => { ctx.translate(0, o); half(word); });
            const band = { x: 0, y: mid - bo, w: F.w, h: 2 * bo };
            D.fillBox(ctx, band, 'accent');
            // the sub lives only inside the band, so it can never collide with the halves' cut edges
            if (f.lb >= subAt) D.withClip(ctx, (c) => c.rect(band.x, band.y, band.w, band.h), () => T.kinetic(f, subFit, { by: 'word', at: subAt, stagger: 0.125, from: 'mask', spring: TYPE, color: 'bg' }));
          },
          dot: (lb) => { // rides the lower half's baseline, then hops onto the band as the sub's full stop (in bg)
            const a = period(ft), b = period(subFit), p = M.sp(dsec(lb, subAt + 0.25), UI);
            return [M.lerp(a[0], b[0], p), M.lerp(a[1] + open(lb), b[1], p), M.lerp(a[2], b[2], p), p > 0.5 ? 'bg' : 'accent'];
          },
        };
      },
      ticker(s, i, nb, id, { C }) { // full-bleed marquees in opposite directions; the accent row brakes, locks its word whole, a band wipes it
        const lines = need(s, i, 'lines'), sep = ' / ', nl = lines.length, gapR = S.h * 0.03, track = (sz) => (theme.fonts.display.tracking || 0) * sz;
        const ai = lines.findIndex((l) => norm(l) === norm(s.accent)), accL = ai >= 0 ? ai : Math.min(1, nl - 1);
        const wordW = (l, sz) => T.measure(ctx, theme, 'display', l, sz).w + Math.abs(track(sz)) * [...l].length;
        const sizeW = (S.w * 0.92 * 100) / Math.max(...lines.map((l) => wordW(l, 100))); // every word fits the safe width whole
        const rowH = (n) => (S.h - gapR * (n - 1)) / n;
        let n = nl; while (n < 7 && (rowH(n + 1) * 0.8) / capR >= sizeW) n++; // portrait: more rows (words repeat) to fill the height
        const rows = L.split(S, Array(n).fill(1), { axis: 'y', gap: gapR }), size = Math.min((rowH(n) * 0.8) / capR, sizeW);
        const acc = Math.floor((n - 1) / 2), lineOf = (k) => lines[(((k - acc + accL) % nl) + nl) % nl];
        const sepOf = (k) => (k === acc ? '      ' : sep); // the locked row has no slash, so the dot reads as a full stop, not '/.'
        const unit = rows.map((_, k) => T.measure(ctx, theme, 'display', lineOf(k) + sepOf(k), size).w + track(size));
        const v = F.w * 0.35, tau = 0.15, bandAt = Math.min(1.5, nb - 1), tb = bandAt * spb;
        const aw = wordW(lineOf(acc), size), target = S.x + (S.w - aw) / 2, baseOf = (r) => r.y + r.h / 2 + (size * capR) / 2;
        const band = (lb) => M.clamp(M.sp(dsec(lb, bandAt), UI), 0, 1.02), r0 = dotR(size) * 0.8;
        // accent row: constant speed, then an exponential brake that comes to rest with the word centred in safe (C1 at tb)
        const accX = (lt, dir) => { const u = lt - tb; return target - dir * v * tau + dir * (u < 0 ? v * u : v * tau * (1 - Math.exp(-u / tau))); };
        return {
          events: [0, bandAt], sfx: [...lines.map((_, k) => ({ at: q(k * 0.25), sfx: 'swish', gain_db: -12 })), { at: bandAt, sfx: 'thump', gain_db: -4 }],
          draw(f) {
            // every row is already running on the cut frame (a hard cut into motion, no slide-in, no empty downbeat)
            const accC = C.field === 'bg' ? 'accent' : C.ink;
            rows.forEach((r, k) => {
              const dir = k % 2 ? 1 : -1, xw = k === acc ? accX(f.lt, dir) : f.lt * v * dir + k * unit[k] * 0.37;
              const x0 = M.mod(xw, unit[k]) - unit[k];
              const str = (lineOf(k) + sepOf(k)).repeat(Math.ceil(F.w / unit[k]) + 2);
              const row = (color) => T.drawText(ctx, theme, str, x0, baseOf(r), { role: 'display', size, color, bleed: true });
              const bw = k === acc ? F.w * band(f.lb) : 0;
              // the accent copy only exists where the band has not wiped yet (never drawn hidden under the band)
              if (k !== acc) row(C.ink);
              else if (bw < F.w) D.withClip(ctx, (c) => c.rect(bw, r.y - r.h, F.w - bw, r.h * 3), () => row(accC));
              if (bw > 0) {
                const bb = { x: 0, y: r.y, w: bw, h: r.h };
                D.fillBox(ctx, bb, C.hot);
                D.withClip(ctx, (c) => c.rect(bb.x, bb.y, bb.w, bb.h), () => row(C.onHot));
              }
            });
          },
          dot: (lb) => { // rides the band's leading edge on the baseline, stops as the locked word's full stop, flips to bg on the band
            const bw = F.w * band(lb), x = M.clamp(Math.min(bw + r0 * 2, target + aw + r0 * 1.8), S.x + r0, S.x + S.w - r0);
            return [x, baseOf(rows[acc]) - r0, r0, bw >= x + r0 ? C.onHot : C.field === 'bg' ? 'accent' : C.ink];
          },
        };
      },
      scale(s, i, nb) { // the hook: an accent flood with bg type that SLAMS in from 6x (impact on beat 0.5 = frame 0 when it
        // opens the loop), then the field splits open from the centre and the type inverts to accent on bg
        const ft = fitD(need(s, i, 'text'), L.inset(S, { t: S.h * 0.03, b: S.h * 0.03, l: S.w * 0.02, r: room }), { lines: 'auto', leading: 0.92, valign: 'c' });
        const [cx, cy] = L.center(ft.box), IMP = 0.5, splitAt = Math.min(1, nb - 0.75);
        const kOf = (lb) => (lb < IMP ? 1 + 5 * (1 - (lb / IMP) ** 2) : 1 + 0.03 * M.pulse(dsec(lb, 0), dsec(IMP, 0), 0.06));
        const gap = (lb) => M.clamp(Math.max(0, M.sp(dsec(lb, splitAt), TYPE))) * (F.w / 2 + 2);
        return {
          pre0: IMP, // as the loop opener: frame 0 is the impact frame and its thump lands on beat 0
          pre: IMP,
          events: [0, IMP, splitAt], sfx: [{ at: 0, sfx: 'swish', gain_db: -8 }, { at: IMP, sfx: 'thump', gain_db: -3 }, { at: splitAt, sfx: 'swish', gain_db: -10 }],
          draw(f) {
            const k = kOf(f.lb), g = gap(f.lb), closed = g <= 0.5, open = g >= F.w / 2;
            const type = (color, log) => {
              ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
              const fn = () => T.drawFit(ctx, theme, ft, { color, bleed: k > 1.002 });
              if (log && k < 1.002) fn(); else T.quiet(fn);
              ctx.restore();
            };
            if (!open) D.withClip(ctx, (c) => { c.rect(0, 0, Math.max(0, F.cx - g), F.h); c.rect(F.cx + g, 0, Math.max(0, F.w - F.cx - g), F.h); },
              () => { D.fillBox(ctx, F.full, 'accent'); type('bg', closed); });
            if (!closed) D.withClip(ctx, (c) => c.rect(F.cx - g, 0, 2 * g, F.h), () => type('accent', open));
          },
          dot: (lb) => { const [x, y, r] = period(ft), k = kOf(lb), X = cx + (x - cx) * k; return [X, cy + (y - cy) * k, r * k, Math.abs(X - F.cx) < gap(lb) ? 'accent' : 'bg']; },
        };
      },
      metric(s, i, nb) { // a right-aligned accent numeral as big as the frame allows, stepping on 1/4 notes; the caption's full stop is the dot
        const d = need(s, i, 'data'), label = s.text;
        const fo = { from: d.from || 0, fmt: d.fmt || 'int', decimals: d.decimals || 0, suffix: d.unit || '', prefix: d.prefix || '' };
        const final = T.counterText(d.value, 1, fo), shiftFit = (ft, dy, dx = 0) => ({ ...ft, lines: ft.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })), box: { ...ft.box, x: ft.box.x + dx, y: ft.box.y + dy } });
        const fitN = (box, o) => T.fitText(ctx, theme, final, { role: 'display', box, max: S.h, min: R(2), lines: 1, align: 'r', ...o });
        const fitC = (box, o) => T.fitText(ctx, theme, label, { role: 'display', box, max: R(2.4), min: R(1.5), lines: 'auto', leading: 1.0, ...o });
        let numFit, capFit = null, bleed = false;
        if (F.orient === 'h') { // one baseline: the caption as a single line, its full stop, then the numeral filling the rest of the row
          const c0 = label ? fitC({ x: S.x, y: S.y, w: S.w * 0.5, h: R(2.4) }, { lines: 1, max: R(2.4) }) : null;
          const lead = c0 ? c0.box.w + dotR(c0.size) * 3 + S.w * 0.03 : 0;
          numFit = fitN({ x: S.x + lead, y: S.y, w: S.w - lead, h: S.h * 0.86 }, { valign: 'c' });
          if (c0) { const l = numFit.lines[0]; capFit = shiftFit(c0, l.y - c0.lines[0].y, l.x - S.w * 0.03 - dotR(c0.size) * 3 - c0.box.w - c0.box.x); }
        } else { // numeral edge to edge (bleed), caption right-aligned under it; the pair is centred vertically in safe
          bleed = true;
          const bx = F.w * 0.025, n0 = fitN({ x: bx, y: S.y, w: F.w - 2 * bx, h: S.h * F.pick({ v: 0.62, s: 0.6 }) }, { valign: 't' }), g = n0.size * 0.16;
          // wrap is decided once here, so the caption never re-flows while it masks in
          const c0 = label ? fitC({ x: S.x, y: S.y, w: S.w - room, h: Math.min(S.h - n0.cap - g, R(2.4) * 2.2) }, { align: 'r', min: R(2.2) }) : null;
          const top = S.y + (S.h - (n0.cap + (c0 ? g + c0.box.h : 0))) / 2;
          numFit = shiftFit(n0, top - n0.box.y);
          if (c0) capFit = shiftFit(c0, top + n0.cap + g - c0.box.y);
        }
        const nl = numFit.lines[0], countAt = 0.25, countB = Math.max(0.5, Math.min(1.5, nb - 1.5)), steps = Math.max(1, Math.round(countB * 4)), landAt = countAt + countB;
        const pAt = (lb) => Math.floor(M.clamp((lb - countAt) / countB) * steps + 1e-6) / steps; // one value per 1/4 note: it counts with intent
        const capAt = 0.125;
        return {
          pre: 0.5, // enters on a hard cut: numeral already up and counting on the cut frame
          events: [0, landAt].filter((b) => b < nb),
          sfx: [{ at: 0, sfx: 'pop', gain_db: -8 }, ...Array.from({ length: steps - 1 }, (_, k) => ({ at: q(countAt + (k + 1) * 0.25), sfx: 'tick', gain_db: -14 })), { at: q(landAt), sfx: 'thump', gain_db: -3 }],
          draw(f) {
            const txt = T.counterText(d.value, M.easeOutCubic(pAt(f.lb)), fo), w = T.measure(ctx, theme, 'display', txt, numFit.size).w;
            const nf = { ...numFit, lines: [{ ...nl, s: txt, x: nl.x + nl.w - w, w }] }, punch = 1 + f.hit(landAt, 0.1) * 0.035;
            const ax = nl.x + nl.w, ay = nl.y; // punch scales about the right end of the baseline, so the numeral never leaves safe on the right
            ctx.save(); ctx.translate(ax, ay); ctx.scale(punch, punch); ctx.translate(-ax, -ay);
            T.kinetic(f, nf, { by: 'line', at: 0, from: 'mask', spring: TYPE, color: 'accent', bleed });
            ctx.restore();
            if (capFit) T.kinetic(f, capFit, { by: 'word', at: capAt, stagger: 0.125, from: 'mask', spring: TYPE, color: 'fg' });
          },
          dot: () => (capFit ? period(capFit) : [nl.x - dotR(numFit.size) * 2, nl.y - dotR(numFit.size), dotR(numFit.size)]),
          jump: true, // enters on a hard cut: the dot is parked on the caption's full stop from the cut frame, it never flies over the mask
        };
      },
      // Library techniques (engine blocks). The dot ducks (shrinks in place) while a block holds the frame.
      statement: (s, i, nb, id) => B.statementBlock(api, { id, text: need(s, i, 'text'), sub: s.sub, beats: nb, layout: s.layout || 'bleed' }),
      chart: (s, i, nb, id, d = need(s, i, 'data')) => B.chartBlock(api, { id, beats: nb, claim: need(s, i, 'text'), chart: { type: d.type || 'bars', data: d.series, highlight: d.highlight, unit: d.unit, fmt: d.fmt, decimals: d.decimals } }),
      steps: (s, i, nb, id, ctxI) => B.stepBlock(api, { id, n: ctxI.step, total: ctxI.steps, title: need(s, i, 'text'), body: s.sub, beats: nb }),
      uiShot: (s, i, nb, id) => B.uiShotBlock(api, { id, beats: nb, screen: need(s, i, 'screen'), zoom: s.zoom, assemble: s.pieces || [], label: s.text }),
    };
    const more = Object.entries({ ...moreTech(E), ...middleTech(E), ...finaleTech(E) }).map(([k, fn]) => [k, (s, i, nb, id, x) => fn(s, i, nb, x.C)]);
    const techAll = { ...tech, ...Object.fromEntries(more) };
    // ---- beats: one shot may be "fill"; otherwise the shots must sum to the film length ----
    const shots = data.shots, total = grid.totalBeats;
    const fixed = shots.reduce((a, s) => a + (s.beats === 'fill' ? 0 : s.beats), 0), fills = shots.filter((s) => s.beats === 'fill').length;
    if (fills > 1) throw new Error('showreel: only one shot may use beats "fill"');
    if (!fills && Math.abs(fixed - total) > 1e-6) throw new Error(`showreel: shots sum to ${fixed} beats, the film needs ${total} (duration x bpm / 60, snapped to bars); set one shot to "fill"`);
    const beatsOf = shots.map((s) => (s.beats === 'fill' ? total - fixed : s.beats));
    const steps = shots.filter((s) => s.technique === 'steps').length;

    let step = 0, at = 0;
    const built = shots.map((s, i) => {
      const fn = techAll[s.technique];
      if (!fn) throw new Error(`showreel: shots[${i}] technique "${s.technique}" is not one of ${Object.keys(techAll).join(', ')}`);
      if (s.technique === 'steps') step++;
      const nb = beatsOf[i], id = `${String(i + 1).padStart(2, '0')}-${s.technique}`;
      const C = fieldInk(api, s.field || 'bg');
      const b = { id, ...fn(s, i, nb, id, { step, steps, C }), start: at, nb, C };
      at += nb;
      // Engine blocks log in-flight text at their first frame, so a block never enters on a hard cut (see README).
      const auto = AUTO[i % AUTO.length], type = !s.transition || s.transition === 'auto' ? (auto === 'cut' && !b.dot ? 'push' : auto) : s.transition;
      b.transition = type === 'cut' || nb < 1 ? undefined : { type, beats: 0.5, dir: DIRS[i % DIRS.length], origin: [0.5, 0.5] };
      return b;
    });
    // ---- pre-roll: every shot runs its own clock `pre` beats ahead, so the cut/reveal frame already shows type ----
    const loop = api.project.loop !== false, SEAM = 1, N = built.length, last = built[N - 1];
    const pre = built.map((b, k) => (k === 0 ? (loop ? b.pre0 ?? SEAM : 0.25) : b.pre ?? (b.transition ? 0.5 : 0.25)));
    const shift = (f, db) => { // a frame whose local clock is db beats later (same beat->sec mapping as the engine)
      const ds = db * spb, lt = f.lt + ds, since = (a) => f.since(a) + ds;
      return { ...f, lt, lb: f.lb + db, since, hit: (a, len = 0.08, s = 'snap') => M.pulse(lt, f.lt - f.since(a), len, s), on: (a, s = 'med') => M.sp(since(a), s) };
    };
    const P = (ref) => api.G.parseAt(ref, grid), uniq = (xs, key) => xs.filter((x, j) => xs.findIndex((y) => key(y) === key(x)) === j);
    const tailSfx = []; // shot 1's hits that fall before t=0 play at the end of the loop, where shot 1 is already on screen
    built.forEach((b, k) => {
      const moved = (b.sfx || []).map((m) => ({ ...m, at: P(m.at) - pre[k] }));
      if (k === 0 && loop) tailSfx.push(...moved.filter((m) => m.at < 0));
      b.sfx = uniq(moved.filter((m) => m.at >= 0 || !(k === 0 && loop)).map((m) => ({ ...m, at: q(Math.max(0, m.at)) })), (m) => `${m.at}|${m.sfx}`);
      b.events = uniq((b.events || []).map((e) => Math.max(0, P(e) - pre[k])), (e) => e);
    });
    // ---- the motif: springs from the previous shot's resting dot to this shot's, starting on the real cut ----
    const dotOf = (b, lb, prevPt) => (b.dot ? b.dot(lb) : hide(prevPt));
    const home = last.dot ? last.dot(last.nb + pre[N - 1]) : [S.x + S.w / 2, S.y + S.h / 2, 0];
    const ends = built.reduce((acc, b, k) => [...acc, dotOf(b, b.nb + pre[k], k ? acc[k - 1] : home)], []);
    const dotIn = (k, lb) => { // lb = shot k's own clock
      const b = built[k], prev = k ? ends[k - 1] : home, cur = dotOf(b, lb, prev);
      const p = b.jump || (k === 0 && loop) ? 1 : M.sp((lb - pre[k]) * spb, UI); // loop: the seam draws both dots itself
      return { x: M.lerp(prev[0], cur[0], p), y: M.lerp(prev[1], cur[1], p), r: Math.max(0, M.lerp(prev[2], cur[2], p)), color: cur[3] || b.C.dot };
    };
    const dotAt = (beat) => {
      if (loop && beat > grid.totalBeats - SEAM) return { x: 0, y: 0, r: 0, color: 'accent' }; // the seam push carries both full stops itself
      let k = 0;
      for (let j = 0; j < N; j++) if (built[j].start <= beat + 1e-9) k = j;
      return dotIn(k, beat - built[k].start + pre[k]);
    };
    // ---- loop seam: a vertical push. Over the last beat the settled end card slides up and out whole while shot 1
    // slides in from below, each carrying its own full stop, so no mask edge ever slices a glyph. Shot 1 lands exactly
    // on the loop point, so both sides of the seam are the same frame of shot 1 (no empty frame, no jump). ----
    const disc = (pt) => { if (motif && pt && pt[2] > 0.25) D.disc(ctx, pt[0], pt[1], pt[2], pt[3] || 'accent'); };
    const scenes = built.map((b, k) => {
      const field = b.C.field; // a colour-field shot paints its field under everything it draws
      let draw = field === 'bg' ? (f) => b.draw(shift(f, pre[k])) : (f) => { D.fillBox(ctx, F.full, field); b.draw(shift(f, pre[k])); };
      const tr = b.transition;
      if (tr && tr.type === 'wipe') { // a wipe carries a hard accent leading edge, so the two shots never meet edge to edge
        const own = draw, ew = Math.max(8 * F.u, (tr.dir === 'u' || tr.dir === 'd' ? F.h : F.w) * 0.025);
        draw = (f) => {
          own(f);
          const p = f.lb / tr.beats;
          if (p <= 0 || p >= 1) return;
          const e = M.easeInOutCubic(p), d = tr.dir || 'l';
          if (e * (d === 'u' || d === 'd' ? F.h : F.w) < ew) return; // the edge appears whole, never as a sliver
          const box = d === 'r' ? { x: F.w * e - ew, y: 0, w: ew, h: F.h } : d === 'l' ? { x: F.w * (1 - e), y: 0, w: ew, h: F.h }
            : d === 'd' ? { x: 0, y: F.h * e - ew, w: F.w, h: ew } : { x: 0, y: F.h * (1 - e), w: F.w, h: ew };
          D.fillBox(ctx, box, 'accent');
        };
      }
      if (k === N - 1 && loop) {
        const closeAt = b.nb - SEAM, own = draw;
        draw = (f) => {
          const lc = (f.lb - closeAt) / SEAM;
          if (lc <= 0) { own(f); return; }
          const dy = F.h * M.easeInOutCubic(lc), lb0 = f.lb + pre[0] - b.nb, first = built[0];
          ctx.save(); ctx.translate(0, -dy); own(f); disc(b.dot && b.dot(f.lb + pre[k])); ctx.restore();
          ctx.save(); ctx.translate(0, F.h - dy); D.fillBox(ctx, { x: 0, y: 0, w: F.w, h: F.h }, first.C.field);
          first.draw(shift(f, pre[0] - b.nb));
          const d0 = first.dot && first.dot(lb0); // shot 1's full stop grows in as its last word rises, never hovering alone
          if (d0) disc([d0[0], d0[1], d0[2] * M.clamp((lc - 0.5) / 0.4), d0[3]]);
          ctx.restore();
          // a template-drawn push is a transition: drop its text log like the engine does for its own push frames
          // (lint skips in-transition frames; there is no API to flag one, see README Engine notes)
          T.resetLog('frame');
        };
        b.sfx = [...b.sfx.filter((m) => m.at < closeAt), { at: closeAt, sfx: 'swish', gain_db: -8 }, ...tailSfx.map((m) => ({ ...m, at: q(b.nb + m.at) }))];
        b.events = [...b.events.filter((e) => e < closeAt), closeAt];
      }
      return { id: b.id, beats: b.nb, draw, events: b.events, sfx: uniq(b.sfx, (m) => `${m.at}|${m.sfx}`), transition: b.transition };
    });
    const persistent = motif ? [{ id: 'motif', draw(f) { const d = dotAt(grid.at(f.t)); D.disc(ctx, d.x, d.y, d.r, d.color); } }] : [];
    return { scenes, persistent, loop };
  },
};
