// finale.js: the product-launch payoff as one continuous move: the metric is counted out of its real KPI card,
// lands, and then collapses into the logo mark of the end card (a shared element across the cut); the CTA
// lockup grows out of that mark, large and laid out per format, and the last beat lands a press on the pill.
import { UI, POP, TYPE, samplePx } from './stage.js';
import { inkOn, plateOn } from './ink.js';

/** The share of the logo's width that holds ink (scanned once at build time; 1 when it cannot be read). */
function inkRight(img) {
  try {
    const W = 360, H = Math.max(8, Math.round(W * (img.naturalHeight || 1) / (img.naturalWidth || 1)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    for (let x = W - 1; x > 0; x--) for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 24) return Math.min(1, (x + 2) / W);
    return 1;
  } catch { return 1; }
}

/**
 * End-card layout, computed once and shared with the metric scene (it needs the mark's box to collapse into).
 * 9:16 / 4:5 / 1:1: a centred vertical stack sitting a little low (logo 60-80% of the safe width, pill >= 6.5%
 * of the frame height). 16:9: a horizontal split, logo + tagline left, pill + URL right.
 */
export function ctaLayout(api, product, c, logo) {
  const { F, ctx, theme, T, L } = api;
  const la = logo ? (logo.naturalWidth || 1) / (logo.naturalHeight || 1) : 4;
  const mk = c.mark || [0, 0, Math.min(1, 1 / la), 1];
  const pillH = F.h * F.pick({ v: 0.075, s: 0.1, h: 0.16 });
  const cS = Math.max(pillH * 0.42, api.T.readable(F)), pillW0 = T.measure(ctx, theme, 'ui', c.text, cS, 700).w + pillH * 1.2;
  const nS = T.readable(F, F.pick({ v: 1.3, s: 1.3, h: 1.35 }));
  const fitTag = (box, size, align) => (product.tagline ? T.fitText(ctx, theme, product.tagline, { role: 'display', box, lines: 'auto', leading: 1.05, align, max: size, min: T.readable(F, 1.2) }) : null);
  const vis = inkRight(logo);   // the share of the logo file that holds ink (centre what is drawn, not its empty margin)
  let lb, tagFit, pill, urlBox, align;
  if (F.orient === 'h') {
    // A horizontal split edge to edge of the safe area: mark + wordmark + tagline left, a large pill + URL right.
    const [a, d] = L.split(F.safe, [0.52, 0.48], { axis: 'x', gap: 110 * F.u });
    const logoW = Math.min(a.w / vis, F.safe.h * 0.36 * la), logoH = logoW / la, tagS = logoH * 0.36, gap = logoH * 0.28;
    const probe = fitTag({ x: a.x, y: 0, w: a.w, h: tagS * 2.3 }, tagS, 'l');
    const total = logoH + (probe ? gap + probe.box.h : 0);
    const top = F.safe.y + (F.safe.h - total) / 2;
    lb = { x: a.x, y: top, w: logoW, h: logoH };
    tagFit = probe ? fitTag({ x: a.x, y: top + logoH + gap, w: a.w, h: probe.box.h + 0.5 }, probe.size, 'l') : null;
    const rh = pillH + nS * 2.4, ry = F.safe.y + (F.safe.h - rh) / 2;
    pill = { x: d.x, y: ry, w: d.w, h: pillH };
    urlBox = { x: d.x, y: ry + pillH + nS * 1.1, w: d.w, h: nS * 1.2 };
    align = 'c';
  } else {
    // One stacked block: logo ~92% (66% square) of the safe width, pill >= 7.5% of the height and >= 72% of the width.
    const logoW = Math.min(F.safe.w * F.pick({ v: 0.92, s: 0.66 }) / vis, F.safe.h * 0.22 * la), logoH = logoW / la;
    const tagS = logoH * 0.42, gap = logoH * 0.3;
    const probe = fitTag({ x: F.safe.x, y: 0, w: F.safe.w, h: tagS * 3.3 }, tagS, 'c');
    const tagH = probe ? probe.box.h : 0;
    const total = logoH + (probe ? gap + tagH : 0) + pillH * 0.6 + pillH + nS * 0.9 + nS * 1.2;
    const y0 = Math.min(F.safe.y + F.safe.h - total, F.safe.y + (F.safe.h - total) / 2 + F.safe.h * 0.04);
    lb = { x: F.cx - (logoW * vis) / 2, y: y0, w: logoW, h: logoH };
    tagFit = probe ? fitTag({ x: F.safe.x, y: y0 + logoH + gap, w: F.safe.w, h: tagH + 0.5 }, probe.size, 'c') : null;
    const below = tagFit ? tagFit.box.y + tagFit.box.h : lb.y + lb.h;
    const pw = Math.min(F.safe.w, Math.max(pillW0, F.safe.w * F.pick({ v: 0.78, s: 0.6 })));
    pill = { x: F.cx - pw / 2, y: below + pillH * 0.6, w: pw, h: pillH };
    urlBox = { x: F.safe.x, y: pill.y + pillH + nS * 0.9, w: F.safe.w, h: nS * 1.2 };
    align = 'c';
  }
  const mark = { x: lb.x + mk[0] * lb.w, y: lb.y + mk[1] * lb.h, w: mk[2] * lb.w, h: mk[3] * lb.h };
  const urlFit = c.url ? T.fitText(ctx, theme, c.url, { role: 'ui', box: urlBox, lines: 1, align: F.orient === 'h' ? 'c' : align, max: nS, min: T.readable(F) }) : null;
  const nameFit = logo ? null : T.fitText(ctx, theme, product.name, { role: 'display', box: lb, lines: 1, valign: 'c', align, min: T.readable(F, 1.4) });
  return { lb, mark, tagFit, pill, cS, urlFit, nameFit };
}

/**
 * The metric is born inside its captured card: the card lands with its own value slot empty, the number counts
 * up as it scales out of that slot into the hero, lands on the thump while the sparkline draws on, the label
 * lands, the shot pushes; then the card and label drop away and the number collapses into the logo mark.
 */
export function metricScene(api, m, beats, mark) {
  const { F, ctx, theme, T, L, M, D, A } = api;
  const s = m.screen ? A.screen(m.screen) : null;
  const card = s && m.card ? A.capRect(s, m.card) : null;
  const VAL = m.cardValue || [0.04, 0.3, 0.44, 0.37], SPK = m.cardSpark || [0.62, 0.48, 0.36, 0.42];
  const cardBg = card ? samplePx(s.img, card.x + card.w * 0.5, card.y + card.h * 0.5) : null;
  let cardBox = null, numBox, labBox;
  const pad = F.safe.w * 0.03;
  const area = L.inset(F.safe, F.pick({ v: { t: F.safe.h * 0.03, b: F.safe.h * 0.03, l: pad, r: pad }, s: Math.min(F.safe.w, F.safe.h) * 0.03, h: { t: F.safe.h * 0.08, b: F.safe.h * 0.08, l: pad, r: pad } }));
  if (card && F.orient === 'h') {
    const [cb, rest] = L.split(area, [0.44, 0.56], { axis: 'x', gap: 80 * F.u });
    cardBox = L.aspectFit(cb, card.w / card.h, 'c');
    [numBox, labBox] = L.split(rest, [0.62, 0.38], { axis: 'y', gap: 24 * F.u });
  } else if (card) {
    const [cb, nb, lb] = L.split(area, F.pick({ v: [0.3, 0.4, 0.3], s: [0.34, 0.4, 0.26] }), { axis: 'y', gap: 36 * F.u });
    cardBox = L.aspectFit(cb, card.w / card.h, 'nw');
    numBox = nb; labBox = lb;
  } else [numBox, labBox] = L.split(area, [0.56, 0.44], { axis: 'y', gap: 36 * F.u });
  const fmt = { from: m.from ?? 0, fmt: m.fmt || 'int', decimals: m.decimals || 0, suffix: m.unit || '', prefix: m.prefix || '' };
  const finalTxt = T.counterText(m.value, 1, fmt);
  const numFit = T.fitText(ctx, theme, finalTxt, { role: 'display', box: L.inset(numBox, { r: numBox.w * 0.04 }), lines: 1, valign: 'b', min: T.readable(F, 2) });
  const labTop = numFit.box.y + numFit.box.h + T.measure(ctx, theme, 'display', finalTxt, numFit.size).desc + numFit.size * 0.18;
  const labFit = m.label ? T.fitText(ctx, theme, m.label, { role: 'ui', box: { x: labBox.x, y: labTop, w: labBox.w, h: Math.max(T.readable(F) * 1.3, labBox.y + labBox.h - labTop) },
    lines: 'auto', leading: 1.25, max: T.readable(F, 1.6), min: T.readable(F) }) : null;
  const sub = (b, r) => ({ x: b.x + r[0] * b.w, y: b.y + r[1] * b.h, w: r[2] * b.w, h: r[3] * b.h });
  const countAt = 0.5, end = countAt + 2, labAt = end + 0.25;
  const colAt = mark ? Math.max(labAt + 1.5, beats - 1) : null;   // the collapse is centred on the cut into the CTA
  const pushAt = Math.min((colAt ?? beats) - 1, end + 1.25);
  // Second move of the hold: the card drops away and the number + label re-frame to the centre, larger.
  const reAt = colAt !== null && colAt - 2 >= pushAt + 0.5 ? colAt - 2 : null;
  const events = [0, countAt, end, ...(labFit ? [labAt] : []), pushAt, ...(reAt !== null ? [reAt] : []), ...(colAt !== null ? [colAt] : [])].filter((b, k, a) => b >= 0 && b < beats && a.indexOf(b) === k);
  const ticks = [];
  for (let b = countAt + 0.5; b < end - 0.75; b += 0.5) ticks.push({ at: +b.toFixed(4), sfx: 'tick', gain_db: -19 });   // thinned: the riser carries the build
  // The climax: a one-bar riser into the landing, the loudest hit of the film.
  const sfx = [{ at: 0, sfx: 'pop', gain_db: -10 }, ...ticks, { at: end, sfx: 'riser', dur: 2, gain_db: -9 }, { at: end, sfx: 'thump', gain_db: 0 }, { at: end, sfx: 'pop', gain_db: -6 }, ...(pushAt > end ? [{ at: pushAt, sfx: 'swish', gain_db: -10 }] : []),
    ...(reAt !== null ? [{ at: reAt, sfx: 'swish', gain_db: -11 }] : []), ...(colAt !== null ? [{ at: colAt, sfx: 'pop', gain_db: -8 }] : [])].filter((x) => x.at < beats);
  const ln = numFit.lines[0];
  const draw = (f) => {
    const col = colAt !== null ? M.clamp(M.sp(f.since(colAt), [0.44, 1])) : 0;
    const push = M.clamp(M.sp(f.since(pushAt), 'soft'));
    const sc = 1 + 0.04 * push;
    const dropAt = reAt ?? colAt;
    const drop = (dropAt !== null ? M.clamp(M.sp(f.since(dropAt), 'stiff')) : 0) * F.h * 1.1;   // the card leaves downward
    const gone = dropAt !== null && f.since(dropAt) >= 0.5 * f.spb;
    const rf = reAt !== null ? M.clamp(M.sp(f.since(reAt - 0.1), [0.31, 0.93])) : 0;
    let slot = null;
    ctx.save();
    ctx.translate(F.cx, F.cy + drop); ctx.scale(sc, sc); ctx.translate(-F.cx, -F.cy);
    if (cardBox && !gone) {
      const rise = M.sp(f.since(0), UI), thump = f.hit(end, 0.1);
      const k = (0.9 + 0.1 * rise) * (1 + 0.03 * thump);
      const [bx, by] = L.center(cardBox);
      ctx.save();
      ctx.translate(bx, by + (1 - rise) * F.h * 0.12); ctx.scale(k, k); ctx.translate(-bx, -by);
      D.withClip(ctx, (c) => D.rrect(c, cardBox, theme.radius * 0.6), () => {
        ctx.drawImage(s.img, card.x, card.y, card.w, card.h, cardBox.x, cardBox.y, cardBox.w, cardBox.h);
        if (cardBg) {
          D.fillBox(ctx, sub(cardBox, VAL), cardBg);   // the card's own value slot stays empty: that number is the one we count
          const w = M.clamp(M.sp(f.since(end), UI)), sb = sub(cardBox, SPK);
          D.fillBox(ctx, { x: sb.x + sb.w * w, y: sb.y, w: sb.w * (1 - w), h: sb.h }, cardBg);
        }
      });
      if (M.clamp(M.sp(f.since(end), 'stiff')) > 0) D.strokeBox(ctx, L.inset(cardBox, -10 * F.u), 'accent', 6 * F.u, theme.radius * 0.7);
      ctx.restore();
      slot = sub(cardBox, VAL);
    }
    ctx.restore();
    ctx.save(); reframe(rf);
    if (labFit && (reAt !== null || !gone) && !(colAt !== null && f.lb >= colAt)) {
      ctx.save(); ctx.translate(F.cx, F.cy); ctx.scale(sc, sc); ctx.translate(-F.cx, -F.cy);
      T.kinetic(f, labFit, { by: 'line', at: labAt, stagger: 0.125, from: 'mask', spring: TYPE, color: inkOn(api, 'muted', 'bg', labFit.size) });
      ctx.restore();
    }
    ctx.restore();
    if (colAt !== null && f.lb >= colAt) { collapse((f.lb - colAt) / COL); return; }
    if (f.since(countAt) > 0) {
      const p = M.easeOutQuart(f.since(countAt) / (2 * f.spb));
      const landed = f.since(end) > 0;
      const punch = landed ? f.hit(end, 0.1) * 0.05 : 0;
      const txt = T.counterText(m.value, p, fmt);
      const q = M.sp(f.since(countAt), 'med');
      let x = ln.x, y = ln.y, k = 1;
      if (slot) {
        const k0 = Math.min((slot.h * 0.82) / numFit.cap, slot.w / T.measure(ctx, theme, 'display', finalTxt, numFit.size).w);
        x = slot.x + (ln.x - slot.x) * q; y = slot.y + slot.h * 0.9 + (ln.y - slot.y - slot.h * 0.9) * q; k = k0 + (1 - k0) * q;
      }
      x = F.cx + (x - F.cx) * sc; y = F.cy + (y - F.cy) * sc; k *= sc;
      ctx.save(); reframe(rf);
      ctx.translate(x, y); ctx.scale(k * (1 + punch), k * (1 + punch));
      T.drawText(ctx, theme, txt, 0, 0, { role: 'display', size: numFit.size, color: landed ? theme.mix('fg', 'accent', M.sp(f.since(end), 'stiff')) : 'fg', log: true });
      ctx.restore();
    }
  };
  // The collapse, shared with the CTA scene (it runs across the cut): an accent plate slams in behind the landed
  // number and shrinks into the logo mark's box, carrying the number (now fg on accent) down with it. u: 0..1 over
  // COL beats, eased so the fastest frame sits on the cut. The plate is never a tiny square in a void.
  const pushed = 1.04, tw = T.measure(ctx, theme, 'display', finalTxt, numFit.size).w;
  const nx = F.cx + (ln.x - F.cx) * pushed, ny = F.cy + (ln.y - F.cy) * pushed;
  const padN = numFit.cap * 0.22;
  // Re-frame target: the number + label group, centred in the safe area and as large as it fits (<= 1.25x).
  const NB = { x: nx, y: ny - numFit.cap * pushed, w: tw * pushed, h: numFit.cap * pushed };
  const LB = labFit ? { x: F.cx + (labFit.box.x - F.cx) * pushed, y: F.cy + (labFit.box.y - F.cy) * pushed, w: labFit.box.w * pushed, h: labFit.box.h * pushed } : NB;
  const GX = Math.min(NB.x, LB.x), GY = Math.min(NB.y, LB.y), GW = Math.max(NB.x + NB.w, LB.x + LB.w) - GX, GH = Math.max(NB.y + NB.h, LB.y + LB.h) - GY;
  const RS = Math.min(1.25, (F.safe.w * 0.94) / GW, (F.safe.h * 0.8) / GH), [gcx, gcy] = [GX + GW / 2, GY + GH / 2], [tcx, tcy] = L.center(F.safe);
  function reframe(r) {
    if (!r) return;
    const k = 1 + (RS - 1) * r;
    ctx.translate(gcx + (tcx - gcx) * r, gcy + (tcy - gcy) * r); ctx.scale(k, k); ctx.translate(-gcx, -gcy);
  }
  const mapR = (b) => (reAt === null ? b : { x: tcx + (b.x - gcx) * RS, y: tcy + (b.y - gcy) * RS, w: b.w * RS, h: b.h * RS });
  const NB1 = mapR(NB), padK = reAt === null ? 1 : RS;
  const B0 = { x: NB1.x - padN * padK, y: NB1.y - padN * padK, w: NB1.w + padN * padK * 2, h: NB1.h + padN * padK * 2 };
  function collapse(u) {
    if (!mark) return;
    const e = M.easeInOutCubic(u), lerp = (a, b) => a + (b - a) * e;
    const box = { x: lerp(B0.x, mark.x), y: lerp(B0.y, mark.y), w: lerp(B0.w, mark.w), h: lerp(B0.h, mark.h) };
    const slam = 1 + 0.05 * Math.max(0, 1 - u * 6);
    const [bx, by] = L.center(box);
    ctx.save(); ctx.translate(bx, by); ctx.scale(slam, slam); ctx.translate(-bx, -by);
    D.fillBox(ctx, box, 'accent', lerp(B0.h * 0.12, mark.w * 0.27));
    const kn = pushed * padK * (box.h / B0.h);
    D.withClip(ctx, (g) => D.rrect(g, box, lerp(B0.h * 0.12, mark.w * 0.27)), () => {
      ctx.translate(bx - (tw * kn) / 2, by + (numFit.cap * kn) / 2); ctx.scale(kn, kn);
      T.drawText(ctx, theme, finalTxt, 0, 0, { role: 'display', size: numFit.size, color: 'fg', log: false });
    });
    ctx.restore();
  }
  return { id: 'metric', beats, events, sfx, transition: { type: 'push', beats: 1, dir: 'l' }, collapse, colSpan: colAt !== null ? beats - colAt : 0, draw };
}

/** Beats the metric->mark collapse takes (half before the cut, half after). */
export const COL = 2;

/**
 * End card (a cut in the middle of the metric's collapse): the accent plate finishes shrinking into the mark and
 * the logo mark lands on beat 1 (thump); the wordmark wipes out of it and the tagline slams on beat 2 (hit); the
 * pill punches in with the URL on the LAST beat (thump + pop + ring), so the lockup completes on the final hit
 * instead of holding settled.
 */
export function ctaScene(api, c, logo, beats, lay, metric) {
  const { F, ctx, theme, T, L, M, D } = api;
  const { lb, mark, tagFit, pill, cS, urlFit, nameFit } = lay;
  const left = metric && metric.colSpan ? COL - metric.colSpan : 0;      // collapse beats still to run after the cut
  const markAt = Math.max(left, 0.5), wordAt = Math.min(beats - 1, markAt + 1), pillAt = Math.max(wordAt + 0.5, beats - 1);
  const events = [0, markAt, wordAt, pillAt].filter((b, k, a) => b < beats && a.indexOf(b) === k);
  const sfx = [...(left > 0 ? [{ at: 0, sfx: 'whoosh', gain_db: -8 }] : []), { at: markAt, sfx: 'thump', gain_db: -4 }, { at: wordAt, sfx: 'thump', gain_db: -3 },
    { at: wordAt, sfx: 'pop', gain_db: -10 }, { at: pillAt, sfx: 'thump', gain_db: -2 }, { at: pillAt, sfx: 'pop', gain_db: -6 },
    ...(urlFit ? [{ at: pillAt + 0.25, sfx: 'tick', gain_db: -14 }] : [])].filter((x) => x.at < beats);
  const [mx, my] = L.center(mark);
  const bot = urlFit ? urlFit.box.y + urlFit.box.h : pill.y + pill.h;
  const lc = [F.cx, (Math.min(lb.y, pill.y) + Math.max(bot, lb.y + lb.h)) / 2];
  return { id: 'cta', beats: 'fill', events, sfx, transition: { type: 'cut' }, draw(f) {
    if (left > 0 && f.lb < markAt) metric.collapse((metric.colSpan + f.lb) / COL);
    // The final downbeat punches the whole lockup (1 -> 1.07 -> 1) as the pill lands: the film ends on a hit.
    // (16:9: the lockup spans the safe width edge to edge, so only the pill column punches, harder.)
    const fh = f.hit(pillAt - 0.15, 0.4 * f.spb, 'stiff'), fk = 1 + (F.orient === 'h' ? 0 : 0.07) * fh;
    ctx.save(); ctx.translate(lc[0], lc[1]); ctx.scale(fk, fk); ctx.translate(-lc[0], -lc[1]);
    const lk = 1 + 0.08 * f.hit(markAt, 0.3 * f.spb, 'stiff') + 0.05 * f.hit(wordAt, 0.3 * f.spb, 'stiff') + (F.orient === 'h' ? 0.1 : 0.04) * f.hit(pillAt - 0.15, 0.4 * f.spb, 'stiff');
    if (f.lb >= markAt) {
      const p = M.clamp(M.sp(f.since(wordAt - 0.3), [0.28, 0.88]));   // visuals lead their hit so the beat frame shows them
      ctx.save();
      ctx.translate(mx, my); ctx.scale(lk, lk); ctx.translate(-mx, -my);
      if (logo) {
        // The mark is on screen from markAt; the wordmark wipes out of it on wordAt.
        const right = mark.x + mark.w, w = right - lb.x + (lb.x + lb.w - right) * p;
        D.withClip(ctx, (g) => g.rect(lb.x - 4, lb.y - lb.h * 0.2, w + 4, lb.h * 1.4), () => ctx.drawImage(logo, lb.x, lb.y, lb.w, lb.h));
      } else if (nameFit) T.kinetic(f, nameFit, { by: 'char', at: wordAt, stagger: 0.03, from: 'mask', spring: TYPE });
      ctx.restore();
    }
    if (tagFit) T.kinetic(f, tagFit, { by: 'line', at: wordAt - 0.3, stagger: 0.08, from: 'mask', spring: TYPE });
    const g = M.sp(f.since(pillAt - 0.35), POP);
    if (g > 0) {
      const k = Math.max(0, g) * (F.orient === 'h' ? 1 + 0.08 * fh : 1), [px, py] = L.center(pill);
      const pl = plateOn(api, 'accent', cS);
      ctx.save(); ctx.translate(px, py); ctx.scale(k, k); ctx.translate(-px, -py);
      D.fillBox(ctx, pill, pl.fill, pill.h / 2);
      T.drawText(ctx, theme, c.text, px, pill.y + pill.h / 2 + cS * 0.36, { role: 'ui', size: cS, weight: 700, color: pl.text, align: 'c', rest: [px, pill.y + pill.h / 2 + cS * 0.36] });
      ctx.restore();
      const r = M.clamp(f.since(pillAt) / (0.7 * f.spb));
      if (r > 0 && r < 0.999) D.strokeBox(ctx, L.inset(pill, -M.easeOutQuart(r) * 40 * F.u), 'accent', 9 * F.u * (1 - r), pill.h);
    }
    if (urlFit) T.kinetic(f, urlFit, { by: 'char', at: pillAt - 0.3, stagger: 0.012, from: 'below', spring: TYPE, color: inkOn(api, 'muted', 'bg', urlFit.size, 0.9) });
    ctx.restore();
  } };
}
