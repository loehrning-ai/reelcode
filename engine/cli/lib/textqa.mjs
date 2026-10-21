// textqa.mjs: automated text readability QA for lint (owner: captions-textqa).
// For every text box the page logs (drawText / kinetic / logRest), on every beat:
//   1. paint the frame twice, with ink on and with ink off (T.setInk(false): same layout, no glyphs), so the
//      pixels BEHIND the box are known exactly, and the glyph colour is measured from the difference;
//   2. keep only texts AT REST: ink is visible, and the glyph pixels and the background around them are unchanged
//      one frame later (text in flight and highlights sliding past are transients, checked on another beat);
//   3. WCAG contrast of the glyph colour against every background pixel in the box (the worst 10% of the box
//      decides, so a label half over a mid-tone fill fails, a hairline behind it does not): need 4.5 below 48 px,
//      3 for large text (>= 48 px);
//   4. at-rest box outside the safe area, or clipped by the canvas, unless the text is marked bleed:true;
//   5. 9x16: text smaller than 28 px at 1080 width (phone readability floor);
//   6. two different texts at rest whose boxes overlap (e.g. a lower third under the burned-in captions); a text
//      whose glyphs do not show at all (under an opaque panel drawn after it) is occluded, not overlapping: each
//      candidate is re-painted without its own glyphs (T.skipInk) and dropped when the frame does not change.
import { contrastNeed } from '../../text.js';
import { FORMATS } from '../../layout.js';

export const PHONE_MIN_PX = 28;
export const WORST_FRACTION = 0.1;
/** Overlap rule: the shared area is at least this share of the smaller box, and the rows overlap by at least this share. */
export const OVERLAP_AREA = 0.15, OVERLAP_ROWS = 0.3;

/**
 * overlaps(samples) -> [{a, b}]: pairs of different at-rest texts at the same time whose boxes overlap (pure).
 * The same string in (nearly) the same box is one text drawn twice (e.g. a highlighted word), not an overlap.
 */
export function overlaps(samples) {
  const byT = new Map(), out = [];
  for (const x of samples) if (x.state === 'rest' && !x.invisible && !x.occluded) { if (!byT.has(x.t)) byT.set(x.t, []); byT.get(x.t).push(x); }
  for (const list of byT.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].box, b = list[j].box;
      if (list[i].s === list[j].s && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2) continue;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w <= 0 || h <= 0) continue;
      if (w * h >= OVERLAP_AREA * Math.min(a.w * a.h, b.w * b.h) && h >= OVERLAP_ROWS * Math.min(a.h, b.h)) out.push({ a: list[i], b: list[j] });
    }
  }
  return out;
}

