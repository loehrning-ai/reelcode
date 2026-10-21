// lockup.js: per-format geometry of the brand lockup (mark + name + full stop + tagline) and the primitives that
// draw it. Geometry is computed once at build time from content and the format; draw helpers take explicit
// progress values, so the sting and the end card share one lockup and every frame stays a function of time.

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();

/** Balanced 2-line break (no orphan): the word split that minimises the wider line. */
function balance(T, ctx, theme, str) {
  const w = String(str).split(/\s+/).filter(Boolean);
  let best = null;
  for (let k = 1; k < w.length; k++) {
    const a = w.slice(0, k).join(' '), b = w.slice(k).join(' ');
    const m = Math.max(T.measure(ctx, theme, 'ui', a, 100).w, T.measure(ctx, theme, 'ui', b, 100).w);
    if (!best || m < best[0]) best = [m, `${a}\n${b}`];
  }
  return best ? best[1] : str;
}

/** Group bbox of positioned parts. */
function bboxOf(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * geom(api, data) -> lockup layout in canvas px:
 * {type, layout, name, nameSize, cap, lines:[{s,x,y (baseline),w}], nameW, mark:Box|null, radius, dot:{x,y,r}|null,
 *  target:Box (where the slab lands), tag:fit|null, group:Box, logo, crop, mono:fit|null, onAccent}
 */
export function geom(api, data, opts = {}) {
  const { F, ctx, theme, T, assets, project } = api;
  const S = F.safe, R = (k) => T.readable(F, k);
  const m0 = data.mark || {};
  const name = data.name || (project.brand && project.brand.name) || project.title;
  const logo = assets.logo || null;
  const type = m0.type || (logo ? 'logo' : 'monogram');
  if (type === 'logo' && !logo) throw new Error('logo-sting: content.mark.type "logo" needs brand.logo (or a captured logo); use "monogram" or "none"');
  const whole = type === 'logo' && m0.wordmark === false; // the logo image already carries the name
  const hasName = !whole;
  const iw = logo ? logo.naturalWidth || logo.width || 1 : 1, ih = logo ? logo.naturalHeight || logo.height || 1 : 1;
  const cropF = type === 'logo' && m0.crop ? m0.crop : [0, 0, 1, 1];
  const crop = [cropF[0] * iw, cropF[1] * ih, cropF[2] * iw, cropF[3] * ih];
  const aspect = type === 'logo' ? crop[2] / Math.max(1e-6, crop[3]) : 1;
  const layout = (data.layout && data.layout !== 'auto') ? data.layout : F.aspect < 0.85 ? 'stack' : 'row';
  const capR = T.measure(ctx, theme, 'display', 'H', 100).cap / 100;
  const w100 = hasName ? T.measure(ctx, theme, 'display', name, 100).w : 0;
  const useDot = data.dot !== false && hasName;
  const dotK = useDot ? capR * 0.15 * 3.4 : 0;           // width of the full stop (r = 0.15 cap) plus its gap, per size unit
  const K = type === 'none' ? 0 : 2.1;                    // mark height in caps (row)
  const G = 0.28;                                         // gap between mark and name, in mark heights
  const maxW = S.w * F.pick({ v: 0.9, s: 0.86, h: 0.82 }) * (opts.widthK || 1);
  const wOf = (str) => T.measure(ctx, theme, 'display', str, 100).w / 100;
  let size, mark = null, lines = [], lead = 1;
  if (whole) {
    const mh = Math.min(S.h * F.pick({ v: 0.14, s: 0.2, h: 0.26 }), maxW / aspect);
    mark = { x: 0, y: 0, w: mh * aspect, h: mh };
    size = mh / 1.5 / capR;
  } else if (type === 'none' || layout === 'row') {
    const perS = capR * K * (aspect + G) + w100 / 100 + dotK;
    size = Math.min(maxW / perS, (S.h * F.pick({ v: 0.2, s: 0.28, h: 0.34 })) / Math.max(K, 1.4) / capR);
    const mh = K * capR * size;
    if (type !== 'none') mark = { x: 0, y: 0, w: mh * aspect, h: mh };
    lines = [{ s: name, x: mark ? mark.w + G * mh : 0, y: mark ? mh / 2 + (capR * size) / 2 : capR * size, w: w100 / 100 }];
  } else { // stack: mark above, the name centred below; a two-word name may break onto 2 balanced lines when that is much larger
    const mh = Math.min((S.w * 0.42) / aspect, S.h * F.pick({ v: 0.22, s: 0.3, h: 0.34 }));
    const capMax = mh * 0.62 / capR;
    const one = Math.min(maxW / (w100 / 100 + dotK), capMax);
    const words = name.split(/\s+/).filter(Boolean);
    let split = null;
    for (let k = 1; k < words.length; k++) {
      const pr = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const wide = Math.max(wOf(pr[0]), wOf(pr[1]) + dotK);
      if (!split || wide < split.wide) split = { pr, wide };
    }
    const two = split ? Math.min(maxW / split.wide, capMax) : 0;
    const strs = two > one * 1.3 ? split.pr : [name];
    size = strs.length > 1 ? two : one;
    lead = 0.98;
    const gap = mh * 0.3, y0 = mh + gap + capR * size;
    const ws = strs.map(wOf), bw = Math.max(...ws) * size;
    lines = strs.map((t, i) => ({ s: t, x: (bw - ws[i] * size) / 2, y: y0 + i * size * lead, w: ws[i] }));
    mark = { x: (bw - mh * aspect) / 2, y: 0, w: mh * aspect, h: mh };
  }
  const cap = capR * size;
  lines = lines.map((l) => ({ ...l, w: l.w * size }));
  const dotR = cap * 0.15, ll = lines[lines.length - 1];
  const dot = useDot && ll ? { x: ll.x + ll.w + dotR * 1.9, y: ll.y - dotR, r: dotR } : null;
  const parts = [...(mark ? [mark] : []), ...lines.map((l, i) => ({ x: l.x, y: l.y - cap, w: l.w + (dot && i === lines.length - 1 ? dotR * 3.4 : 0), h: cap }))];
  let top = bboxOf(parts);
  // tagline: UI font, under the name (left-aligned in a row, centred in a stack); one line when it can stay readable
  let tag = null;
  if (data.tagline) {
    const ts = Math.max(R(1), Math.min(R(1.5), size * 0.3));
    const center = layout === 'stack' || type === 'none' || whole;
    const y = top.y + top.h + ts * 0.9 + cap * 0.2; // clear the descenders
    const tw = center ? Math.max(top.w, maxW) : Math.max(ll.w, maxW - ll.x);
    const tx = center ? top.x + top.w / 2 - tw / 2 : ll.x;
    const o = { role: 'ui', box: { x: tx, y, w: tw, h: ts * 1.3 }, max: ts, min: R(1), lines: 1, align: center ? 'c' : 'l' };
    tag = T.tryFit(ctx, theme, data.tagline, o);
    if (tag.overflow) tag = T.fitText(ctx, theme, balance(T, ctx, theme, data.tagline), { ...o, box: { ...o.box, h: ts * 2.6 }, min: R(1), lines: 'auto', leading: 1.25 });
  }
  // centre the group in the safe area (above the caption lane when captions are on)
  const group0 = bboxOf([top, ...(tag ? [tag.box] : [])]);
  const lane = api.captionTop != null ? Math.min(S.y + S.h, api.captionTop - R(1)) : S.y + S.h;
  const dx = S.x + (S.w - group0.w) / 2 - group0.x;
  const dy = Math.min(S.y + (S.h - group0.h) / 2, lane - group0.h) - group0.y;
  const mv = (b) => (b ? { ...b, x: b.x + dx, y: b.y + dy } : null);
  mark = mv(mark); top = mv(top);
  lines = lines.map(mv);
  if (tag) tag = shiftFit(tag, dx, dy);
  const dotP = mv(dot);
  const onAccent = T.bestOn(theme, theme.colors.accent);
  const mono = type === 'monogram' ? T.fitText(ctx, theme, m0.text || initials(name), { role: 'display', box: insetBox(mark, mark.h * 0.22), max: mark.h * 0.9, min: R(1), lines: 1, align: 'c', valign: 'c' }) : null;
  const radius = (m0.radius ?? 0.22) * (mark ? Math.min(mark.w, mark.h) : 0);
  const target = mark || { x: dotP.x - dotP.r, y: dotP.y - dotP.r, w: dotP.r * 2, h: dotP.r * 2 };
  const nameW = Math.max(0, ...lines.map((l) => l.w));
  return { type, whole, hasName, layout, name, nameSize: size, cap, lines, nameW, mark, radius,
    dot: dotP, target, tag, group: bboxOf([top, ...(tag ? [tag.box] : [])]), logo, crop, mono, onAccent, bandH: mark ? Math.min(mark.h, cap * 2.1) : cap * 1.3 };
}

/** Display-font line options for a name: [[name]] plus the balanced 2-line split when it has 2+ words. */
export function nameLines(api, name) {
  const { ctx, theme, T } = api;
  const wOf = (str) => T.measure(ctx, theme, 'display', str, 100).w / 100;
  const words = String(name).split(/\s+/).filter(Boolean);
  const out = [[name]];
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const pr = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const wide = Math.max(wOf(pr[0]), wOf(pr[1]));
    if (!best || wide < best.wide) best = { pr, wide };
  }
  if (best) out.push(best.pr);
  return out.map((ls) => ({ ls, wu: ls.map(wOf) }));
}

