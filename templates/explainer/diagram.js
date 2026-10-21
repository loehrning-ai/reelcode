// diagram.js: flow diagrams for the explainer: node boxes that open, arrows that draw on, labels, a travelling packet.
// Layout is planned once at build(); drawFlow(f, ...) is a pure function of f. Timing depends only on the
// content (node and edge counts), never on the format, so cues stay identical across 9x16, 1x1 and 16x9.
import { inkOn } from './ink.js';

const GAPK = 0.62;                 // vertical gap between nodes as a fraction of the node height
const GAPX = 0.42;                // horizontal gap as a fraction of the node width
const EDGE_K = 1.2;                // edge labels sit at >= 1.2x the readable size (phone check)
const DRAW = [0.66, 1];             // critically damped: arrows draw on without overshoot
export const KINDS = ['box', 'code', 'screen', 'frames', 'film', 'clock', 'wave', 'num'];
const kindOf = (nd) => nd.kind || 'box';

export const edgesOf = (d) => (d.edges && d.edges.length ? d.edges : d.nodes.slice(1).map((_, i) => ({ from: i, to: i + 1 })));

// A node's pop (snap spring) is visually complete POP beats after it starts; an arrow may only start drawing once
// both of its end nodes have popped, so no arrow ever points at an empty stub.
const POP = 0.2;

/** Local-beat timing for diagram d starting at `at`, one node every `step` beats. Content-only. */
export function flowTiming(d, at, step) {
  const n = d.nodes.length, edges = edgesOf(d);
  const nodeAt = (k) => at + k * step;
  const edgeAt = (e) => nodeAt(Math.max(e.from, e.to)) + POP;
  edges.forEach((e) => {   // invariant: node pop end <= first incoming edge start (and so <= its arrival)
    if (nodeAt(e.to) + POP > edgeAt(e) + 1e-9) throw new Error(`explainer: edge ${e.from}->${e.to} would draw before node ${e.to} has popped`);
  });
  return { nodeAt, edgeAt, doneAt: nodeAt(n - 1) + POP + 0.75, edges, n };
}

/** Throws with a content path when an edge points at a missing node. */
export function checkDiagram(d, where) {
  edgesOf(d).forEach((e, j) => {
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < d.nodes.length;
    if (!ok(e.from) || !ok(e.to) || e.from === e.to) throw new Error(`explainer: ${where}.edges[${j}] must join two different nodes (0..${d.nodes.length - 1})`);
  });
}

/**
 * Slots: a source node (not node 0, no incoming edge) with exactly one forward edge is a side input. It shares its
 * target's slot on a second lane (beside it in a column, below it in a row), so a 4-node "A -> B -> D <- C" flow reads
 * as three steps at the same node scale as its neighbours, not a cramped four-stack.
 */
function slotsOf(d, allowSide) {
  const edges = edgesOf(d), n = d.nodes.length, side = Array(n).fill(-1);
  if (allowSide) for (let k = 1; k < n; k++) {
    if (edges.some((e) => e.to === k)) continue;
    const out = edges.filter((e) => e.from === k);
    if (out.length === 1 && out[0].to > k && !side.includes(out[0].to)) side[k] = out[0].to;
  }
  const main = [...Array(n).keys()].filter((k) => side[k] < 0);
  const pos = Array.from({ length: n }, (_, k) => main.indexOf(side[k] < 0 ? k : side[k]));
  const rel = (e) => (side[e.from] === e.to || side[e.to] === e.from ? 'lane' : Math.abs(pos[e.to] - pos[e.from]) === 1 ? 'straight' : 'arc');
  return { side, pos, m: main.length, hasSide: side.some((s) => s >= 0), rel };
}

/** Move a polyline's first point `d` px toward its second (the packet starts outside the source box). */
const trim = (pts, d) => {
  const [[x0, y0], [x1, y1]] = pts, l = Math.hypot(x1 - x0, y1 - y0);
  return l > d * 1.5 ? [[x0 + ((x1 - x0) * d) / l, y0 + ((y1 - y0) * d) / l], ...pts.slice(1)] : pts;
};

