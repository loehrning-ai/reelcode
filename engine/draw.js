// draw.js: shapes, clips, transition masks and polygon morphs. Colours are theme keys (see text.paint).
import { paint, logDisc, quiet } from './text.js';
import { clamp } from './motion.js';

const col = (ctx, c) => (ctx.__theme ? paint(ctx.__theme, c) : c);

/** Add a rounded rect path (beginPath included). */
export function rrect(ctx, b, r = 0) {
  ctx.beginPath();
  const rr = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  if (typeof ctx.roundRect === 'function') ctx.roundRect(b.x, b.y, b.w, b.h, rr);
  else ctx.rect(b.x, b.y, b.w, b.h);
}

export function fillBox(ctx, b, color, r = 0) {
  if (b.w <= 0 || b.h <= 0) return;
  ctx.fillStyle = col(ctx, color);
  if (r > 0) { rrect(ctx, b, r); ctx.fill(); } else ctx.fillRect(b.x, b.y, b.w, b.h);
}

export function strokeBox(ctx, b, color, width, r = 0) {
  ctx.strokeStyle = col(ctx, color); ctx.lineWidth = width;
  rrect(ctx, b, r); ctx.stroke();
}

/** Filled circle; counted in report().discs (the particle-burst heuristic). */
export function disc(ctx, x, y, r, color) {
  if (r <= 0) return;
  logDisc();
  ctx.fillStyle = col(ctx, color);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Point at fraction p along a polyline, plus the partial polyline up to it. */
export function along(pts, p) {
  const lens = pts.slice(1).map((q, i) => segLen(pts[i], q));
  const total = lens.reduce((a, b) => a + b, 0);
  let left = clamp(p) * total;
  const out = [pts[0]];
  for (let i = 0; i < lens.length; i++) {
    if (left >= lens[i]) { out.push(pts[i + 1]); left -= lens[i]; continue; }
    const f = lens[i] ? left / lens[i] : 0;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
    break;
  }
  return { pts: out, tip: out[out.length - 1], total };
}

/** Stroke a polyline; progress draws it on. Returns the tip [x, y]. */
export function line(ctx, pts, { color = 'fg', width = 4, progress = 1, cap = 'round', join = 'round' } = {}) {
  if (pts.length < 2 || progress <= 0) return pts[0];
  const { pts: part, tip } = along(pts, progress);
  ctx.strokeStyle = col(ctx, color); ctx.lineWidth = width; ctx.lineCap = cap; ctx.lineJoin = join;
  ctx.beginPath(); ctx.moveTo(part[0][0], part[0][1]);
  for (let i = 1; i < part.length; i++) ctx.lineTo(part[i][0], part[i][1]);
  ctx.stroke();
  return tip;
}

// One scratch buffer per size, cleared on every use (it carries nothing between frames).
const SCRATCH = new Map();
function scratch(w, h) {
  const key = `${w}x${h}`;
  if (!SCRATCH.has(key)) {
    const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    SCRATCH.set(key, { c, ctx: c.getContext('2d') });
  }
  return SCRATCH.get(key);
}

/**
 * blurred(ctx, F, amount 0..1, drawFn(c)): a short content blur (for a swap or a whip), done by drawing
 * into a downsampled buffer and scaling it back up (ctx.filter blur is banned as a glow tool, and so is this
 * for glows: use it on content in motion, never as a halo). drawFn draws with the same coordinates and the
 * same transform as ctx; its text log is muted, so log resting slots yourself (T.logText / T.logRest).
 * amount <= 0.02 draws directly into ctx (with logging). The current clip of ctx applies.
 */
export function blurred(ctx, F, amount, drawFn) {
  const a = clamp(amount);
  if (a <= 0.02) { drawFn(ctx); return; }
  const z = 1 + 15 * a, { c, ctx: o } = scratch(F.w, F.h);
  o.__theme = ctx.__theme;
  o.save();
  o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, F.w, F.h);
  const m = ctx.getTransform();
  o.setTransform(m.a / z, m.b / z, m.c / z, m.d / z, m.e / z, m.f / z);
  try { quiet(() => drawFn(o)); } finally { o.restore(); }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, F.w / z, F.h / z, 0, 0, F.w, F.h);
  ctx.restore();
}

const rgbaOf = (hex, a) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) throw new Error(`draw: feather needs a theme colour (got ${hex})`);
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * feather(ctx, box, side 'l'|'r'|'t'|'b', color='bg', {at=0.45, alpha=0.85}): an edge band that is opaque
 * at `side` and clear at the opposite edge, so a cropped screenshot or a cut card dissolves into the bg
 * instead of ending on a hard clip. For crop edges only (never a background or a glow).
 */