/**
 * heroGeom(api, data, box, {valign}) -> the END-CARD lockup: a flush-left stack (mark above the name, the name on
 * 1 or 2 lines, the tagline under it, every part on one left axis = box.x), sized as large as the box allows.
 * Same shape as geom(), so plate / markInner / nameReveal / fullStop draw it unchanged.
 */
export function heroGeom(api, data, box, { valign = 't', tagRoom: tagRoom0, tagCapK = 0 } = {}) {
  const { F, ctx, theme, T, assets, project } = api;
  const R = (k) => T.readable(F, k);
  const m0 = data.mark || {};
  const name = data.name || (project.brand && project.brand.name) || project.title;
  const logo = assets.logo || null;
  const type = m0.type || (logo ? 'logo' : 'monogram');
  const whole = type === 'logo' && m0.wordmark === false;
  const iw = logo ? logo.naturalWidth || logo.width || 1 : 1, ih = logo ? logo.naturalHeight || logo.height || 1 : 1;
  const cropF = type === 'logo' && m0.crop ? m0.crop : [0, 0, 1, 1];
  const crop = [cropF[0] * iw, cropF[1] * ih, cropF[2] * iw, cropF[3] * ih];
  const aspect = type === 'logo' ? crop[2] / Math.max(1e-6, crop[3]) : 1;
  const capR = T.measure(ctx, theme, 'display', 'H', 100).cap / 100;
  const useDot = data.dot !== false && !whole;
  const dotK = useDot ? capR * 0.15 * 3.4 : 0;
  const MK = 1.35, GAP = 0.3, lead = 0.98, desc = 0.22;           // mark height in caps, mark gap in mark heights
  const tagRoom = tagRoom0 ?? (data.tagline ? Math.max(R(1.5), (tagCapK * F.h) / 0.7) * 2.9 : 0);  // first pass: up to 2 tagline lines + gap; second pass: measured
  const hasMark = type !== 'none';
  let size, mark = null, lines = [];
  if (whole) {
    const mh = Math.min(box.w / aspect, (box.h - tagRoom) * 0.8);
    mark = { x: 0, y: 0, w: mh * aspect, h: mh };
    size = mh / 1.5 / capR;
  } else {
    let best = null;
    for (const c of nameLines(api, name)) {
      const wu = Math.max(...c.wu.map((w, i) => w + (i === c.wu.length - 1 ? dotK : 0)), hasMark ? capR * MK * aspect : 0);
      const hu = (hasMark ? capR * MK * (1 + GAP) : 0) + capR + (c.ls.length - 1) * lead + desc;
      const s = Math.min(box.w / wu, (box.h - tagRoom) / hu);
      if (!best || s > best.s * 1.04) best = { ...c, s };
    }
    size = best.s;
    const cap = capR * size, mh = hasMark ? cap * MK : 0;
    if (hasMark) mark = { x: 0, y: 0, w: mh * aspect, h: mh };
    const y0 = (hasMark ? mh * (1 + GAP) : 0) + cap;
    lines = best.ls.map((s, i) => ({ s, x: 0, y: y0 + i * size * lead, w: best.wu[i] * size }));
  }
  const cap = capR * size;
  const dotR = cap * 0.15, ll = lines[lines.length - 1];
  const dot = useDot && ll ? { x: ll.x + ll.w + dotR * 1.9, y: ll.y - dotR, r: dotR } : null;
  const parts = [...(mark ? [mark] : []), ...lines.map((l, i) => ({ x: l.x, y: l.y - cap, w: l.w + (dot && i === lines.length - 1 ? dotR * 3.4 : 0), h: cap }))];
  const top = bboxOf(parts);
  let tag = null;
  if (data.tagline) {
    // tagCapK: a phone floor for the tagline's cap height, as a fraction of the frame height
    const capUI = T.measure(ctx, theme, 'ui', 'H', 100).cap / 100;
    const ts = Math.max(R(1), (tagCapK * F.h) / capUI, Math.min(R(1.5), size * 0.2));
    const o = { role: 'ui', box: { x: 0, y: top.y + top.h + ts * 0.9 + cap * 0.2, w: box.w, h: ts * 1.3 }, max: ts, min: R(1), lines: 1, align: 'l' };
    tag = T.tryFit(ctx, theme, data.tagline, o);
    if (tag.overflow) tag = T.fitText(ctx, theme, balance(T, ctx, theme, data.tagline), { ...o, box: { ...o.box, h: ts * 2.6 }, lines: 'auto', leading: 1.25 });
  }
  const g0 = bboxOf([top, ...(tag ? [tag.box] : [])]);
  if (tagRoom0 === undefined && tag) {                              // second pass with the measured tagline room fills the box
    const g2 = heroGeom(api, data, box, { valign, tagCapK, tagRoom: tag.box.y + tag.box.h - (top.y + top.h) });
    if (g2.group.h <= box.h + 0.5 && g2.group.w <= box.w + 0.5) return g2;
  }
  const dx = box.x - g0.x, dy = (valign === 'c' ? box.y + (box.h - g0.h) / 2 : box.y) - g0.y;
  const mv = (b) => (b ? { ...b, x: b.x + dx, y: b.y + dy } : null);
  mark = mv(mark);
  lines = lines.map(mv);
  if (tag) tag = shiftFit(tag, dx, dy);
  const dotP = mv(dot);
  const onAccent = T.bestOn(theme, theme.colors.accent);
  const mono = type === 'monogram' ? T.fitText(ctx, theme, m0.text || initials(name), { role: 'display', box: insetBox(mark, mark.h * 0.22), max: mark.h * 0.9, min: R(1), lines: 1, align: 'c', valign: 'c' }) : null;
  const radius = (m0.radius ?? 0.22) * (mark ? Math.min(mark.w, mark.h) : 0);
  const target = mark || (dotP ? { x: dotP.x - dotP.r, y: dotP.y - dotP.r, w: dotP.r * 2, h: dotP.r * 2 } : { x: box.x, y: box.y, w: 0, h: 0 });
  const nameW = Math.max(0, ...lines.map((l) => l.w));
  const nameBox = lines.length ? bboxOf(lines.map((l) => ({ x: l.x, y: l.y - cap, w: l.w, h: cap }))) : mark;
  return { type, whole, hasName: !whole, layout: 'stack', name, nameSize: size, cap, lines, nameW, mark, radius, dot: dotP, target,
    tag, group: bboxOf([mv(top), ...(tag ? [tag.box] : [])]), nameBox, logo, crop, mono, onAccent };
}