/** Geometry only (no text fitting, so nothing is logged): node boxes, glyph and label boxes, edge paths. */
function geom(api, d, box, axis, o = {}, allowSide = true) {
  const { F, T, ctx, theme } = api;
  // numeral-only diagrams (the recap) run a tighter padding so the numeral stays at phone size in short bands
  const tight = d.nodes.every((nd) => kindOf(nd) === 'num') ? 0.7 : 1;
  const R = T.readable(F), pad = R * (axis === 'x' ? 0.32 : 0.45) * tight, u = F.u, n = d.nodes.length;
  const S = slotsOf(d, allowSide), m = S.m, edges = edgesOf(d), arcs = edges.some((e) => S.rel(e) === 'arc');
  const glyph = d.nodes.some((nd) => kindOf(nd) !== 'box');
  const lwOf = (s) => T.measure(ctx, theme, 'ui', s, R).w, elw = (e) => (e.label ? T.measure(ctx, theme, 'ui', e.label, R * EDGE_K).w : 0);
  const lw = Math.max(...d.nodes.map((nd) => lwOf(nd.label)));
  const cap = o.nodeH || Infinity, nodes = [];
  if (axis === 'x') {
    const nodeW = Math.min(box.w / (m + GAPX * (m - 1)), R * 11), gap = nodeW * GAPX, gapV = R * 1.9, rows = S.hasSide ? 2 : 1;
    const nodeH = Math.min((box.h - (rows - 1) * gapV) / rows, box.h * 0.5, nodeW * (glyph ? 0.95 : 0.55), R * 6, cap);
    const total = rows * nodeH + (rows - 1) * gapV, arcDir = S.hasSide ? -1 : 1;
    const x0 = box.x + (box.w - (m * nodeW + (m - 1) * gap)) / 2;
    const y0 = box.y + (box.h - total) / 2 - (arcs ? (box.h - total) * 0.2 * arcDir : 0);
    for (let k = 0; k < n; k++) {
      const b = { x: x0 + S.pos[k] * (nodeW + gap), y: y0 + (S.side[k] >= 0 ? nodeH + gapV : 0), w: nodeW, h: nodeH };
      const g = kindOf(d.nodes[k]) !== 'box';
      nodes.push({ b, gb: g ? { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h * 0.56 - pad } : null,
        lb: g ? { x: b.x + pad, y: b.y + b.h * 0.58, w: b.w - 2 * pad, h: b.h * 0.42 - pad } : { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h - 2 * pad }, align: 'c' });
    }
    const lh = R * 1.3;
    const geo = edges.map((e) => {
      const A = nodes[e.from].b, B = nodes[e.to].b, kind = S.rel(e);
      if (kind === 'lane') {                                    // side input below its target: a short vertical arrow up
        const x = A.x + A.w / 2, ay = A.y - 10 * u, by = B.y + B.h + 10 * u, lx = x + R * 0.6;
        return { e, pts: [[x, ay], [x, by]], lb: { x: lx, y: (ay + by) / 2 - lh / 2, w: A.x + A.w + gap * 0.9 - lx, h: lh }, align: 'l' };
      }
      if (kind === 'straight') {
        const s = Math.sign(B.x - A.x), cy = A.y + A.h / 2, ax = s > 0 ? A.x + A.w : A.x, bx = s > 0 ? B.x : B.x + B.w;
        const mx = (ax + bx) / 2, lwid = (nodeW + gap) * 0.92;
        // a label that fits inside the gap rides just above its arrow; a wider one sits just above the node tops
        const ly = elw(e) <= gap - R * 0.4 ? cy - R * 0.55 - lh : A.y - lh - R * 0.2;
        return { e, pts: [[ax + s * 12 * u, cy], [bx - s * 12 * u, cy]], lb: { x: mx - lwid / 2, y: ly, w: lwid, h: lh }, align: 'c' };
      }
      const edgeY = arcDir > 0 ? A.y + A.h + 10 * u : A.y - 10 * u;
      const room = arcDir > 0 ? box.y + box.h - edgeY - R * 1.8 : edgeY - box.y - R * 1.8;
      const depth = Math.max(R, Math.min(room, nodeH * 0.8)) * arcDir;
      const pts = quad([A.x + A.w / 2, edgeY], [(A.x + B.x + A.w) / 2, edgeY + depth * 2], [B.x + B.w / 2, edgeY]);
      const span = Math.abs(B.x - A.x), ly = arcDir > 0 ? edgeY + depth + R * 0.25 : edgeY + depth - R * 0.25 - lh;
      return { e, pts, lb: { x: (A.x + B.x + A.w) / 2 - span * 0.4, y: ly, w: span * 0.8, h: lh }, align: 'c' };
    });
    return { axis, nodes, edges: geo, nodeH, R, pad };
  }
  // vertical: a centred column that fills the box; labelled arrows get a gap tall enough for their own label lane
  const gapMin = edges.some((e) => e.label && S.rel(e) === 'straight') ? R * 1.7 : R * 0.6;
  const nodeH = Math.min(box.h / (m + GAPK * (m - 1)), m > 1 ? (box.h - (m - 1) * gapMin) / m : box.h, o.maxH || R * 4.5, cap), gs = nodeH - 2 * pad;
  const gap = m > 1 ? Math.max(gapMin, Math.min((box.h - m * nodeH) / (m - 1), nodeH * 1.3)) : 0;
  const gwOf = (nd) => (kindOf(nd) === 'num' ? gs * 1.5 : gs);
  const needOf = (nd) => lwOf(nd.label) + 2 * pad + (kindOf(nd) !== 'box' ? gwOf(nd) + pad : 0) + 6 * u;
  const colNeed = Math.max(...d.nodes.filter((_, k) => !S.hasSide || (S.side[k] < 0 && !S.side.includes(k))).map(needOf));
  const nodeW = Math.min(Math.max(colNeed, box.w * (arcs ? 0.62 : 0.8)), box.w * (arcs ? 0.7 : 0.86), o.maxW || R * 14);
  const laneRoom = (box.w - nodeW) / 2;
  const x0 = arcs && laneRoom < R * 2.5 ? box.x : box.x + (box.w - nodeW) / 2;   // centred unless the arc lane needs the room
  const y0 = box.y + (box.h - (m * nodeH + (m - 1) * gap)) / 2;
  const rowB = (k, x, w) => ({ x, y: y0 + S.pos[k] * (nodeH + gap), w, h: nodeH });
  const boxes = d.nodes.map((_, k) => rowB(k, x0, nodeW));
  for (let k = 0; k < n; k++) {                               // side rows: [side input] -> [target], spread across the box
    const t = S.side[k];
    if (t < 0) continue;
    const e = edges.find((x) => x.from === k), nS = needOf(d.nodes[k]), nT = needOf(d.nodes[t]);
    const laneGap = Math.max(R * 1.6, elw(e) + R * 0.8), extra = box.w - nS - nT - laneGap;
    if (extra < 0) return geom(api, d, box, axis, o, false);   // the second lane doesn't fit: plain column instead
    const wS = nS + extra * 0.3, wT = nT + extra * 0.3;
    boxes[k] = rowB(k, box.x, wS); boxes[t] = rowB(t, box.x + box.w - wT, wT);
  }
  for (let k = 0; k < n; k++) {
    const b = boxes[k], g = kindOf(d.nodes[k]) !== 'box', gw = gwOf(d.nodes[k]);
    nodes.push({ b, gb: g ? { x: b.x + pad, y: b.y + pad, w: gw, h: gs } : null,
      lb: g ? { x: b.x + 2 * pad + gw, y: b.y + pad, w: b.w - 3 * pad - gw, h: b.h - 2 * pad } : { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h - 2 * pad }, align: 'l' });
  }
  const geo = edges.map((e) => {
    const A = nodes[e.from].b, B = nodes[e.to].b, kind = S.rel(e);
    if (kind === 'lane') {                                    // side input -> target, a horizontal arrow; label rides above it
      const cy = A.y + A.h / 2, ax = A.x + A.w + 10 * u, bx = B.x - 10 * u, lh = R * 1.3;
      return { e, pts: [[ax, cy], [bx, cy]], lb: { x: ax, y: cy - R * 0.4 - lh, w: bx - ax, h: lh }, align: 'c' };
    }
    if (kind === 'straight') {
      const s = Math.sign(B.y - A.y), x1 = A.x + A.w / 2, x2 = B.x + B.w / 2, ay = s > 0 ? A.y + A.h : A.y, by = s > 0 ? B.y : B.y + B.h;
      const my = (ay + by) / 2, lx = Math.max(x1, x2) + R * 0.9;      // own lane, clear of the shaft and arrowhead
      return { e, pts: [[x1, ay + s * 10 * u], [x2, by - s * 10 * u]], lb: { x: lx, y: my - R * 0.68, w: box.x + box.w - lx, h: R * 1.36 }, align: 'l' };
    }
    const ax = A.x + A.w + 10 * u, reach = Math.max(R, Math.min(box.x + box.w - ax - pad, nodeH * 1.3));
    const pts = quad([ax, A.y + A.h / 2], [ax + reach * 2, (A.y + B.y + A.h) / 2], [ax, B.y + B.h / 2]);
    const lx = ax + reach + 16 * u;
    return { e, pts, lb: { x: lx, y: (A.y + B.y + A.h) / 2 - R * 0.7, w: Math.max(0, box.x + box.w - lx), h: R * 1.4 }, align: 'l' };
  });
  return { axis, nodes, edges: geo, nodeH, R, pad };
}

