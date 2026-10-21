// stage.js: helpers over captured screens for product-launch (pure, build-time or per-frame, no frame state):
// springs, rect trimming, card restacks for the assemble grid, and crops cut on clear columns (snapCrop/fitCrop)
// so a crop never ends mid-word.
export const UI = [0.28, 0.79];   // UI spring: damping ratio ~0.79, a tiny (~1.5%) overshoot
export const POP = [0.32, 0.56];  // landing spring: damping ratio ~0.56, a visible overshoot
export const TYPE = 'stiff';   // type spring: near-critical, no overshoot

/**
 * Trim q to the largest part not covered by a rect that partially overlaps it (e.g. a popover captured on
 * top of a banner), so a drawn rect never carries a sliver of another element.
 */
export function trimRect(api, scr, q) {
  let r = q;
  const all = Object.keys(scr.rects || {}).map((id) => api.A.capRect(scr, id));
  const holds = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  for (const o of all) {
    if (same(o, q)) continue;
    // Siblings inside one container (e.g. a palette row over a card behind the palette) are different layers.
    const cuts = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y) && !holds(a, b) && !holds(b, a);
    // ... and a rect cut by q's container lies behind that container (a card under an open palette).
    if (all.some((P) => !same(P, q) && !same(P, o) && holds(P, q) && (holds(P, o) || cuts(P, o)))) continue;
    const dis = o.x + o.w <= r.x || r.x + r.w <= o.x || o.y + o.h <= r.y || r.y + r.h <= o.y;
    const inO = r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
    const oIn = o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h;
    if (dis || inO || oIn) continue;
    const parts = [
      { x: r.x, y: r.y, w: o.x - r.x, h: r.h }, { x: o.x + o.w, y: r.y, w: r.x + r.w - o.x - o.w, h: r.h },
      { x: r.x, y: r.y, w: r.w, h: o.y - r.y }, { x: r.x, y: o.y + o.h, w: r.w, h: r.y + r.h - o.y - o.h },
    ].filter((p) => p.w > 0 && p.h > 0).sort((a, b) => b.w * b.h - a.w * a.h);
    if (parts.length) r = parts[0];
  }
  return r;
}