/** Runs in the page (self-contained; serialized by Playwright). */
async function inPage({ times, dt, W, H, frac, ovArea, ovRows }) {
  const T = await import('/engine/text.js');
  const fx = window.__reelcode, cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const LUT = new Float64Array(256);
  for (let v = 0; v < 256; v++) { const x = v / 255; LUT[v] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }
  const lum = (d, i) => 0.2126 * LUT[d[i]] + 0.7152 * LUT[d[i + 1]] + 0.0722 * LUT[d[i + 2]];
  const hex = (d, i) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const grab = () => ctx.getImageData(0, 0, W, H).data;
  const diff = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  const rgbOf = (c) => {
    if (!c) return null;
    const m = /^#([0-9a-f]{6})/i.exec(c);
    if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
    const r = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    return r ? [r[1], r[2], r[3]].map((v) => Math.round(Number(v))) : null;
  };
  const out = [];
  try {
    for (const t of times) {
      fx.seek(t);
      const rep = fx.report();
      if (rep.inTransition) continue;
      const on = grab();
      T.setInk(false); fx.seek(t); const off = grab(); T.setInk(true);
      const t2 = Math.min(t + dt, fx.duration);
      let on2 = null, off2 = null, texts2 = [];
      if (t2 > t + 1e-6) {
        fx.seek(t2); on2 = grab(); texts2 = fx.report().texts || [];
        T.setInk(false); fx.seek(t2); off2 = grab(); T.setInk(true);
      }
      const atT = [];
      for (const [li, x] of (rep.texts || []).entries()) {
        const b = x.box;
        const r = { t, scene: rep.scene, s: x.s, size: x.size, role: x.role, bleed: !!x.bleed, rest: !!x.rest, box: b, li };
        atT.push(r);
        const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
        const x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(H, Math.ceil(b.y + b.h));
        if (x1 - x0 < 1 || y1 - y0 < 1) { r.state = 'offcanvas'; out.push(r); continue; }
        const step = (x1 - x0) * (y1 - y0) > 60000 ? 2 : 1;
        const gw = Math.ceil((x1 - x0) / step), gh = Math.ceil((y1 - y0) / step);
        const idx = (gx, gy) => ((y0 + gy * step) * W + x0 + gx * step) * 4;
        // Ink = pixels the glyphs changed. With a logged fill colour, keep only ink of that colour, so another text
        // overlapping this box (a tooltip, a label behind) does not count as this text's glyphs.
        const lc = rgbOf(x.color);
        const near = (i) => !lc || Math.abs(on[i] - lc[0]) + Math.abs(on[i + 1] - lc[1]) + Math.abs(on[i + 2] - lc[2]) <= 90;
        const raw = new Uint8Array(gw * gh), own = new Uint8Array(gw * gh), rawInk = [], ownInk = [];
        let movedRaw = 0, movedOwn = 0;
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
          const i = idx(gx, gy), d = diff(on, off, i);
          if (d <= 30) continue;
          const mv = on2 && diff(on, on2, i) > 30;
          raw[gy * gw + gx] = 1; rawInk.push([d, i]); if (mv) movedRaw++;
          if (near(i)) { own[gy * gw + gx] = 1; ownInk.push([d, i]); if (mv) movedOwn++; }
        }
        // A logged colour with none of its ink visible means this text is hidden (other texts' ink is not its own).
        const useOwn = !!lc;
        const mask = useOwn ? own : raw, ink = useOwn ? ownInk : rawInk, moved = useOwn ? movedOwn : movedRaw;
        const same = !on2 || texts2.some((y) => y.s === x.s && Math.abs(y.box.x - b.x) < 0.75 && Math.abs(y.box.y - b.y) < 0.75 && Math.abs(y.box.w - b.w) < 0.75);
        // Under 3% of the box is antialiasing from another text's edges, not glyphs of this one.
        if (ink.length < Math.max(4, 0.03 * gw * gh)) {
          // No visible glyphs. Text drawn where it is logged, in a colour that matches what is behind it, is invisible.
          r.state = 'hidden';
          if (!x.rest && same && x.color) {
            const rgb = lc;
            if (rgb) {
              const fl = 0.2126 * LUT[Math.round(rgb[0])] + 0.7152 * LUT[Math.round(rgb[1])] + 0.0722 * LUT[Math.round(rgb[2])];
              const rs = [];
              for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { const l = lum(off, idx(gx, gy)); rs.push((Math.max(l, fl) + 0.05) / (Math.min(l, fl) + 0.05)); }
              rs.sort((p, q) => p - q);
              const medR = rs[rs.length >> 1];
              if (medR < 1.5) Object.assign(r, { state: 'rest', invisible: true, contrast: +rs[Math.floor(rs.length * frac)].toFixed(2), median: +medR.toFixed(2),
                fg: `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase(), bg: hex(off, idx(gw >> 1, gh >> 1)) });
            }
          }
          out.push(r); continue;
        }
        if (!same || moved / ink.length > 0.15) { r.state = 'moving'; out.push(r); continue; }
        // Glyph colour: the median of the strongest-difference quarter of the ink pixels (glyph cores, not edges).
        ink.sort((p, q) => q[0] - p[0]);
        const core = ink.slice(0, Math.max(1, Math.ceil(ink.length / 4))).map((p) => p[1]);
        const med = (k) => { const v = core.map((i) => on[i + k]).sort((p, q) => p - q); return v[v.length >> 1]; };
        const fg = useOwn ? lc : [med(0), med(1), med(2)];
        const fl = 0.2126 * LUT[fg[0]] + 0.7152 * LUT[fg[1]] + 0.0722 * LUT[fg[2]];
        // The ring just outside the glyphs (what each stroke is read against): dilate the ink mask by rad, minus the ink.
        const rad = Math.max(1, Math.round(Math.max(2, x.size * 0.04) / step));
        const rowD = new Uint8Array(gw * gh), ring = [];
        for (let gy = 0; gy < gh; gy++) {
          let last = -1e9;
          for (let gx = 0; gx < gw; gx++) { if (mask[gy * gw + gx]) last = gx; if (gx - last <= rad) rowD[gy * gw + gx] = 1; }
          last = 1e9;
          for (let gx = gw - 1; gx >= 0; gx--) { if (mask[gy * gw + gx]) last = gx; if (last - gx <= rad) rowD[gy * gw + gx] = 1; }
        }
        for (let gx = 0; gx < gw; gx++) {
          const col = new Uint8Array(gh);
          let last = -1e9;
          for (let gy = 0; gy < gh; gy++) { if (rowD[gy * gw + gx]) last = gy; if (gy - last <= rad) col[gy] = 1; }
          last = 1e9;
          for (let gy = gh - 1; gy >= 0; gy--) { if (rowD[gy * gw + gx]) last = gy; if (last - gy <= rad) col[gy] = 1; }
          for (let gy = 0; gy < gh; gy++) if (col[gy] && !mask[gy * gw + gx]) ring.push(idx(gx, gy));
        }
        const sample = ring.length >= 8 ? ring : ink.map((p) => p[1]);
        // At rest also means the background around the glyphs is still (a highlight sliding past is a transient).
        if (off2 && sample.filter((i) => diff(off, off2, i) > 30).length / sample.length > 0.15) { r.state = 'moving'; out.push(r); continue; }
        const ratios = sample.map((i) => { const l = lum(off, i); return [(Math.max(l, fl) + 0.05) / (Math.min(l, fl) + 0.05), i]; }).sort((p, q) => p[0] - q[0]);
        const k = Math.min(ratios.length - 1, Math.floor(ratios.length * frac));
        r.state = 'rest';
        r.contrast = +ratios[k][0].toFixed(2);
        r.median = +ratios[ratios.length >> 1][0].toFixed(2);
        r.fg = `#${fg.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
        r.bg = hex(off, ratios[k][1]);
        out.push(r);
      }
      // Occlusion: for an at-rest text that overlaps another, paint the frame without its glyphs only; if nothing in
      // its box changes, it is hidden (e.g. under an opaque panel drawn later) and cannot collide with anything.
      const rest = atT.filter((r) => r.state === 'rest' && !r.invisible);
      const cand = new Set();
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
        const a = rest[i].box, c = rest[j].box;
        if (rest[i].s === rest[j].s && Math.abs(a.x - c.x) < 2 && Math.abs(a.y - c.y) < 2) continue;
        const w = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), h = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
        if (w > 0 && h > 0 && w * h >= ovArea * Math.min(a.w * a.h, c.w * c.h) && h >= ovRows * Math.min(a.h, c.h)) { cand.add(rest[i]); cand.add(rest[j]); }
      }
      for (const r of cand) {
        T.skipInk(r.li); fx.seek(t); const without = grab(); T.skipInk(-1);
        if (!T.paintedInk(r.li)) continue; // glyphs drawn apart from their log entry: cannot tell, keep the sample
        const b = r.box, x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
        const x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(H, Math.ceil(b.y + b.h));
        let changed = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (diff(on, without, (y * W + x) * 4) > 30) changed++;
        if (changed < Math.max(4, 0.01 * (x1 - x0) * (y1 - y0))) r.occluded = true;
      }
    }
  } finally { T.setInk(true); T.skipInk(-1); }
  return out;
}

/** Sample times: one per beat on the beat grid, plus the last frame (the ending must read too). */
export function qaTimes(info, fps = 30) {
  const d = info.duration;
  return [...new Set([...info.beatTimes.filter((t) => t < d - 1e-6), Math.max(0, d - 1 / fps)].map((t) => +t.toFixed(6)))].sort((a, b) => a - b);
}

/**
 * classify(sample, fmt) -> [{kind, msg}]: the issues of one at-rest sample (pure; unit-tested).
 * kinds: contrast | safe | clipped | tiny (summarize adds overlap)
 */
export function classify(x, fmt) {
  const spec = FORMATS[fmt], W = spec.w, H = spec.h, s = spec.safe, b = x.box, out = [];
  if (x.state !== 'rest') return out;
  const need = contrastNeed(x.size, Math.min(W, H) / 1080);
  if (x.contrast < need) out.push({ kind: 'contrast', need, msg: x.invisible
    ? `invisible: ${x.fg} text is drawn but none of it shows (${x.bg} behind or over it; contrast ${x.median.toFixed(2)})`
    : `contrast ${x.contrast.toFixed(2)} < ${need} (${x.fg} on ${x.bg} in the worst ${Math.round(WORST_FRACTION * 100)}% of the pixels around the glyphs; median ${x.median.toFixed(2)})` });
  if (!x.bleed) {
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5) out.push({ kind: 'clipped', msg: 'clipped by the canvas (mark bleed:true if intended)' });
    else if (b.x < s.l - 2 || b.y < s.t - 2 || b.x + b.w > W - s.r + 2 || b.y + b.h > H - s.b + 2) out.push({ kind: 'safe', msg: 'at rest outside the safe area' });
  }
  if (fmt === '9x16' && (x.size * 1080) / W < PHONE_MIN_PX - 0.05) out.push({ kind: 'tiny', msg: `${x.size.toFixed(1)}px < ${PHONE_MIN_PX}px at 1080 wide (phone floor)` });
  return out;
}

/**
 * summarize(samples, fmt) -> {checked, moving, hidden, issues:[{kind, t, scene, text, size, msg, contrast?, fg?, bg?, need?}]}
 * One issue per (kind, text, resting box), at the time it is worst (lowest contrast; else first seen).
 */
export function summarize(samples, fmt) {
  const best = new Map(), seen = new Set();
  let moving = 0, hidden = 0;
  for (const x of samples) {
    if (x.state === 'moving') { moving++; continue; }
    if (x.state === 'hidden' || x.state === 'offcanvas') { hidden++; continue; }
    seen.add(`${x.s}|${Math.round(x.box.x)}|${Math.round(x.box.y)}`);
    for (const iss of classify(x, fmt)) {
      const key = `${iss.kind}|${x.s}|${Math.round(x.box.x)}|${Math.round(x.box.y)}`;
      const prev = best.get(key);
      if (prev && !(iss.kind === 'contrast' && x.contrast < prev.contrast)) { prev.count++; continue; }
      best.set(key, { kind: iss.kind, t: +x.t.toFixed(3), scene: x.scene, text: x.s, size: +x.size.toFixed(1), msg: iss.msg,
        ...(iss.kind === 'contrast' ? { contrast: x.contrast, need: iss.need, fg: x.fg, bg: x.bg } : {}),
        box: { x: Math.round(x.box.x), y: Math.round(x.box.y), w: Math.round(x.box.w), h: Math.round(x.box.h) }, count: prev ? prev.count + 1 : 1 });
    }
  }
  for (const { a, b } of overlaps(samples)) {
    const key = `overlap|${a.s}|${b.s}`;
    if (best.has(key)) { best.get(key).count++; continue; }
    best.set(key, { kind: 'overlap', t: +a.t.toFixed(3), scene: a.scene, text: a.s, size: +a.size.toFixed(1),
      msg: `overlaps "${b.s}" (${Math.round(b.size)}px) at rest; move one of them (bottom-anchored text: keep above api.captionTop)`,
      box: { x: Math.round(a.box.x), y: Math.round(a.box.y), w: Math.round(a.box.w), h: Math.round(a.box.h) }, count: 1 });
  }
  const issues = mergeUnits([...best.values()].filter((i) => i.kind !== 'overlap')).concat([...best.values()].filter((i) => i.kind === 'overlap')).sort((a, b) => a.t - b.t || (a.text < b.text ? -1 : 1));
  return { checked: seen.size, samples: samples.length, moving, hidden, issues };
}

/**
 * Kinetic type logs one box per word or letter: merge issues of the same kind, scene, size and baseline row into
 * one issue for the whole line (text joined in x order; the worst unit's time and contrast kept; boxes united).
 */
export function mergeUnits(list) {
  const groups = new Map();
  for (const i of list) {
    const key = `${i.kind}|${i.scene}|${i.size}|${Math.round((i.box.y + i.box.h) / 4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    g.sort((a, b) => a.box.x - b.box.x);
    const worst = g.reduce((a, b) => (b.contrast !== undefined && b.contrast < a.contrast ? b : a));
    const x = Math.min(...g.map((i) => i.box.x)), y = Math.min(...g.map((i) => i.box.y));
    const x2 = Math.max(...g.map((i) => i.box.x + i.box.w)), y2 = Math.max(...g.map((i) => i.box.y + i.box.h));
    const chars = g.every((i) => [...i.text].length === 1);
    return { ...worst, text: g.map((i) => i.text).join(chars ? '' : ' '), units: g.length, box: { x, y, w: x2 - x, h: y2 - y },
      count: Math.max(...g.map((i) => i.count)) };
  });
}

/** Run the QA on an open page session; returns summarize(...) for that format. */
export async function textQA(s, fmt, { fps = 30 } = {}) {
  const spec = FORMATS[fmt];
  const samples = await s.page.evaluate(inPage, { times: qaTimes(s.info, fps), dt: 1 / fps, W: spec.w, H: spec.h, frac: WORST_FRACTION, ovArea: OVERLAP_AREA, ovRows: OVERLAP_ROWS });
  return summarize(samples, fmt);
}

/** "textqa [9x16] t=2.50 (scene): "TEXT" 34px: msg" */
export const issueLine = (fmt, i) => `textqa [${fmt}]: "${i.text}" ${i.size}px at t=${i.t.toFixed(2)} (${i.scene}): ${i.msg}`;