const shiftFit = (ft, dx, dy) => ({ ...ft, box: { ...ft.box, x: ft.box.x + dx, y: ft.box.y + dy }, lines: ft.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })) });
const insetBox = (b, p) => ({ x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: b.h - 2 * p });

/** The accent plate: box centred at (cx, cy), rotated by angle, uniform scale sc, corner radius r. */
export function plate(api, cx, cy, w, h, { angle = 0, sc = 1, r = 0, color = 'accent' } = {}) {
  const { ctx, D } = api;
  if (w <= 0 || h <= 0 || sc <= 0) return;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(sc, sc);
  D.fillBox(ctx, { x: -w / 2, y: -h / 2, w, h }, color, r);
  ctx.restore();
}

/** The mark's content (logo crop through an iris, or the monogram rising inside the plate). */
export function markInner(api, g, { iris = 1, rise = 1, angle = 0, sc = 1, color }) {
  const { ctx, A, D, T, theme } = api;
  const m = g.mark;
  if (!m) return;
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
  if (g.type === 'logo' && iris > 0) {
    const rr = Math.hypot(m.w, m.h) * 0.5 * iris;
    D.withClip(ctx, (c) => { c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); }, () => A.drawImage(ctx, g.logo, m, { fit: 'contain', crop: g.crop }));
  } else if (g.type === 'monogram' && rise > 0) {
    const off = (1 - rise) * m.h * 0.8;
    D.withClip(ctx, (c) => D.rrect(c, m, g.radius), () => {
      for (const l of g.mono.lines) T.drawText(ctx, theme, l.s, l.x, l.y + off, { role: 'display', size: g.mono.size, color: color || g.onAccent, rest: [l.x, l.y] });
    });
  }
  ctx.restore();
}

