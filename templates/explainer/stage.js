// stage.js: per-aspect layout for the explainer. Laid out per format, not reflowed from one layout:
//   9:16 / 4:5 / 1:1   title band on top (compact numeral beside the title), then the hero filling the rest of the
//                      safe height (film ratio 0.72-1.4 in portrait, 1.15-1.78 in square, plus its prop band); no
//                      caption chips (the rail carries the structure, and phone-size mono chips were unreadable)
//   16:9               40/60 columns: numeral, title and strip in the text column, the hero full height in the other;
//                      the columns swap on every other step and the hero object slides across on the cut
// The hero geometry is shared by all steps of a stacked format, so the object never jumps between steps.
export function makeLayout(api, { R, n, chipFits }) {
  const { F, T, L, M, ctx, theme } = api;
  const u = F.u;
  const SB = api.captionTop != null ? { ...F.safe, h: Math.min(F.safe.h, api.captionTop - R * 0.5 - F.safe.y) } : F.safe;
  const railH = Math.max(4, 8 * u), railTop = F.orient === 'v';
  const rail = { x: SB.x, y: railTop ? SB.y + R * 1.6 : SB.y + SB.h - railH, w: SB.w, h: railH };
  const C = L.inset(SB, railTop ? { t: R * 1.6 + railH + R * 1.1 } : { b: railH + R * 1.9 + 36 * u });
  const gap = R * F.pick({ v: 0.9, s: 0.7, h: 0.8 });

  // Balanced multi-line display type: the narrowest box that keeps the same size and line count (no widows).
  const fitBal = (str, o) => {
    const f0 = T.fitText(ctx, theme, str, o);
    if (f0.lines.length < 2 || f0.overflow) return f0;
    const wordW = Math.max(...str.split(/\s+/).map((w) => T.measure(ctx, theme, o.role, w, f0.size).w));
    let w = o.box.w;
    for (let k = 0.96; k >= 0.5; k -= 0.04) {
      const ww = o.box.w * k;
      if (ww < wordW || T.wrapText(ctx, theme, str, { role: o.role, size: f0.size, width: ww }).length !== f0.lines.length) break;
      w = ww;
    }
    return w === o.box.w ? f0 : T.fitText(ctx, theme, str, { ...o, box: { ...o.box, w }, max: f0.size });
  };

  const bandH = R * 2.9, topH = 0;
  const heroOf = (heroB) => {
    const area = { ...heroB, h: heroB.h - bandH - topH };
    const [lo, hi] = F.pick({ v: [0.72, 1.4], s: [1.15, 1.78], h: [1.25, 1.78] });
    const ratio = M.clamp(area.w / area.h, lo, hi);
    const fb = L.aspectFit(area, ratio, 'c');
    const film = { ...fb, y: heroB.y + topH + (heroB.h - topH - fb.h - bandH) / 2 };
    return { hero: heroB, film, band: { x: film.x, y: film.y + film.h, w: film.w, h: bandH } };
  };
  const numOf = (box, max) => T.fitText(ctx, theme, '00', { role: 'display', box, lines: 1, valign: 't', max, min: R });

  if (F.orient !== 'h') {
    const titleMax = R * F.pick({ v: 1.75, s: 1.9 });
    const headH = titleMax * 1.02 * 2 + R * 0.25;
    const numFit = numOf({ x: C.x, y: C.y, w: C.w * 0.3, h: titleMax * 1.05 }, titleMax);
    const nw = numFit.lines[0].w;
    const text = { numFit, numB: { x: C.x, y: C.y, w: nw + 10 * u, h: titleMax * 1.2 }, titleB: { x: C.x + nw + R * 0.6, y: C.y, w: C.w - nw - R * 0.6, h: headH } };
    const stripOn = false, stripH = R * 1.75;   // stacked formats: no chips (the rail carries the structure; the hero fills)
    const heroB = { x: C.x, y: C.y + headH + gap, w: C.w, h: C.h - headH - gap - (stripOn ? stripH + gap : 0) };
    const geo = heroOf(heroB);
    const strip = stripOn ? { x: C.x, y: heroB.y + heroB.h + gap, w: C.w, h: stripH } : null;
    return { SB, rail, railH, C, fitBal, titleMax,
      hookHead: { x: C.x, y: C.y, w: C.w, h: R * 2.8 },
      hookTiles: { x: C.x, y: C.y + R * 2.8 + gap, w: C.w, h: C.h - R * 2.8 - gap },
      introTitle: { x: C.x, y: C.y, w: C.w, h: headH },
      stepGeo: (k, hasHero) => ({ ...geo, text, strip: hasHero ? strip : null }) };
  }

  const titleMax = R * 2.1;
  const [t0, d0] = L.split(C, [0.4, 0.6], { axis: 'x', gap: R * 1.6 });
  const mirror = (k) => k % 2 === 1;
  const stepGeo = (k, hasHero) => {
    const tc = mirror(k) ? { ...t0, x: C.x + C.w - t0.w } : t0, dc = mirror(k) ? { ...d0, x: C.x } : d0;
    const numH = R * 2.6, numFit = numOf({ x: tc.x, y: tc.y, w: tc.w, h: numH }, numH);
    const titleB = { x: tc.x, y: tc.y + numH + R * 0.7, w: tc.w, h: titleMax * 1.02 * 3 };
    const sy = titleB.y + titleB.h + R * 0.6, stripOn = hasHero && chipFits(tc.w) && sy + R * 1.75 <= C.y + C.h;
    return { ...heroOf(dc), text: { numFit, numB: { x: tc.x, y: tc.y, w: tc.w, h: numH + 30 * u }, titleB },
      strip: stripOn ? { x: tc.x, y: sy, w: tc.w, h: R * 1.75 } : null };
  };
  return { SB, rail, railH, C, fitBal, titleMax, stepGeo,
    hookHead: { x: C.x, y: C.y, w: C.w, h: R * 3 },
    hookTiles: { x: C.x, y: C.y + R * 3 + gap, w: C.w, h: C.h - R * 3 - gap },
    introTitle: { x: t0.x, y: C.y, w: t0.w, h: C.h * 0.62 } };
}
