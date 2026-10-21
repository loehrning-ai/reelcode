// social-ad offer: no card. The offer photo is full-bleed from the first frame (the transition reveals it over the
// outgoing shot) under a feathered bg scrim, and the offer is laid out per aspect straight on the photo: portrait
// stacks title / old price / a price at full safe width / badge / note down the upper two thirds (the photo's subject
// shows below); square centres the price; landscape sets the column on the left half while the photo's subject sits
// on the right. The price counts down from the old price from b0.5 (no empty frame), slams in accent, the old price is
// struck, the badge pops and the note lands. In the last 1.5 beats everything except the price leaves in stages (title
// masks out upward, old price drops, badge pops off, note wipes) so the hand-off to the CTA is never a one-frame swap;
// the price stays and the CTA springs it into its lockup (offerLayout is shared). Prices use content.locale/currency.
import { TYPE, cues, backdrop, cardMove, stage } from './parts.js';

/** Per-aspect scrim: feathered bg bands under the type (gradients live in the engine; templates call D.feather). */
export function scrim(api, part) {
  const { F, D } = api;
  const bands = F.pick({
    v: [[{ x: 0, y: 0, w: F.w, h: F.h * (part === 'cta' ? 0.74 : 0.8) }, 't'], ...(part === 'cta' ? [[{ x: 0, y: F.h * 0.42, w: F.w, h: F.h * 0.58 }, 'b']] : [])],
    s: [[{ x: 0, y: 0, w: F.w, h: F.h * 0.78 }, 't'], [{ x: 0, y: F.h * 0.4, w: F.w, h: F.h * 0.6 }, 'b']],
    h: [[{ x: 0, y: 0, w: F.w * 0.7, h: F.h }, 'l']],
  });
  const [at, alpha] = part === 'cta' ? [0.5, 0.84] : [0.6, 0.88];
  return (ctx) => { for (const [b, side] of bands) D.feather(ctx, b, side, 'bg', { at, alpha }); };
}

/** Centre a single-line fit horizontally inside its box. */
export const centreFit = (fit, box) => {
  const dx = box.x + (box.w - fit.lines[0].w) / 2 - fit.lines[0].x;
  return { ...fit, lines: fit.lines.map((l) => ({ ...l, x: l.x + dx })), box: { ...fit.box, x: fit.box.x + dx } };
};

/** Build-time layout of the offer (the CTA reads the price slot for its morph). */
export function offerLayout(api, offer) {
  const { F, ctx, theme, T, L } = api;
  const R = (k) => T.readable(F, k);
  const nf = { fmt: 'currency', decimals: offer.decimals ?? 0 };
  const priceStr = T.counterText(offer.price, 1, nf);
  const wasStr = offer.was !== undefined ? T.counterText(offer.was, 1, nf) : null;
  const st = stage(api);
  const col = F.pick({ v: st, s: st, h: { x: st.x, y: st.y, w: st.w * 0.5, h: st.h } });
  const centred = F.orient === 's';
  const ratios = F.pick({ v: [0.1, 0.07, 0.3, 0.06, 0.06, 0.41], s: [0.12, 0.09, 0.4, 0.09, 0.08, 0.22], h: [0.13, 0.1, 0.42, 0.1, 0.09, 0.16] })
    .map((x, i) => (i === 1 && !wasStr ? 0.0001 : i === 3 && !offer.badge ? 0.0001 : i === 4 && !offer.note ? 0.0001 : x));
  const rows = L.split(col, ratios, { axis: 'y', gap: 14 * F.u });
  const fit = (s, box, x) => {
    const ft = T.fitText(ctx, theme, s, { box, max: box.h, min: R(1), lines: 1, ...x });
    return centred ? centreFit(ft, box) : ft;
  };
  const titleFit = fit(offer.title, rows[0], { role: 'display', valign: 'b', min: R(1.2) });
  const wasFit = wasStr ? fit(wasStr, rows[1], { role: 'display', min: R(1.2), valign: 'c' }) : null;
  const wide = wasStr && T.measure(ctx, theme, 'display', wasStr, 100).w > T.measure(ctx, theme, 'display', priceStr, 100).w ? wasStr : priceStr;
  const pBox = L.inset(rows[2], { r: rows[2].w * 0.04, l: rows[2].w * 0.01 });
  const pFit0 = T.fitText(ctx, theme, wide, { box: pBox, max: pBox.h * 1.3, min: R(2), lines: 1, role: 'display', valign: 'c' });
  const pw = T.measure(ctx, theme, 'display', priceStr, pFit0.size).w;
  const pFit = centred ? { ...pFit0, lines: [{ ...pFit0.lines[0], x: pBox.x + (pBox.w - pw) / 2, w: pw }] } : pFit0;
  const bSize = R(1.25);
  const badge = offer.badge ? (() => {
    const w = T.measure(ctx, theme, 'ui', offer.badge, bSize, 700).w, h = bSize * 1.9;
    return { box: L.place(rows[3], { w: Math.min(rows[3].w, w + h * 0.9), h }, centred ? 'c' : 'w'), size: bSize };
  })() : null;
  const noteFit = offer.note ? fit(offer.note, rows[4], { role: 'ui', max: Math.min(R(1.3), rows[4].h), valign: 'c' }) : null;
  return { nf, priceStr, wasStr, titleFit, wasFit, pFit, pl: pFit.lines[0], badge, noteFit };
}