export function feather(ctx, box, side, color = 'bg', { at = 0.45, alpha = 0.85 } = {}) {
  if (box.w <= 0 || box.h <= 0) return;
  const c = col(ctx, color), { x, y, w, h } = box;
  const [x0, y0, x1, y1] = side === 'l' ? [x, y, x + w, y] : side === 'r' ? [x + w, y, x, y]
    : side === 't' ? [x, y, x, y + h] : side === 'b' ? [x, y + h, x, y] : null;
  if (x0 === undefined) throw new Error(`draw: feather side "${side}" (use l, r, t, b)`);
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, rgbaOf(c, 1)); g.addColorStop(at, rgbaOf(c, alpha)); g.addColorStop(1, rgbaOf(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

/** Clip to the path built by pathFn(ctx), run drawFn(), restore. */
export function withClip(ctx, pathFn, drawFn) {
  ctx.save(); ctx.beginPath(); pathFn(ctx); ctx.clip(); drawFn(); ctx.restore();
}

const DIRS = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
export const dirVec = (dir = 'l') => DIRS[dir] || DIRS.l;

/**
 * Add the reveal shape for progress p (0 = nothing, 1 = full frame) to the current path.
 * type: wipe (edge travels toward dir) | iris (circle from origin) | slats (staggered bands) | push (full frame).
 */
export function mask(ctx, type, p, F, opts = {}) {
  const { w, h } = F;
  p = clamp(p);
  if (type === 'wipe') {
    const d = opts.dir || 'l';
    if (d === 'l') ctx.rect(w * (1 - p), 0, w * p, h);
    else if (d === 'r') ctx.rect(0, 0, w * p, h);
    else if (d === 'u') ctx.rect(0, h * (1 - p), w, h * p);
    else ctx.rect(0, 0, w, h * p);
  } else if (type === 'iris') {
    const [ox, oy] = opts.origin ? [opts.origin[0] * w, opts.origin[1] * h] : [w / 2, h / 2];
    const R = Math.max(Math.hypot(ox, oy), Math.hypot(w - ox, oy), Math.hypot(ox, h - oy), Math.hypot(w - ox, h - oy));
    ctx.moveTo(ox + R * p, oy); ctx.arc(ox, oy, R * p, 0, Math.PI * 2);
  } else if (type === 'slats') {
    const n = opts.n || F.pick({ v: 5, s: 6, h: 8 });
    const vertical = F.orient !== 'v';
    const span = vertical ? w : h, len = vertical ? h : w, sw = span / n;
    for (let i = 0; i < n; i++) {
      const q = clamp(p * 1.6 - (i / n) * 0.6);
      if (q <= 0) continue;
      if (vertical) ctx.rect(i * sw, len * (1 - q), sw + 0.5, len * q);
      else ctx.rect(0, i * sw, len * q, sw + 0.5);
    }
  } else if (type === 'push') {
    ctx.rect(0, 0, w, h);
  } else throw new Error(`draw: unknown mask "${type}" (wipe, iris, slats, push)`);
}

// ---------- polygons for morphs ----------
/** Resample a closed polygon to N points evenly spaced by arc length, starting at pts[0]. */
export function resample(pts, N) {
  const ring = [...pts, pts[0]];
  const { total } = along(ring, 1);
  const out = [];
  for (let i = 0; i < N; i++) out.push(along(ring, i / N).tip);
  return total ? out : pts.slice(0, N);
}

const arcPts = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

export const pathOf = {
  /** Rounded rect starting at the top-centre, clockwise. */
  rrect(b, r, N = 96) {
    const rr = Math.max(0.001, Math.min(r, b.w / 2, b.h / 2)), H = Math.PI / 2;
    const pts = [[b.x + b.w / 2, b.y],
      ...arcPts(b.x + b.w - rr, b.y + rr, rr, -H, 0, 8), ...arcPts(b.x + b.w - rr, b.y + b.h - rr, rr, 0, H, 8),
      ...arcPts(b.x + rr, b.y + b.h - rr, rr, H, 2 * H, 8), ...arcPts(b.x + rr, b.y + rr, rr, 2 * H, 3 * H, 8)];
    return resample(pts, N);
  },
  circle(cx, cy, r, N = 96) {
    return Array.from({ length: N }, (_, i) => {
      const a = -Math.PI / 2 + (i / N) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  },
  /** Cursor-style arrow with its tip at (x, y), size s. */
  arrow(x, y, s, N = 96) {
    const P = [[0, 0], [0, 1], [0.27, 0.76], [0.43, 1.1], [0.58, 1.03], [0.43, 0.7], [0.75, 0.7]];
    return resample(P.map(([a, b]) => [x + a * s, y + b * s]), N);
  },
};

/** Build the path of polygon A morphed toward B by p (both resampled to the same N). Returns the points. */
export function morph(ctx, A, B, p) {
  const n = Math.min(A.length, B.length);
  const pts = Array.from({ length: n }, (_, i) => [A[i][0] + (B[i][0] - A[i][0]) * p, A[i][1] + (B[i][1] - A[i][1]) * p]);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  return pts;
}

export function fillPoly(ctx, pts, color) {
  ctx.fillStyle = col(ctx, color);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fill();
}
