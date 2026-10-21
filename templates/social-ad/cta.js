// social-ad CTA / end card: its own composition per aspect, not a relabelled offer card. Portrait: the name at full
// safe-area width at the top, label + price stacked big in the middle, the pill in the lower thumb zone with the URL
// under it. Square: the same stack centred, the price at >= 1/3 of the frame height. Landscape: the lockup down the
// left half while the photo travels behind. The offer's price springs from its offer slot into the lockup (the offer
// has already cleared everything else in stages); the name masks UP from its baseline (never drops in clipped), the
// label masks in, the pill wipes open and is pressed (anchor the "book" VO line here), the URL types on, an accent rule
// stamps under the name, and on the LAST beat a real visual event lands with the final thump: with content.frame the
// camera snaps back out through the window so the carriage frames the lockup (the payoff of the window motif);
// without it the price punches. Cues are functions of the scene's real length (fill/cutdowns).
import { TYPE, UI, q, cues, stage, backdrop, cardMove } from './parts.js';
import { offerLayout, scrim, centreFit } from './offer.js';
import { slideWorld } from './window.js';

/**
 * Lockup beats for a CTA of nb beats (compressed under 6): name, label, pill, press (anchor the CTA VO line here), the
 * URL types on after the press, the accent rule stamps 1.5 beats from the end and the end event hits the LAST beat.
 */
const FLARE = 0.12; // alpha of the flat light bands
const CREEP = 0.16; // how far the camera eases back from the glass before the end snap

export const ctaTiming = (nb) => {
  const k = nb >= 6 ? 1 : nb / 8;
  const press = q(3.5 * k), url = Math.min(q(5 * k), nb - 2);
  const end = Math.max(url + 0.5, nb - 1);
  return { name: q(0.5 * k), label: q(1.25 * k), pill: q(2 * k), press, url: Math.max(url, press), stamp: Math.max(url + 0.25, nb - 1.5), end };
};

/** Build-time lockup layout for this aspect. */
function lockupLayout(api, cta, priceStr) {
  const { F, ctx, theme, T, L } = api;
  const R = (k) => T.readable(F, k);
  const st = stage(api);
  const centred = F.orient === 's';
  const col = F.pick({ v: st, s: st, h: { x: st.x, y: st.y, w: st.w * 0.5, h: st.h } });
  const label = cta.chip || null;
  const ratios = F.pick({ v: [0.17, 0.05, 0.27, 0.19, 0.11, 0.05], s: [0.2, 0.07, 0.34, 0.03, 0.15, 0.08], h: [0.22, 0.07, 0.32, 0.03, 0.15, 0.08] })
    .map((x, i) => (i === 1 && !label ? 0.0001 : i === 2 && !priceStr ? 0.0001 : i === 5 && !cta.url ? 0.0001 : x));
  const rows = L.split(col, ratios, { axis: 'y', gap: 14 * F.u });
  const fit = (s, box, x) => {
    const ft = T.fitText(ctx, theme, s, { box, max: box.h, min: R(1), lines: 1, ...x });
    return centred ? centreFit(ft, box) : ft;
  };
  const nameBox = L.inset(rows[0], { b: rows[0].h * 0.16 }); // room for the stamp rule
  const nameFit = fit(cta.name, nameBox, { role: 'display', max: nameBox.h * 1.3, min: R(1.4), valign: 'b' });
  const labelFit = label ? fit(label, rows[1], { role: 'ui', max: Math.min(rows[1].h, R(1.5)), valign: 'c' }) : null;
  const priceFit = priceStr ? fit(priceStr, L.inset(rows[2], { r: rows[2].w * (centred ? 0 : 0.1) }), { role: 'display', max: rows[2].h * 1.3, min: R(2), valign: 'c' }) : null;
  const pillH = Math.min(R(3.6), rows[4].h * 0.9);
  const ctaSize = Math.max(R(1.1), Math.min(pillH * 0.44, (rows[4].w - pillH * 0.9) / T.measure(ctx, theme, 'ui', cta.text, 100, 700).w * 100));
  const pill = L.place(rows[4], { w: Math.min(rows[4].w, T.measure(ctx, theme, 'ui', cta.text, ctaSize, 700).w + pillH * 0.9), h: pillH }, centred ? 'c' : 'w');
  const urlFit = cta.url ? fit(cta.url, rows[5], { role: 'ui', max: Math.min(rows[5].h, R(1.3)), valign: 'c' }) : null;
  return { nameFit, labelFit, priceFit, pill, pillH, ctaSize, urlFit };
}