/** Natural node height of diagram d in box (before any shared cap); scene.js takes the minimum across steps. */
export const nodeHOf = (api, d, box, axis, o = {}) => geom(api, d, box, axis, o).nodeH;

function quad(a, c, b, N = 28) {
  return Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N, m = 1 - t;
    return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]];
  });
}

function fits(api, d, box, axis) {
  const { T, ctx, theme } = api;
  const g = geom(api, d, box, axis);
  if (g.nodes.some((nd, k) => T.measure(ctx, theme, 'ui', d.nodes[k].label, g.R).w > nd.lb.w - 4 * api.F.u)) return false;
  if (g.nodes.some((nd) => nd.lb.h < g.R * 0.8)) return false;
  return g.edges.every((eg) => !eg.e.label || T.measure(ctx, theme, 'ui', eg.e.label, g.R * EDGE_K).w <= eg.lb.w);
}

/** One axis per format for every diagram: the box's long axis when all labels fit at phone size, else the other. */
export function chooseAxis(api, diagrams, box) {
  const pref = box.w >= box.h * 1.15 ? 'x' : 'y', alt = pref === 'x' ? 'y' : 'x';
  if (diagrams.every((d) => fits(api, d, box, pref))) return pref;
  if (diagrams.every((d) => fits(api, d, box, alt))) return alt;
  return 'y';
}

