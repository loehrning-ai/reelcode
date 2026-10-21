// layout.js: formats, safe areas and Box helpers. A Box is {x, y, w, h} in canvas pixels.

export const FORMATS = Object.freeze({
  '9x16': Object.freeze({ w: 1080, h: 1920, safe: Object.freeze({ t: 240, b: 400, l: 72, r: 72 }) }),
  '1x1': Object.freeze({ w: 1080, h: 1080, safe: Object.freeze({ t: 72, b: 72, l: 72, r: 72 }) }),
  // 4:5 feed (Instagram/LinkedIn/Facebook). Portrait ('v'), with a deeper bottom margin for the feed's caption overlay.
  '4x5': Object.freeze({ w: 1080, h: 1350, safe: Object.freeze({ t: 88, b: 120, l: 72, r: 72 }) }),
  '16x9': Object.freeze({ w: 1920, h: 1080, safe: Object.freeze({ t: 64, b: 64, l: 110, r: 110 }) }),
});

const box = (x, y, w, h) => Object.freeze({ x, y, w: Math.max(0, w), h: Math.max(0, h) });
/** Every format id, in canonical order (schema enum, CLI --formats all, docs). */
export const FORMAT_IDS = Object.freeze(Object.keys(FORMATS));

export const orientOf = (w, h) => (w < h ? 'v' : w > h ? 'h' : 's');

/** Pick a per-orientation value; a missing key falls back v -> s -> h. */
export function pickBy(orient, obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (!('v' in obj || 's' in obj || 'h' in obj)) return obj;
  return obj[orient] !== undefined ? obj[orient] : obj.v !== undefined ? obj.v : obj.s !== undefined ? obj.s : obj.h;
}

/** frame(fmt) -> F: the per-format frame passed to build() and every draw(). */
export function frame(fmt) {
  const spec = FORMATS[fmt];
  if (!spec) throw new Error(`layout: unknown format "${fmt}" (use ${FORMAT_IDS.join(', ')})`);
  const { w, h, safe: s } = spec;
  const orient = orientOf(w, h);
  return Object.freeze({
    fmt, w, h, orient, u: Math.min(w, h) / 1080, aspect: w / h,
    full: box(0, 0, w, h), safe: box(s.l, s.t, w - s.l - s.r, h - s.t - s.b),
    cx: w / 2, cy: h / 2,
    pick: (obj) => pickBy(orient, obj),
  });
}

/** inset(box, px | {t, r, b, l}) */
export function inset(b, px) {
  const p = typeof px === 'number' ? { t: px, r: px, b: px, l: px } : { t: 0, r: 0, b: 0, l: 0, ...px };
  return box(b.x + p.l, b.y + p.t, b.w - p.l - p.r, b.h - p.t - p.b);
}

const axisOf = (b, axis) => {
  if (axis === 'x' || axis === 'y') return axis;
  const long = b.h >= b.w ? 'y' : 'x';
  if (axis === 'short') return long === 'y' ? 'x' : 'y';
  return long; // 'long' (default)
};

/**
 * split(box, ratios, {axis:'long'|'short'|'x'|'y', gap}) -> Box[]
 * 'long' stacks in a tall or square box (9x16, 1x1) and sits side by side in a wide one (16x9).
 */
export function split(b, ratios, { axis = 'long', gap = 0 } = {}) {
  const ax = axisOf(b, axis);
  const sum = ratios.reduce((a, r) => a + r, 0) || 1;
  const len = (ax === 'y' ? b.h : b.w) - gap * (ratios.length - 1);
  let at = ax === 'y' ? b.y : b.x;
  return ratios.map((r) => {
    const s = (len * r) / sum;
    const out = ax === 'y' ? box(b.x, at, b.w, s) : box(at, b.y, s, b.h);
    at += s + gap;
    return out;
  });
}

/** grid(box, n, {cols: number | {v,s,h}, gap, aspect?, orient?}) -> Box[] (row-major). */
export function grid(b, n, { cols = 1, gap = 0, aspect, orient } = {}) {
  const c = Math.max(1, Math.min(n, pickBy(orient || orientOf(b.w, b.h), cols) || 1));
  const rows = Math.max(1, Math.ceil(n / c));
  const cw = (b.w - gap * (c - 1)) / c, ch = (b.h - gap * (rows - 1)) / rows;
  const out = [];
  for (let i = 0; i < n; i++) {
    const cell = box(b.x + (i % c) * (cw + gap), b.y + Math.floor(i / c) * (ch + gap), cw, ch);
    out.push(aspect ? aspectFit(cell, aspect) : cell);
  }
  return out;
}

const ANCHORS = { c: [0.5, 0.5], n: [0.5, 0], s: [0.5, 1], e: [1, 0.5], w: [0, 0.5], ne: [1, 0], nw: [0, 0], se: [1, 1], sw: [0, 1] };

/** place(box, {w, h}, anchor, inset) -> Box of size {w, h} anchored inside box. */
export function place(b, size, anchor = 'c', ins = 0) {
  const a = ANCHORS[anchor];
  if (!a) throw new Error(`layout: unknown anchor "${anchor}"`);
  const inner = inset(b, ins);
  return box(inner.x + (inner.w - size.w) * a[0], inner.y + (inner.h - size.h) * a[1], size.w, size.h);
}

/** Largest box with w/h = ratio inside box. */
export function aspectFit(b, ratio, anchor = 'c') {
  const w = Math.min(b.w, b.h * ratio);
  return place(b, { w, h: w / ratio }, anchor);
}

export const lerpBox = (a, b, p) => box(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, a.w + (b.w - a.w) * p, a.h + (b.h - a.h) * p);
export const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
export const contains = (outer, b, tol = 0.5) =>
  b.x >= outer.x - tol && b.y >= outer.y - tol && b.x + b.w <= outer.x + outer.w + tol && b.y + b.h <= outer.y + outer.h + tol;
export const makeBox = box;