/** Draw a one-line fit leaving: it masks out upward over ~0.4 beat from `at` (drawn, not logged). */
export function maskOut(f, api, fit, at, color = 'fg') {
  const { ctx, theme, T, M } = api;
  const p = M.clamp(M.sp(f.since(at), 'stiff'));
  if (p >= 0.999) return;
  for (const l of fit.lines) {
    ctx.save(); ctx.beginPath();
    ctx.rect(l.x - fit.size, l.y - fit.cap - fit.size * 0.3, l.w + fit.size * 2, fit.cap + fit.size * 0.62); ctx.clip();
    T.drawText(ctx, theme, l.s, l.x, l.y - p * fit.size * 1.1, { role: fit.role, size: fit.size, color, weight: fit.weight, log: false });
    ctx.restore();
  }
}

export function offerScene(api, o) {
  const { F, ctx, theme, T, D, M } = api;
  const { id, beats, offer } = o;
  const { nf, priceStr, wasStr, titleFit, wasFit, pFit, pl, badge, noteFit } = offerLayout(api, offer);
  const media = backdrop(api, `${id}-media`, offer, beats, cardMove(api, 'offer'));
  const shade = scrim(api, 'offer');
  const AT = { title: 0.25, was: 0.5, count: 0.5, strike: 1.5, land: 2, badge: 3, note: 4 };
  const OUT = { title: beats - 1.5, was: beats - 1.5, badge: beats - 1.25, note: beats - 1 };
  const ticks = [0.75, 1, 1.25, 1.5, 1.75].map((at) => ({ at, sfx: 'tick', gain_db: -15 }));
  const c = cues(beats, [0, AT.was, ...(wasStr ? [AT.strike] : []), AT.land, ...(badge ? [AT.badge] : []), ...(noteFit ? [AT.note] : []), OUT.title, OUT.badge],
    [{ at: AT.title, sfx: 'pop', gain_db: -9 }, ...ticks, ...(wasStr ? [{ at: AT.strike, sfx: 'swish', gain_db: -10 }] : []),
      { at: AT.land, sfx: 'thump', gain_db: -2 }, ...(badge ? [{ at: AT.badge, sfx: 'pop', gain_db: -6 }, { at: OUT.badge, sfx: 'pop', gain_db: -10 }] : []),
      ...(noteFit ? [{ at: AT.note, sfx: 'click', gain_db: -10 }] : []), { at: OUT.title, sfx: 'swish', gain_db: -10 }]);
  return {
    id, beats, ...c, cut: 5,
    draw(f) {
      if (media) media.draw(f);
      shade(ctx);
      if (f.lb < OUT.title) T.kinetic(f, titleFit, { by: 'word', at: AT.title, stagger: 0.125, from: 'mask', spring: TYPE });
      else maskOut(f, api, titleFit, OUT.title);
      if (wasFit) {
        const l = wasFit.lines[0], y = l.y - wasFit.cap * 0.42, rise = wasFit.cap * 0.18;
        if (f.lb < OUT.was) {
          T.kinetic(f, wasFit, { by: 'line', at: AT.was, from: 'mask', spring: TYPE, color: 'muted' });
          // a knock-out strike: a rising band of bg slices the old price (no ink over the glyphs, so it stays readable)
          const sp = M.clamp(M.sp(f.since(AT.strike), 'stiff'));
          if (sp > 0) D.line(ctx, [[l.x - 6 * F.u, y + rise], [l.x + l.w + 6 * F.u, y - rise]], { color: 'bg', width: Math.max(5 * F.u, wasFit.size * 0.07), progress: sp, cap: 'butt' });
        } else maskOut(f, api, wasFit, OUT.was, 'muted');
      }
      // the price is on screen from b0.5, counting down from the old price; it lands in accent on AT.land
      if (f.lb >= AT.count) {
        const p = M.easeOutCubic(f.since(AT.count) / ((AT.land - AT.count) * f.grid.spb));
        const landed = f.lb >= AT.land;
        const txt = wasStr ? T.counterText(offer.price, p, { ...nf, from: offer.was }) : priceStr;
        const rise = M.sp(f.since(AT.count), TYPE), punch = landed ? f.hit(AT.land, 0.1) * 0.06 : 0;
        ctx.save();
        ctx.beginPath(); ctx.rect(F.full.x, pFit.box.y - pFit.size * 0.3, F.w, pFit.box.h + pFit.size * 0.6); ctx.clip();
        ctx.translate(pl.x, pl.y + (1 - rise) * pFit.size); ctx.scale(1 + punch, 1 + punch);
        T.drawText(ctx, theme, txt, 0, 0, { role: 'display', size: pFit.size, color: landed ? 'accent' : 'fg', log: false });
        ctx.restore();
        if (rise > 0.97) T.logRest(ctx, theme, priceStr, pl.x, pl.y, { role: 'display', size: pFit.size, color: landed ? 'accent' : 'fg' });
      }
      if (badge) {
        const bp = Math.max(0, M.sp(f.since(AT.badge), 'snap')) * (f.lb >= OUT.badge ? 1 - M.clamp(M.sp(f.since(OUT.badge), 'snap')) : 1);
        if (bp > 0.001) {
          const b = badge.box, bx = b.x + b.w / 2, by = b.y + b.h / 2;
          ctx.save(); ctx.translate(bx, by); ctx.scale(bp, bp); ctx.translate(-bx, -by);
          D.fillBox(ctx, b, 'accent', b.h / 2);
          T.drawText(ctx, theme, offer.badge, b.x + b.h * 0.45, by + badge.size * 0.36, { role: 'ui', size: badge.size, weight: 700, color: 'bg', log: false });
          ctx.restore();
          if (f.lb < OUT.badge && bp > 0.98) T.logRest(ctx, theme, offer.badge, b.x + b.h * 0.45, by + badge.size * 0.36, { role: 'ui', size: badge.size, weight: 700, color: 'bg' });
        }
      }
      if (noteFit) {
        if (f.lb < OUT.note) T.kinetic(f, noteFit, { by: 'line', at: AT.note, from: 'mask', spring: TYPE, color: 'fg' });
        else {
          // the note wipes off to the left (a closing clip, not a fade)
          const w = 1 - M.clamp(M.sp(f.since(OUT.note), 'stiff'));
          const l = noteFit.lines[0];
          if (w > 0.002) D.withClip(ctx, (cc) => cc.rect(l.x - 4, l.y - noteFit.cap * 1.4, (l.w + 8) * w, noteFit.cap * 2), () =>
            T.drawText(ctx, theme, l.s, l.x, l.y, { role: 'ui', size: noteFit.size, color: 'fg', log: false }));
        }
      }
    },
  };
}