/** Full plan with fitted labels (an impossible fit is logged as overflow, which lint reports as an error). */
export function planFlow(api, d, box, axis, o = {}) {
  const { ctx, theme, T, D, L, F } = api;
  const g = geom(api, d, box, axis, o);
  const lab = (s, b, align, max = g.R * 1.15, min = g.R) => T.fitText(ctx, theme, s, { role: 'ui', box: b, lines: 1, max: Math.max(min, Math.min(max, b.h * 0.62)), min, align, valign: 'c' });
  const nodes = g.nodes.map((nd, k) => {
    const src = d.nodes[k], kind = kindOf(src);
    const r = Math.min(theme.radius * 0.6, nd.b.h * 0.22);
    const outline = D.pathOf.rrect(nd.b, r, 160);
    const glyph = nd.gb ? (kind === 'num' ? nd.gb : L.aspectFit(nd.gb, 1.3)) : null;
    const num = kind === 'num' && glyph ? T.fitText(ctx, theme, src.num || String(k + 1), { role: 'display', box: glyph, lines: 1, align: 'c', valign: 'c', min: Math.min(g.R, glyph.h) }) : null;
    const lf = lab(src.label, nd.lb, nd.align, o.labelMax || g.R * 1.4);
    // text colours that pass WCAG on the node's resting fill (surface) and on its lit fill (accent)
    const ink = { off: inkOn(api, 'fg', 'surface', lf.size), on: inkOn(api, 'bg', 'accent', lf.size),
      numOff: num ? inkOn(api, 'accent', 'surface', num.size) : 'accent', numOn: num ? inkOn(api, 'bg', 'accent', num.size) : 'bg' };
    return { ...nd, kind, r, outline: [...outline, outline[0]], glyph, num, lf, ink };
  });
  const edges = g.edges.map((eg) => {
    const lf = eg.e.label ? lab(eg.e.label, eg.lb, eg.align, g.R * 1.3, g.R * EDGE_K) : null;
    return { ...eg, lf, ink: lf ? inkOn(api, 'muted', 'bg', lf.size) : 'muted' };
  });
  return { axis, nodes, edges, packet: edges.flatMap((e) => trim(e.pts, 16 * F.u)), F };
}

