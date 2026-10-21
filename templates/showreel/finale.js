// finale.js: the showreel's last act (r2 critique).
//  formats : ONE hero frame (~80 % of safe) that snaps its aspect on the beat (9:16 -> 1:1 -> 4:5 -> 16:9) while the
//            opener re-composes live inside it; the aspect name sits outside in display type. On the last beat the
//            16:9 frame slams out to full bleed and becomes the end card's field.
//  end     : that full-bleed field collapses into the accent slab as the name slams in whole on the downbeat; the
//            claim lands INSIDE the slab in display type; the slab punches; the card inverts; the seam pushes on.
const SLAM = [0.24, 1];
const COLLAPSE = [0.26, 1];
const ASPECTS = [[9 / 16, '9:16'], [1, '1:1'], [4 / 5, '4:5'], [16 / 9, '16:9']];

export function finaleTech(E) {
  const { api, F, S, T, M, L, D, ctx, theme, R, period, room, fitD, dsec, q, TYPE, UI } = E;
  const after = (lb, at, s = TYPE) => Math.max(0, M.sp(dsec(lb, at), s));
  /** The transform that maps box a onto box b uniformly (centre to centre). */
  const mapOf = (a, b) => { const k = Math.min(b.w / a.w, b.h / a.h); return { k, ax: a.x + a.w / 2, ay: a.y + a.h / 2, bx: b.x + b.w / 2, by: b.y + b.h / 2 }; };
  const apply = (m, pt) => [m.bx + (pt[0] - m.ax) * m.k, m.by + (pt[1] - m.ay) * m.k, pt[2] * m.k];
  return {
    formats(s, i, nb, C) {
      const shots = api.data.shots, inner = s.text || (shots[0] && shots[0].text) || 'ON THE BEAT';
      const h = F.orient === 'h';
      const [labBox, area0] = h ? L.split(S, [0.25, 0.75], { axis: 'x', gap: S.w * 0.03 }) : L.split(S, [0.18, 0.82], { axis: 'y', gap: S.h * 0.03 });
      const area = L.inset(area0, Math.min(area0.w, area0.h) * 0.02);
      const boxes = ASPECTS.map(([r]) => L.aspectFit(area, r));
      const fits = boxes.map((b) => { const m = Math.min(b.w, b.h) * 0.08; return fitD(inner, L.inset(b, { t: m, b: m, l: m, r: m + Math.min(b.w, b.h) * 0.08 }), { lines: 'auto', leading: 0.92, valign: 'c', max: b.h }); });
      const labOpts = { valign: h ? 'c' : 'b', max: h ? labBox.w : labBox.h };
      const lab0 = ASPECTS.map(([, t]) => fitD(t, labBox, labOpts)), labSize = Math.min(...lab0.map((f) => f.size));
      const labs = ASPECTS.map(([, t]) => fitD(t, labBox, { ...labOpts, max: labSize }));
      const last = ASPECTS.length - 1, expAt = Math.max(last + 1, nb - 1), labC = C.field === 'bg' ? 'accent' : C.ink;
      const kOf = (lb) => M.clamp(Math.floor(lb + 1e-6), 0, last);
      const state = (lb) => {
        const k = kOf(lb), from = k ? boxes[k - 1] : L.place(boxes[0], { w: boxes[0].w * 0.55, h: boxes[0].h * 0.55 });
        const p = M.clamp(after(lb, k, UI), 0, 1.04), e = M.clamp(after(lb, expAt, UI));
        const box = e > 0 ? L.lerpBox(boxes[last], F.full, e) : L.lerpBox(from, boxes[k], p);
        return { k, p, e, box, m: mapOf(boxes[k], box) };
      };
      return {
        events: [...ASPECTS.map((_, k) => k), expAt],
        sfx: [...ASPECTS.map((_, k) => ({ at: k, sfx: k === last ? 'thump' : 'pop', gain_db: k === last ? -6 : -11 + k * 2 })),
          ...ASPECTS.map((_, k) => ({ at: k, sfx: 'tick', gain_db: -14 + k * 2 })), { at: q(expAt), sfx: 'swish', gain_db: -6 }],
        draw(f) {
          const st = state(f.lb), { k, p, e, box, m } = st;
          ASPECTS.forEach((_, j) => { // the aspect name in display type, outside the frame; it changes through its mask
            if (j !== k && j !== k - 1) return;
            const ft = labs[j], pIn = M.sp(f.since(j), TYPE), pOut = j < k ? after(f.lb, k) : after(f.lb, expAt);
            if (f.lb >= j && pOut < 0.999) E.mask(ft.lines[0], ft, Math.max(0.0001, pIn), pOut, labC);
          });
          D.fillBox(ctx, box, 'accent');
          const zoom = 1 + 0.15 * e, // the opener rides the frame out to full bleed: the last frame rhymes with the hook
            rest = p > 0.985 && e === 0;
          D.withClip(ctx, (c) => c.rect(box.x, box.y, box.w, box.h), () => {
            ctx.translate(m.bx, m.by); ctx.scale(m.k * zoom, m.k * zoom); ctx.translate(-m.ax, -m.ay);
            const fn = () => T.drawFit(ctx, theme, fits[k], { color: 'bg', bleed: !rest });
            if (rest) fn(); else T.quiet(fn);
          });
        },
        dot: (lb) => { const { k, e, m } = state(lb), [x, y, r] = apply(m, period(fits[k])); return [x, y, r * (1 + 0.15 * e), 'bg']; },
      };
    },
    end(s, i, nb, C) {
      const name = E.need(s, i, 'text'), claim = s.sub, o = F.orient;
      const nameBox = o === 'h' ? { x: S.x, y: S.y, w: S.w * 0.5, h: S.h } : { x: S.x, y: S.y, w: S.w, h: S.h * (o === 'v' ? 0.3 : 0.36) };
      const slab = o === 'h' ? { x: S.x + S.w * 0.54, y: S.y, w: S.w * 0.46, h: S.h } : { x: S.x, y: S.y + S.h * (o === 'v' ? 0.36 : 0.42), w: S.w, h: S.h * (o === 'v' ? 0.64 : 0.58) };
      const ft = fitD(name, L.inset(nameBox, { r: room * 0.6 }), { lines: 'auto', leading: 0.9, valign: o === 'h' ? 'c' : 't' });
      const pad = Math.min(slab.w, slab.h) * 0.1;
      const cf = claim ? fitD(claim, L.inset(slab, pad), { lines: 'auto', leading: 0.95, valign: 'c', max: slab.h, min: R(1.4) }) : null;
      const landAt = 0.5, claimAt = 1.5, punchAt = Math.min(2.5, nb - 1), invAt = nb - 0.75;
      const nc = [ft.box.x + ft.box.w / 2, ft.box.y + ft.box.h / 2], sc = L.center(slab);
      const inv = (lb) => lb >= invAt;
      return {
        pre: 0.5, // the name's slam starts a 1/16 before the bar downbeat so it LANDS on it; the field collapses with it, so the cut frame is already the slab mid-snap
        events: [0, landAt, claimAt, punchAt, invAt],
        sfx: [{ at: landAt, sfx: 'thump', gain_db: -1 }, { at: landAt, sfx: 'riser', dur: 'b3', gain_db: -9 }, { at: claimAt, sfx: 'pop', gain_db: -6 },
          { at: punchAt, sfx: 'thump', gain_db: -6 }, { at: q(invAt), sfx: 'thump', gain_db: -2 }],
        draw(f) {
          const iv = inv(f.lb), ink = iv ? 'bg' : C.ink;
          if (iv) D.fillBox(ctx, F.full, 'fg');
          const c = M.clamp(after(f.lb, landAt - 0.25, COLLAPSE)), pk = 1 + f.hit(punchAt, 0.12) * 0.035 + (iv ? f.hit(invAt, 0.12) * 0.035 : 0);
          const sb = L.lerpBox(F.full, slab, c);
          D.fillBox(ctx, { x: sc[0] + (sb.x - sc[0]) * pk, y: sc[1] + (sb.y - sc[1]) * pk, w: sb.w * pk, h: sb.h * pk }, 'accent');
          if (cf && f.lb >= claimAt) T.kinetic(f, cf, { by: 'line', at: claimAt, stagger: 0.125, from: 'mask', spring: TYPE, color: 'bg' });
          const k = 1 + 0.5 * (1 - M.clamp(after(f.lb, landAt - 0.25, SLAM))), fn = () => T.drawFit(ctx, theme, ft, { color: ink, bleed: k > 1.002 });
          ctx.save(); ctx.translate(nc[0], nc[1]); ctx.scale(k, k); ctx.translate(-nc[0], -nc[1]);
          if (k > 1.002) T.quiet(fn); else fn();
          ctx.restore();
        },
        dot: (lb) => { const [x, y, r] = period(ft); return [x, y, r * M.clamp(after(lb, landAt, UI), 0, 1.1), inv(lb) ? 'bg' : 'accent']; },
      };
    },
  };
}
