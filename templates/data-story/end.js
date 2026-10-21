// end.js: the data-story close, a kinetic lockup that is the same composition in every aspect: the hero number at
// ~90% of the safe width at the optical centre, the carried wedge flattened into its underline, the takeaway under
// it, one source line, the brand on the last beat.
// beat 0: the number slams on the cut (music drop) while the previous shot's accent wedge flattens into the underline
// beats 1..b-5: the takeaway lands word by word; b-4: the underline runs out to both frame edges; b-3: the source
// line; b-2: the accent word flips; b-1 (last beat): the brand stamps with the last hit and a number punch.
// Events and cues are functions of the real scene length (fill / cutdowns).
import { TYPE, smooth, numOpts, accentUnits } from './lib.js';
import { inkOn } from './ink.js';

export function endScene(api, fmt) {
  const { F, ctx, theme, T, M, D, data, project } = api;
  const S = F.safe;
  const name = project.brand && project.brand.name;
  const nSize = T.readable(F, 1.4), brandH = name ? nSize * 2.4 : 0;
  const Rg = { x: S.x, y: S.y, w: S.w, h: S.h - brandH };
  const numStr = data.hero ? fmt(data.hero.value, numOpts(data.hero)) : null;
  const capK = T.measure(ctx, theme, 'display', '0', 100).cap / 100;
  const nw100 = numStr ? T.measure(ctx, theme, 'display', numStr, 100).w / 100 : 1;
  const N = numStr ? Math.min((S.w * 0.9) / nw100, (Rg.h * F.pick({ v: 0.3, s: 0.34, h: 0.44 })) / capK) : 0;
  const capN = N * capK, nw = nw100 * N;
  const st = Math.max(14 * F.u, N * 0.06), g1 = N * 0.12;
  const tkW = numStr ? Math.max(nw, S.w * 0.6) : S.w * 0.9;
  const tkOpts = (y) => ({ role: 'display', lines: 'auto', leading: 1.0, max: T.readable(F, F.pick({ v: 3.2, s: 2.6, h: 2.8 })), min: T.readable(F, 1.3),
    box: { x: S.x, y, w: tkW, h: T.readable(F, F.pick({ v: 3.2, s: 2.6, h: 2.8 })) * 3.3 } });
  const probe = T.tryFit(ctx, theme, data.takeaway, tkOpts(0));
  const g2 = probe.size * 0.5, g3 = T.readable(F, 1.0), sSize = T.readable(F, 1.0);
  // one source line (the title already opened the film); wraps only when it cannot fit one line at a readable size
  const srcOpts = (y, lines) => ({ role: 'ui', lines, leading: 1.3, max: sSize, min: T.readable(F, 0.9), box: { x: S.x, y, w: S.w, h: sSize * (lines === 1 ? 1.4 : 4) } });
  const srcTxt = data.source || data.title || null;
  const srcLines = srcTxt && !T.tryFit(ctx, theme, srcTxt, srcOpts(0, 1)).overflow ? 1 : 'auto';
  const srcProbe = srcTxt ? T.tryFit(ctx, theme, srcTxt, srcOpts(0, srcLines)) : null;
  const H = capN + g1 + st + g2 + probe.box.h + (srcProbe ? g3 + srcProbe.box.h : 0);
  // the slam scales the number up to 6% from its baseline, so the block keeps that much headroom under the safe top
  const head = capN * 0.07;
  const top = Rg.y + head + Math.max(0, Rg.h - H - head) * 0.5;
  const nb = top + capN, stY = nb + g1, tkTop = stY + st + g2;
  const tk = T.fitText(ctx, theme, data.takeaway, tkOpts(tkTop));
  const accent = accentUnits(api, tk, data.takeawayAccent);
  const nWords = T.kineticUnits(ctx, theme, tk, 'word').length;
  const src = srcTxt ? T.fitText(ctx, theme, srcTxt, srcOpts(tkTop + tk.box.h + g3, srcLines)) : null;
  const nameY = S.y + S.h - nSize * 0.1;
  const plan = (b) => {
    const lastAt = Math.max(1, b - 1), flipAt = Math.max(1, b - 2), srcAt = Math.max(1, b - 3), extAt = Math.max(1, b - 4), wEnd = Math.max(1.5, b - 5);
    return { slamAt: 0, wordsAt: 1, wEnd, extAt, srcAt, flipAt, lastAt };
  };
  const stripe = (f, P) => {
    const ext = M.clamp(M.sp(f.since(P.extAt), smooth(0.35)));
    const x0 = S.x + (F.full.x - S.x) * ext, x1 = S.x + nw + (F.full.x + F.full.w - S.x - nw) * ext;
    return { kind: 'rect', x: x0, y: stY, w: x1 - x0, h: st, color: 'accent' };
  };
  return { beats: 'fill',
    events: (b) => { const P = plan(b); return [P.wordsAt, P.wEnd, P.extAt, P.srcAt, P.flipAt, P.lastAt].filter((e, i, a) => e < b && a.indexOf(e) === i); },
    sfx: (b) => { const P = plan(b); return [{ at: P.slamAt, sfx: 'thump', gain_db: -1 }, { at: P.wordsAt, sfx: 'tick', gain_db: -12 }, { at: P.extAt, sfx: 'swish', gain_db: -9 },
      { at: P.srcAt, sfx: 'tick', gain_db: -12 }, { at: P.flipAt, sfx: 'pop', gain_db: -7 }, { at: P.lastAt, sfx: 'thump', gain_db: 0 }]; },
    handIn(f) { return stripe(f, plan(f.scene.beats)); },
    draw(f, mp = 1) {
      const P = plan(f.scene.beats);
      if (mp >= 0.995) D.fillBox(ctx, stripe(f, P), 'accent');
      if (numStr) {
        const k = 1 + 0.06 * (1 - M.clamp(M.sp(f.since(P.slamAt), 'snap'))) + 0.03 * f.hit(P.lastAt, 0.25, 'snap');
        ctx.save(); ctx.translate(S.x, nb); ctx.scale(k, k); ctx.translate(-S.x, -nb);
        T.drawText(ctx, theme, numStr, S.x, nb, { role: 'display', size: N, color: 'accent' });
        ctx.restore();
      }
      const stg = nWords > 1 ? (P.wEnd - P.wordsAt) / (nWords - 1) : 0;
      T.kinetic(f, tk, { by: 'word', at: P.wordsAt, stagger: stg, from: 'mask', spring: TYPE, accent: f.since(P.flipAt) >= 0 ? accent : [] });
      if (src) T.kinetic(f, src, { by: 'line', at: P.srcAt, stagger: 0.12, from: 'below', spring: TYPE, color: inkOn(api, 'muted', 'bg', src.size) });
      if (name && f.since(P.lastAt) > 0) {
        const p = M.clamp(M.sp(f.since(P.lastAt), 'snap'), 0, 1.02);
        D.fillBox(ctx, { x: S.x, y: nameY - nSize * 0.72, w: nSize * 0.42, h: nSize * 0.72 * p }, 'accent');
        D.withClip(ctx, (c) => c.rect(S.x, nameY - nSize * 1.1, S.w, nSize * 1.35), () =>
          T.drawText(ctx, theme, name, S.x + nSize * 0.75, nameY + (1 - M.clamp(p)) * nSize * 1.1, { role: 'display', size: nSize, rest: [S.x + nSize * 0.75, nameY] }));
      }
    } };
}