function arrow(api, pts, p, color) {
  const { ctx, D, M, F } = api;
  D.line(ctx, pts, { color, width: 5 * F.u, progress: p });
  const part = D.along(pts, p).pts;
  if (part.length < 2) return;
  const [x, y] = part[part.length - 1], [px, py] = part[part.length - 2];
  const len = Math.hypot(x - px, y - py);
  if (len < 1e-6) return;
  const dx = (x - px) / len, dy = (y - py) / len, s = 20 * F.u * M.clamp(p * 4);
  D.fillPoly(ctx, [[x + dx * s * 0.5, y + dy * s * 0.5], [x - dx * s * 0.8 - dy * s * 0.65, y - dy * s * 0.8 + dx * s * 0.65],
    [x - dx * s * 0.8 + dy * s * 0.65, y - dy * s * 0.8 - dx * s * 0.65]], color);
}

function drawGlyph(f, api, nd, q, c) {
  const { ctx, D, M, L } = api;
  const g = nd.glyph, w = Math.max(2, g.h * 0.085);
  if (q <= 0) return;
  const outline = (b, r, p) => { const o = D.pathOf.rrect(b, r, 64); D.line(ctx, [...o, o[0]], { color: c, width: w, progress: p }); };
  if (nd.kind === 'code') {
    [0.82, 0.56, 0.7].forEach((len, j) => {
      const x0 = g.x + (j === 1 ? g.w * 0.14 : 0), y = g.y + g.h * (0.24 + j * 0.26);
      D.line(ctx, [[x0, y], [x0 + g.w * len, y]], { color: c, width: g.h * 0.11, progress: M.clamp(q * 1.6 - j * 0.3) });
    });
  } else if (nd.kind === 'screen') {
    outline(g, g.h * 0.12, q);
    D.line(ctx, [[g.x, g.y + g.h * 0.28], [g.x + g.w, g.y + g.h * 0.28]], { color: c, width: w, progress: M.clamp(q * 2 - 1) });
    if (q > 0.7) [0, 1, 2].forEach((j) => D.disc(ctx, g.x + g.h * (0.14 + j * 0.13), g.y + g.h * 0.14, g.h * 0.045, c));
  } else if (nd.kind === 'frames') {
    for (let j = 2; j >= 0; j--) {
      const p = M.clamp(M.clamp(q * 1.5 - (2 - j) * 0.25) * 1.02, 0, 1);
      if (p <= 0) continue;
      const b = { x: g.x + j * g.w * 0.17 * p, y: g.y + (2 - j) * g.h * 0.17 * p, w: g.w * 0.66, h: g.h * 0.66 };
      D.fillBox(ctx, b, 'bg', g.h * 0.08); D.strokeBox(ctx, b, c, w, g.h * 0.08);
    }
  } else if (nd.kind === 'film') {
    outline(g, g.h * 0.14, q);
    const p = M.clamp(q * 2 - 1), [cx, cy] = L.center(g), s = g.h * 0.24 * p;
    if (p > 0) D.fillPoly(ctx, [[cx - s * 0.7, cy - s], [cx + s, cy], [cx - s * 0.7, cy + s]], c);
  } else if (nd.kind === 'clock') {
    const [cx, cy] = L.center(g), r = g.h * 0.44;
    const ring = D.pathOf.circle(cx, cy, r, 64);
    D.line(ctx, [...ring, ring[0]], { color: c, width: w, progress: q });
    const a = -Math.PI / 2 + (f.lt / (8 * f.spb)) * Math.PI * 2;
    D.line(ctx, [[cx, cy], [cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7]], { color: c, width: w * 1.2, progress: M.clamp(q * 2 - 1) });
  } else if (nd.kind === 'wave') {
    const pts = Array.from({ length: 41 }, (_, i) => {
      const x = i / 40, env = Math.sin(Math.PI * x);
      return [g.x + x * g.w, g.y + g.h / 2 + Math.sin(x * 14 + f.lt * 5) * g.h * 0.34 * env];
    });
    D.line(ctx, pts, { color: c, width: w, progress: q });
  }
}