/** Sample one screenshot pixel as an rgb() string (build time; deterministic). */
export function samplePx(img, x, y) {
  try {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1;
    const g = c.getContext('2d'); g.drawImage(img, Math.round(x), Math.round(y), 1, 1, 0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${gg},${b})`;
  } catch { return null; }
}

/**
 * Card restack: a wide captured card (KPI tile, chart) does not fit a portrait or square grid cell at a
 * readable scale. Instead of shrinking the whole card, its two real regions (the "head": label/number or
 * chart title, and the "tail": sparkline or the latest stretch of the plot) are cropped and re-stacked
 * inside a frame sampled from the card itself. Fractions are of the cap rect (x, y, w, h).
 */
export function cardParts(q) {
  const a = q.w / q.h;
  if (a >= 2.2) return { head: [0.03, 0.08, 0.54, 0.86], tail: [0.66, 0.5, 0.31, 0.4], tailMax: 1.4, tailAlign: 'r' };
  if (a >= 1.4) return { head: [0.02, 0.03, 0.3, 0.11], tail: [0.6, 0.22, 0.38, 0.76], tailMax: 1.2, tailAlign: 'c' };
  return null;
}

const sub = (q, r) => ({ x: q.x + r[0] * q.w, y: q.y + r[1] * q.h, w: r[2] * q.w, h: r[3] * q.h });

/**
 * layoutCard(q, cell, kmax) -> {bg, border, draws: [{src, dst}]} for one captured rect q in a canvas cell.
 * Wide cards are restacked (head over tail); anything else is drawn whole at contain scale.
 */
export function layoutCard(img, q, cell, kmax = 1.25, minK = Infinity) {
  const parts = cardParts(q);
  const bg = samplePx(img, q.x + q.w * 0.6, q.y + q.h * 0.06);
  const border = samplePx(img, q.x + q.w * 0.5, q.y + 1);
  const whole = () => {
    const k = Math.min(cell.w / q.w, cell.h / q.h);
    const dst = { x: cell.x + (cell.w - q.w * k) / 2, y: cell.y + (cell.h - q.h * k) / 2, w: q.w * k, h: q.h * k };
    return { bg: null, border: null, frame: dst, draws: [{ src: q, dst }], k };
  };
  if (!parts || cell.w / cell.h > q.w / q.h * 0.8 || Math.min(cell.w / q.w, cell.h / q.h) >= minK) return whole();
  const pad = Math.min(cell.w, cell.h) * 0.06, gap = pad * 0.6;
  const inner = { x: cell.x + pad, y: cell.y + pad, w: cell.w - 2 * pad, h: cell.h - 2 * pad };
  const hs = sub(q, parts.head), ts = snapLeft(img, sub(q, parts.tail), q.w * 0.14);
  const kh = Math.min(inner.w / hs.w, kmax, (inner.h * 0.62) / hs.h);
  const head = { x: inner.x, y: inner.y, w: hs.w * kh, h: hs.h * kh };
  const room = inner.h - head.h - gap;
  const kt = Math.max(0, Math.min(inner.w / ts.w, parts.tailMax, room / ts.h));
  const tw = ts.w * kt, th = ts.h * kt;
  const tx = parts.tailAlign === 'r' ? inner.x + inner.w - tw : inner.x + (inner.w - tw) / 2;
  const tail = { x: tx, y: inner.y + inner.h - th, w: tw, h: th };
  return { bg, border, frame: cell, draws: [{ src: hs, dst: head }, { src: ts, dst: tail }], k: Math.min(kh, kt) };
}

/**
 * Move a crop's left edge right to the first clear gutter (a run of columns with no ink against the card bg)
 * within `reach` px, so a bar chart crop never starts on a sliver of a bar. Continuous content (a line or an
 * area fill) has no gutter, and the crop is kept as is. Build time; deterministic.
 */
export function snapLeft(img, r, reach) {
  try {
    const W = Math.round(Math.min(reach, r.w * 0.5)), H = Math.round(r.h);
    if (W < 8 || H < 8) return r;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, Math.round(r.x), Math.round(r.y), W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const bg = px(W - 1, 2);
    const clear = (x) => {   // gridlines and an axis cross every column: allow 8% of rows with ink
      let ink = 0, n = 0;
      for (let y = 0; y < H; y += 3, n++) { const p = px(x, y); if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 24) ink++; }
      return ink <= n * 0.08;
    };
    if (clear(0) && clear(1)) return r;            // already starts in a gutter
    for (let x = 0, run = 0; x < W; x++) {
      run = clear(x) ? run + 1 : 0;
      if (run >= 6) { const nx = x - run + 1 + 3; return { x: r.x + nx, y: r.y, w: r.w - nx, h: r.h }; }
    }
    return r;
  } catch { return r; }
}


/**
 * Snap the cut edges of crop r (screenshot px) to the nearest "clear" column/row: one where the pixels are
 * uniform along the cut (no glyph, icon or border crosses it), searched within `reach` px, never into `keep`
 * (the rect that must stay whole). Edges that sit on the screenshot's or bound's own edge are left alone. So a
 * crop never ends mid-word and needs no feather. Build time; deterministic.
 */
export function snapCrop(img, r, { keep = null, bound = null, reach = 160 } = {}) {
  const B = bound || { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  const R = { x: Math.max(B.x, r.x - reach), y: Math.max(B.y, r.y - reach) };
  R.w = Math.min(B.x + B.w, r.x + r.w + reach) - R.x; R.h = Math.min(B.y + B.h, r.y + r.h + reach) - R.y;
  let d, W, H;
  try {
    W = Math.round(R.w); H = Math.round(R.h);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, Math.round(R.x), Math.round(R.y), W, H, 0, 0, W, H);
    d = g.getImageData(0, 0, W, H).data;
  } catch { return r; }
  const px = (x, y) => (y * W + x) * 4;
  const diff = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  // A column is clear when it matches its neighbour 3 px away on (almost) every row of the crop.
  const y0 = Math.max(0, Math.round(r.y - R.y)), y1 = Math.min(H - 1, Math.round(r.y + r.h - R.y));
  const x0 = Math.max(0, Math.round(r.x - R.x)), x1 = Math.min(W - 1, Math.round(r.x + r.w - R.x));
  const colClear = (x) => { if (x < 0 || x + 3 >= W) return false; let bad = 0, n = 0; for (let y = y0; y < y1; y += 2, n++) if (diff(px(x, y), px(x + 3, y)) > 20) bad++; return bad <= n * 0.01; };
  const rowClear = (y) => { if (y < 0 || y + 3 >= H) return false; let bad = 0, n = 0; for (let x = x0; x < x1; x += 2, n++) if (diff(px(x, y), px(x, y + 3)) > 20) bad++; return bad <= n * 0.01; };
  const near = (e, ok, lo, hi) => {   // the closest clear line to e within [lo, hi] (local px), with a 4-line run
    for (let s = 0; s <= reach; s++) for (const c of [e - s, e + s]) {
      if (c < lo || c > hi) continue;
      if (ok(c) && ok(c - 1) && ok(c + 1) && ok(c + 2)) return c;
    }
    return e;
  };
  const K = keep ? { x0: keep.x - R.x, x1: keep.x + keep.w - R.x, y0: keep.y - R.y, y1: keep.y + keep.h - R.y } : null;
  let L = r.x - R.x, Rr = r.x + r.w - R.x, T = r.y - R.y, Bt = r.y + r.h - R.y;
  if (r.x > B.x + 1) L = near(Math.round(L), colClear, 0, K ? K.x0 : Rr - 8);
  if (r.x + r.w < B.x + B.w - 1) Rr = near(Math.round(Rr), colClear, K ? K.x1 : L + 8, W - 4);
  if (r.y > B.y + 1) T = near(Math.round(T), rowClear, 0, K ? K.y0 : Bt - 8);
  if (r.y + r.h < B.y + B.h - 1) Bt = near(Math.round(Bt), rowClear, K ? K.y1 : T + 8, H - 4);
  return { x: R.x + L, y: R.y + T, w: Math.max(8, Rr - L), h: Math.max(8, Bt - T) };
}

/**
 * fitCrop(img, R, box, {kMin, kMax, focus}) -> {src, dst, k}: show captured rect R in canvas box at a readable
 * scale. Whole when it fits at >= kMin canvas px per screenshot px; otherwise a window of R at kMin, placed at
 * focus ([fx, fy] fractions of R, default the leading edge) with its cut edges snapped to clear columns/rows.
 */
export function fitCrop(img, R, box, { kMin = 0, kMax = 2, focus = [0, 0], align = 'c' } = {}) {
  // A left-aligned element (banner, row) with empty space on its right is shown up to its last ink, plus a margin.
  if (Math.min(box.w / R.w, box.h / R.h) < kMin) {
    const T = trimInk(img, R);
    if (Math.min(box.w / T.w, box.h / T.h) >= kMin * 0.88) R = T;
  }
  let k = Math.min(box.w / R.w, box.h / R.h, kMax), src = R;
  if (k < kMin) {
    k = kMin;
    const w = Math.min(R.w, box.w / k), h = Math.min(R.h, box.h / k);
    const x = Math.min(R.x + R.w - w, Math.max(R.x, R.x + focus[0] * R.w - (focus[0] ? w / 2 : 0)));
    const y = Math.min(R.y + R.h - h, Math.max(R.y, R.y + focus[1] * R.h - (focus[1] ? h / 2 : 0)));
    src = snapCrop(img, { x, y, w, h }, { bound: R, reach: Math.round(Math.max(60, Math.min(w, h) * 0.25)) });
    k = Math.min(k, box.w / src.w, box.h / src.h);
  }
  const w = src.w * k, h = src.h * k;
  const dx = align === 'l' ? box.x : box.x + (box.w - w) / 2;
  return { src, k, dst: { x: dx, y: box.y + (box.h - h) / 2, w, h } };
}

/** R with its empty right-hand run cut away (the last column with glyph ink, plus a 44 px margin). Build time. */
export function trimInk(img, R) {
  try {
    const W = Math.round(R.w), H = Math.round(R.h);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, Math.round(R.x), Math.round(R.y), W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => (y * W + x) * 4;
    const y0 = Math.round(H * 0.15), y1 = Math.round(H * 0.85);   // skip the element's own top/bottom border
    for (let x = W - 16; x > W * 0.3; x--) {
      for (let y = y0; y < y1; y += 2) {
        const a = at(x, y), b = at(x, y + 2);   // vertical change: glyphs have it, a popover's shadow (a horizontal gradient) does not
        if (Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]) > 40) return { ...R, w: Math.min(R.w, x + 44) };
      }
    }
    return R;
  } catch { return R; }
}

/** Map a screenshot rect q into a crop's canvas dst. */
export const mapCrop = (c, q) => ({ x: c.dst.x + (q.x - c.src.x) * c.k, y: c.dst.y + (q.y - c.src.y) * c.k, w: q.w * c.k, h: q.h * c.k });