export function ctaScene(api, o) {
  const { F, ctx, theme, T, D, M } = api;
  const { id, beats, cta, offer, offerData, win } = o;
  const ol = offerLayout(api, offerData);
  const priceStr = offer ? ol.priceStr : null;
  const { nameFit, labelFit, priceFit, pill, pillH, ctaSize, urlFit } = lockupLayout(api, cta, priceStr);
  const own = !!(cta.image || cta.clip) && !(cta.image && cta.image === offerData.image);
  const src = own ? cta : offerData;
  // with the window motif the end card is the world seen through the window (pushed in until the last beat)
  const world = win && src.image ? slideWorld(api, src, { drift: F.orient === 'h' ? 0.7 : 0.5 }) : null;
  const media = world ? null : backdrop(api, `${id}-media`, src, beats, own ? undefined : cardMove(api, 'cta'));
  const shade = scrim(api, 'cta');
  const plan = (nb) => {
    const AT = ctaTiming(nb);
    return cues(nb, [0, AT.name, ...(labelFit ? [AT.label] : []), AT.pill, ...(urlFit ? [AT.url] : []), AT.press, AT.stamp, AT.end],
      [{ at: 0, sfx: 'whoosh', gain_db: -8 }, { at: AT.name, sfx: 'pop', gain_db: -7 }, { at: AT.pill, sfx: 'swish', gain_db: -9 }, ...(labelFit ? [{ at: AT.label, sfx: 'pop', gain_db: -10 }] : []),
        { at: AT.press, sfx: 'click', gain_db: -5 }, { at: AT.stamp, sfx: 'swish', gain_db: -8 }, ...(world ? [{ at: AT.end - 0.25, sfx: 'whoosh', gain_db: -8 }] : []), { at: AT.end, sfx: 'thump', gain_db: -1 }]);
  };
  // a band of sunrise light sweeps across the view after the button press: the one event in the middle of the card
  const flare = (c, f, AT) => {
    const t = M.clamp(f.since(AT.press + 0.25) / 2.5);
    if (t <= 0 || t >= 1) return;
    const x = F.w * (-0.35 + 1.7 * M.easeInOutCubic(t)), bw = F.w * 0.4;
    c.save(); c.transform(1, 0, -0.35, 1, F.h * 0.175, 0); c.fillStyle = `rgba(255,190,120,${FLARE})`; c.fillRect(x - bw * 0.5, 0, bw, F.h);
    c.fillStyle = `rgba(255,190,120,${FLARE * 0.6})`; c.fillRect(x + bw * 0.7, 0, bw * 0.18, F.h); c.restore();
  };
  const nl = nameFit.lines[0];
  const from = { x: ol.pl.x, y: ol.pl.y, size: ol.pFit.size };
  const to = priceFit ? { x: priceFit.lines[0].x, y: priceFit.lines[0].y, size: priceFit.size } : null;
  return {
    id, beats, events: (nb) => plan(nb).events, sfx: (nb) => plan(nb).sfx, transition: { type: 'wipe', dir: 'u', beats: 0.75 },
    draw(f) {
      const AT = ctaTiming(f.scene.beats);
      if (world) {
        // pushed through the glass for the whole card; on the last beat the camera snaps back out of the window
        const p = M.clamp(f.lt / (f.scene.beats * f.grid.spb));
        // the camera also eases back a little through the card (the carriage edges creep in), so the middle is never still
        const k = (1 - CREEP * M.easeInOutCubic(p)) - M.clamp(M.sp(f.since(AT.end - 0.25), [0.31, 0.73]), 0, 1.04) * (1 - CREEP * M.easeInOutCubic(p));
        // the scrim darkens the view through the glass only; the carriage that snaps in stays as it is
        win.draw(f, k, (box, cx) => world(f, box, p, cx), ctx, (c) => { shade(c); flare(c, f, AT); });
      } else if (media) { media.draw(f); shade(ctx); flare(ctx, f, AT); }
      T.kinetic(f, nameFit, { by: 'char', at: AT.name, stagger: 0.04, from: 'mask', spring: TYPE });
      const stamp = M.clamp(M.sp(f.since(AT.stamp), 'stiff'));
      if (stamp > 0) D.line(ctx, [[nl.x, nl.y + nameFit.size * 0.12], [nl.x + nl.w, nl.y + nameFit.size * 0.12]], { color: 'accent', width: Math.max(8 * F.u, nameFit.size * 0.06), progress: stamp, cap: 'butt' });
      if (labelFit) T.kinetic(f, labelFit, { by: 'line', at: AT.label, from: 'mask', spring: TYPE, color: 'fg' });
      if (to) {
        // the offer price springs from its offer slot into the lockup (continuous across the seam), then punches on the end
        const k = M.sp(f.since(0), TYPE), lerp = (a, b) => a + (b - a) * k;
        const size = lerp(from.size, to.size), x = lerp(from.x, to.x), y = lerp(from.y, to.y);
        const punch = 1 + f.hit(AT.end, 0.12) * 0.08;
        ctx.save(); ctx.translate(x, y); ctx.scale(punch, punch);
        T.drawText(ctx, theme, priceStr, 0, 0, { role: 'display', size, color: 'accent', log: false });
        ctx.restore();
        if (k > 0.97) T.logRest(ctx, theme, priceStr, to.x, to.y, { role: 'display', size: to.size, color: 'accent' });
      }
      const wp = M.sp(f.since(AT.pill), UI);
      if (wp > 0) {
        const press = f.hit(AT.press, 0.12) * 0.07;
        const pb = { x: pill.x + pill.w * press / 2, y: pill.y + pill.h * press / 2, w: pill.w * M.clamp(wp, 0, 1.03) * (1 - press), h: pill.h * (1 - press) };
        D.fillBox(ctx, pb, 'accent', pb.h / 2);
        const tx = pill.x + pillH * 0.45, ty = pill.y + pill.h / 2 + ctaSize * 0.36;
        D.withClip(ctx, (cc) => cc.rect(pb.x, pb.y, pb.w, pb.h), () =>
          T.drawText(ctx, theme, cta.text, tx, ty, { role: 'ui', size: ctaSize, weight: 700, color: 'bg', log: false }));
        if (wp > 0.95) T.logRest(ctx, theme, cta.text, tx, ty, { role: 'ui', size: ctaSize, weight: 700, color: 'bg' });
      }
      if (urlFit) T.kinetic(f, urlFit, { by: 'char', at: AT.url, stagger: 0.03, from: 'below', spring: TYPE, color: 'fg' });
    },
  };
}