function drawNode(f, api, nd, at, lit, o = {}) {
  const { ctx, D, M, T, theme } = api;
  const open = M.clamp(M.sp(f.since(at), 'snap'), 0, 1.03);       // tiny overshoot on UI
  if (open < 0.3) return;                                          // never a sliver: a node pops in from 30% scale
  const b = nd.b, [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  // entry: uniform pop from the centre, optionally travelling in from o.enter = [dx, dy] px; o.scale pushes it in
  const travel = 1 - M.clamp(M.sp(f.since(at), 'stiff')), s = open * (o.scale || 1);
  const [ex, ey] = o.enter ? [o.enter[0] * travel, o.enter[1] * travel] : [0, 0];
  ctx.save(); ctx.translate(cx + ex, cy + ey); ctx.scale(s, s); ctx.translate(-cx, -cy);
  D.fillBox(ctx, b, lit > 0 ? theme.mix('surface', 'accent', lit) : 'surface', nd.r);
  const on = lit > 0.5;
  const op = M.clamp(M.sp(f.since(at + 0.3), DRAW)), oc = on ? 'accent' : 'fg';
  if (op >= 0.999 && open >= 0.999) D.strokeBox(ctx, b, oc, 3 * f.F.u, nd.r);
  else D.line(ctx, nd.outline, { color: oc, width: 3 * f.F.u, progress: op });
  if (nd.glyph && nd.kind !== 'num') drawGlyph(f, api, nd, M.clamp(M.sp(f.since(at + 0.2), DRAW)), on ? 'bg' : 'accent');
  if (nd.num) T.kinetic(f, nd.num, { by: 'line', at: at + 0.15, from: 'mask', spring: 'stiff', color: on ? nd.ink.numOn : nd.ink.numOff });
  T.kinetic(f, nd.lf, { by: 'line', at: at + 0.25, from: 'mask', spring: 'stiff', color: on ? nd.ink.on : nd.ink.off });
  ctx.restore();
}

/**
 * Draw the diagram. o.lit(k) -> 0..1 accent amount per node; o.packetAt starts a packet looping along the edges;
 * o.scale(k) -> node scale (focus push-in); o.enter -> [dx, dy] px every node travels in from as it pops.
 */
export function drawFlow(f, api, lay, tm, o = {}) {
  const { M, D } = api;
  const lit = o.lit || (() => 0);
  lay.edges.forEach((eg) => {
    const a0 = tm.edgeAt(eg.e), p = M.clamp(M.sp(f.since(a0), DRAW));
    if (p <= 0) return;
    arrow(api, eg.pts, p, 'fg');
    if (eg.lf) api.T.kinetic(f, eg.lf, { by: 'line', at: a0 + 0.3, from: 'mask', spring: 'stiff', color: eg.ink });
  });
  lay.nodes.forEach((nd, k) => drawNode(f, api, nd, tm.nodeAt(k), lit(k), { scale: o.scale ? o.scale(k) : 1, enter: o.enter }));
  if (o.packetAt !== undefined && lay.packet.length > 1 && f.since(o.packetAt) > 0) {
    const period = (o.packetBeats || 2) * f.spb;
    const q = M.easeInOutCubic(M.mod(f.since(o.packetAt), period) / period);
    const [x, y] = D.along(lay.packet, q).tip;
    D.disc(f.ctx, x, y, 11 * f.F.u, 'accent');
  }
}