/**
 * The name, revealed from behind the mark (row: slides right out of it; stack: rises out of it; none: slides
 * left out of the full stop). p 0..1 (spring); clipped so it never crosses the mark.
 */
export function nameReveal(api, g, p, color = 'fg') {
  const { ctx, T, theme, F, D } = api;
  if (!g.hasName || p <= 0) return;
  const draw = (dx, dy) => g.lines.forEach((l) => T.drawText(ctx, theme, l.s, l.x + dx, l.y + dy, { role: 'display', size: g.nameSize, color, rest: [l.x, l.y] }));
  const m = g.mark, q = 1 - p, l0 = g.lines[0];
  if (!m) { // slides out of the full stop, leftwards
    const edge = g.dot ? g.dot.x - g.dot.r * 0.9 : l0.x + l0.w;
    D.withClip(ctx, (c) => c.rect(0, 0, edge, F.h), () => draw(q * (g.nameW + g.cap), 0));
  } else if (g.layout === 'stack') {
    const lastY = g.lines[g.lines.length - 1].y;
    D.withClip(ctx, (c) => c.rect(0, m.y + m.h, F.w, F.h), () => draw(0, -q * (lastY - m.y - m.h + g.cap * 0.3)));
  } else {
    D.withClip(ctx, (c) => c.rect(m.x + m.w, 0, F.w, F.h), () => draw(-q * (g.nameW + m.w * 0.3), 0));
  }
}

/** The accent full stop after the name; drop = M.drop() result {p, sq} (lands from above with a squash). */
export function fullStop(api, g, d, color = 'accent') {
  const { ctx, theme } = api;
  if (!g.dot || d.p <= 0) return;
  const { x, y, r } = g.dot;
  const yy = y - (1 - d.p) * g.cap * 1.4, k = Math.min(0.45, d.sq * 0.8);
  ctx.save();
  ctx.fillStyle = theme.colors[color];
  ctx.beginPath(); ctx.ellipse(x, yy + r * k, r * (1 + k), r * (1 - k), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
