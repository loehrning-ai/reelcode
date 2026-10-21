// feature.js: a product-launch feature moment as a camera move INTO the real UI, in two shots on the beat grid.
// Shot A: a macro on the control being used, the camera pushes in, the cursor clicks on the beat.
// Whip pan to Shot B: a full-bleed CAMERA over the "after" screen (not a fitted panel). Its zoom is derived from
// the measured glyph height of the UI under each stop (so the smallest captured text renders >= 2.2% of the
// frame's short side, and >= ~1.6-1.9x pixel scale), and it tours `tour` stops one per beat (row -> row,
// notification -> notification, chart -> toast), each arrival marked by a ring. Its one key line is restated as
// native display type (`say`) on a plate over the bottom of the UI, so the hold carries 3-4 readable reveals and
// the bottom band of tall frames is filled. UI is only ever crops of captured PNGs.
import { inkOn } from './ink.js';
import { UI, TYPE, trimRect, snapCrop, fitCrop, mapCrop } from './stage.js';

const GROUND = 'accent';
const K_MAX = { v: 3.0, s: 2.6, h: 2.1 };        // macro cap for shot A
const K_FLOOR = { v: 2.0, s: 1.9, h: 1.8 };     // camera floor for shot B (canvas px per screenshot px)
export const GLYPH_MIN = 0.022;                  // smallest captured text line, as a share of the short side

/** Title band, camera window (full-bleed), the visible part of it above the caption plate, and the plate box. */
function featureLayout(api) {
  const { F, L, T } = api;
  const sayS = T.readable(F, F.pick({ v: 1.6, s: 1.5, h: 1.45 }));
  if (F.orient === 'h') {
    const col = { ...F.safe, w: F.safe.w * 0.36 };
    const win = { x: col.x + col.w + 56 * F.u, y: 0, w: 0, h: F.h }; win.w = F.w - win.x;
    const tBox = { ...col, h: col.h * 0.5 };
    const plate = { x: col.x, y: col.y + col.h * 0.56, w: col.w, h: col.h * 0.44 };
    return { tBox, win, vis: L.inset(win, { t: F.safe.y, b: F.safe.y, r: F.safe.x * 0.6 }), plate, sayS, valign: 'b', sayLines: 3 };
  }
  const tH = F.safe.h * F.pick({ v: F.aspect > 0.7 ? 0.2 : 0.17, s: 0.2 });
  const tBox = { x: F.safe.x, y: F.safe.y, w: F.safe.w, h: tH };
  const top = F.safe.y + tH + 36 * F.u;
  const bottom = F.orient === 'v' ? Math.min(F.h, F.safe.y + F.safe.h + 150) : F.h;
  const win = { x: 0, y: top, w: F.w, h: bottom - top };
  const lines = F.orient === 'v' ? 2 : 1;
  const plateH = sayS * (lines === 2 ? 2.15 : 1.05) + sayS * 0.9;
  const plate = { x: F.safe.x, y: F.safe.y + F.safe.h - plateH, w: F.safe.w, h: plateH };
  const vis = { x: 24 * F.u, y: top, w: F.w - 48 * F.u, h: plate.y - 28 * F.u - top };   // UI pixels may run past the safe x margins
  return { tBox, win, vis, plate, sayS, valign: 'b', sayLines: lines };
}

/** Shot A crop: the click target with a little real context around it, cut on clear columns/rows. */
function macroCrop(img, s, q) {
  const px = Math.min(90, Math.max(28, q.w * 0.08)), py = Math.min(110, Math.max(28, q.h * 0.55));
  const r = { x: Math.max(0, q.x - px), y: Math.max(0, q.y - py), w: 0, h: 0 };
  r.w = Math.min(s.w, q.x + q.w + px) - r.x; r.h = Math.min(s.h, q.y + q.h + py) - r.y;
  return snapCrop(img, r, { keep: q, reach: 60 });
}

/**
 * The smallest text line inside screenshot rect r: rows with glyph ink (many sharp horizontal changes) form runs;
 * runs 8-90 px tall are text lines (thinner runs are rules/borders, taller ones are icons/bars). Build time.
 */
export function minTextRun(img, r) {
  try {
    const W = Math.round(r.w), H = Math.round(r.h);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, Math.round(r.x), Math.round(r.y), W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const inked = (y) => {
      let n = 0;
      for (let x = 0, i = y * W * 4; x < W - 2; x++, i += 4) if (Math.abs(d[i] - d[i + 8]) + Math.abs(d[i + 1] - d[i + 9]) + Math.abs(d[i + 2] - d[i + 10]) > 60) n++;
      return n >= 8;
    };
    let best = null, run = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && inked(y)) { run++; continue; }
      if (run >= 8 && run <= 90) best = best === null ? run : Math.min(best, run);
      run = 0;
    }
    return best;
  } catch { return null; }
}

function drawCrop(api, img, c, r) {
  const { ctx, D } = api;
  D.withClip(ctx, (g) => D.rrect(g, c.dst, r), () => ctx.drawImage(img, c.src.x, c.src.y, c.src.w, c.src.h, c.dst.x, c.dst.y, c.dst.w, c.dst.h));
}

/** About (cx, cy): scale k, then offset (dx, 0). */
function around(ctx, cx, cy, k, dx = 0) { ctx.translate(cx + dx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }

/** Tour stops (screenshot px rects) from `tour` (cap ids or [x,y,w,h]); default: the zoom rect, then the pop. */
function tourStops(api, s1, ft, zoomR) {
  const { A } = api;
  const res = (t) => {
    if (!Array.isArray(t)) return A.capRect(s1, t);
    if (t.length !== 4 || !t.every((v) => typeof v === 'number' && v >= 0) || t[2] <= 0 || t[3] <= 0 || t[0] + t[2] > s1.w || t[1] + t[3] > s1.h)
      throw new Error(`product-launch: features[].tour stop ${JSON.stringify(t)} must be a cap id or [x,y,w,h] screenshot px inside "${s1.id}" (${s1.w}x${s1.h})`);
    return { x: t[0], y: t[1], w: t[2], h: t[3] };
  };
  if (ft.tour && ft.tour.length) return ft.tour.map(res);
  return [zoomR || { x: 0, y: 0, w: s1.w, h: s1.h }, ...(ft.pop ? [A.capRect(s1, ft.pop)] : [])];
}

/** True when no glyph, icon or border crosses any edge of screenshot rect r (snapCrop's clear-line test). */
function cleanEdges(img, r) {
  try {
    const X = Math.round(r.x) - 4, Y = Math.round(r.y) - 4, W = Math.round(r.w) + 8, H = Math.round(r.h) + 8;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, X, Y, W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => (y * W + x) * 4;
    const df = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
    const col = (x, dx) => { let bad = 0, n = 0; for (let y = 4; y < H - 4; y += 2, n++) if (df(at(x, y), at(x + dx, y)) > 20) bad++; return bad <= n * 0.01; };
    const row = (y, dy) => { let bad = 0, n = 0; for (let x = 4; x < W - 4; x += 2, n++) if (df(at(x, y), at(x, y + dy))> 20) bad++; return bad <= n * 0.01; };
    return col(4, 3) && col(W - 5, -3) && row(4, 3) && row(H - 5, -3);
  } catch { return true; }
}

/**
 * Camera plan, per stop: a zoom k (the glyph floor: the smallest text line under the stop renders >= GLYPH_MIN of
 * the short side, and the format floor ~1.8-2x) and a LENS: the stop plus as much real context as fits the
 * visible box at k, snapped to clear rows/columns, trying smaller margins until no glyph crosses an edge. The lens
 * is drawn centred in the visible box as a panel on the accent ground; the camera interpolates lens and zoom
 * between stops, so every resting frame shows whole lines only and no text is ever cut by the frame.
 */
function cameraPlan(api, s1, stops, lay) {
  const { F } = api;
  const { vis } = lay;
  const need = GLYPH_MIN * Math.min(F.w, F.h);
  const B = { x: 0, y: 0, w: s1.w, h: s1.h };
  return stops.map((r) => {
    const run = minTextRun(s1.img, r);
    const kNeed = run ? need / run : 0;
    let k = Math.min(3, Math.max(F.pick(K_FLOOR), kNeed), Math.max(0.5, Math.min((vis.w * 0.96) / r.w, (vis.h * 0.9) / r.h)));
    const mx = Math.max(0, Math.min(220, (vis.w * 0.96 / k - r.w) / 2));
    const myMax = Math.max(0, (vis.h * 0.92 / k - r.h) / 2);
    let lens = r, clean = false;
    for (const my of [Math.min(myMax, 320), Math.min(myMax, 170), Math.min(myMax, 80), Math.min(myMax, 30), 12]) {
      const e = { x: Math.max(0, r.x - mx), y: Math.max(0, r.y - my), w: 0, h: 0 };
      e.w = Math.min(s1.w, r.x + r.w + mx) - e.x; e.h = Math.min(s1.h, r.y + r.h + my) - e.y;
      const c = snapCrop(s1.img, e, { keep: r, bound: B, reach: 40 });
      lens = c; clean = cleanEdges(s1.img, c);
      if (clean) break;
    }
    k = Math.min(k, (vis.w * 0.98) / lens.w, (vis.h * 0.96) / lens.h);
    return { k, lens, clean, run, glyphPx: run ? run * k : null };
  });
}

export function featureScene(api, ft, i, n, beats) {
  const { F, ctx, theme, T, L, M, D, K, A, G, grid } = api;
  const s0 = A.screen(ft.screen), s1 = ft.after ? A.screen(ft.after) : s0;
  const lay = featureLayout(api), { win, vis, plate } = lay;
  const clickR = ft.click ? trimRect(api, s0, A.capRect(s0, ft.click)) : null;
  const zoomR = ft.zoom ? A.capRect(s1, ft.zoom) : null;
  const stops = tourStops(api, s1, ft, zoomR);
  const cam = cameraPlan(api, s1, stops, lay);
  // Shot A: the click target fills the visible box width (capped at the macro scale).
  const cropA = clickR ? macroCrop(s0.img, s0, clickR) : null;
  const shotA = cropA ? fitCrop(s0.img, cropA, vis, { kMax: F.pick(K_MAX) }) : null;
  // Title: a small "01 / 03" index over the display title, set on the accent ground.
  const nS = T.readable(F, 1.05);
  const hBox = L.inset(lay.tBox, { t: nS * 1.9 });
  const titleFit = T.fitText(ctx, theme, ft.title, { role: 'display', box: hBox, lines: 'auto', leading: 0.95, valign: lay.valign,
    max: F.pick({ v: hBox.h * 0.5, s: hBox.h * 0.5, h: hBox.h * 0.3 }), min: T.readable(F, 1.2) });
  const idx = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
  const idxFit = T.fitText(ctx, theme, idx, { role: 'ui', box: { x: lay.tBox.x, y: titleFit.box.y - nS * 1.75, w: lay.tBox.w, h: nS * 1.05 }, lines: 1, max: nS, min: nS });
  // The key line, restated in the display font on a bg plate over the bottom of the UI.
  const padP = lay.sayS * 0.45;
  const sayFit = ft.say ? T.fitText(ctx, theme, ft.say, { role: 'display', box: L.inset(plate, padP), lines: 'auto', leading: 1.05,
    valign: F.orient === 'h' ? 't' : 'c', max: lay.sayS, min: T.readable(F, 1.1) }) : null;
  const plateBox = sayFit ? (F.orient === 'h' ? { x: plate.x, y: sayFit.box.y - padP, w: plate.w, h: sayFit.box.h + padP * 2.1 } : plate) : null;
  // Beats: cursor in at 0.5, on the control at 1.5, click on 2.5; whip a quarter beat later; then one stop per beat.
  const plan = ft.cursor || (clickR ? [{ at: 0.5, to: [0.92, 1.0] }, { at: 1.5, to: ft.click }, { at: 2.5, click: true }] : null);
  const firstClick = plan ? plan.find((p) => p.click) : null;
  const clickAt = firstClick ? G.parseAt(firstClick.at, grid) : null;
  const whipAt = shotA ? Math.min(beats - 3, (clickAt ?? 2) + 0.25) : 0;
  const payAt = whipAt + 0.75;
  const last = beats - 1.25;                                 // the last stop settles before the centred exit
  const step = stops.length > 1 ? Math.min(1, (last - payAt) / (stops.length - 1)) : 1;
  const arrive = stops.map((_, j) => payAt + j * step);
  const sayAt = sayFit ? payAt + Math.min(0.5, step / 2) : null;
  const events = [...(plan ? [G.parseAt(plan[0].at, grid)] : []), ...(clickAt !== null ? [clickAt] : []), whipAt, ...arrive, ...(sayAt !== null ? [sayAt] : [])]
    .filter((b, k, arr) => b >= 0 && b < beats && arr.indexOf(b) === k);
  const sfx = [...K.clicks(plan, -5), ...(shotA ? [{ at: whipAt, sfx: 'swish', gain_db: -7 }] : []),
    { at: payAt, sfx: 'pop', gain_db: -9 }, ...arrive.slice(1).map((b) => ({ at: b, sfx: 'tick', gain_db: -13 })),
    ...(sayAt !== null ? [{ at: sayAt, sfx: 'thump', gain_db: -9 }] : [])].filter((m) => G.parseAt(m.at, grid) < beats);
  const transition = [{ type: 'wipe', beats: 1, dir: 'l' }, { type: 'push', beats: 1, dir: 'u' }, { type: 'slats', beats: 1 }][i % 3];
  const rad = theme.radius * 0.5;
  const travel = F.w * 1.1;
  const qa = { feature: i + 1, need: +(GLYPH_MIN * Math.min(F.w, F.h)).toFixed(1), hold: +(beats - payAt).toFixed(2), payAt, arrive,
    stops: cam.map((c, j) => ({ k: +c.k.toFixed(3), run: c.run, glyphPx: c.glyphPx && +c.glyphPx.toFixed(1), rect: stops[j], lens: c.lens, clean: c.clean })) };
  return { id: `feature${i + 1}`, beats, events, sfx, transition, qa, draw(f) {
    D.fillBox(ctx, F.full, GROUND);
    const w = shotA ? M.sp(f.since(whipAt), 'stiff') : 1;   // whip pan: A leaves left, B arrives from the right
    const press = clickAt !== null ? f.hit(clickAt, 0.1) : 0;
    let kA = 1, cA = null;
    if (shotA && w < 0.999) {
      kA = (0.82 + 0.18 * M.clamp(M.sp(f.since(-0.25), 'soft'))) * (1 - 0.02 * press);
      cA = L.center(mapCrop(shotA, clickR));
      ctx.save(); around(ctx, cA[0], cA[1], kA, -w * travel);
      drawCrop(api, s0.img, shotA, rad);
      if (clickAt !== null && f.lb >= clickAt) {
        const q = M.sp(f.since(clickAt), 'stiff');
        if (q < 0.985) D.strokeBox(ctx, L.inset(mapCrop(shotA, clickR), -q * 40 * F.u), 'fg', 7 * F.u * (1 - q), theme.radius * 0.4);
      }
      ctx.restore();
    }
    if (w > 0.001) {
      // Camera: the lens glides stop to stop (pan + zoom), each move starting a quarter beat early so it lands on its beat.
      let L0 = { ...cam[0].lens }, lk = Math.log(cam[0].k);
      for (let j = 1; j < stops.length; j++) {
        const m = M.sp(f.since(arrive[j] - 0.25), [0.31, 0.93]), a0 = cam[j - 1].lens, a1 = cam[j].lens;
        L0 = { x: L0.x + (a1.x - a0.x) * m, y: L0.y + (a1.y - a0.y) * m, w: L0.w + (a1.w - a0.w) * m, h: L0.h + (a1.h - a0.h) * m };
        lk += (Math.log(cam[j].k) - Math.log(cam[j - 1].k)) * m;
      }
      const drift = 1 + 0.025 * M.clamp(f.since(payAt) / ((beats - payAt) * f.spb));   // slow push through the hold
      const kk = Math.exp(lk) * drift;
      const [vx, vy] = L.center(vis);
      const dst = { x: vx - (L0.w * kk) / 2, y: vy - (L0.h * kk) / 2, w: L0.w * kk, h: L0.h * kk };
      ctx.save(); ctx.translate((1 - w) * travel, 0);
      D.withClip(ctx, (g) => D.rrect(g, dst, rad), () => ctx.drawImage(s1.img, L0.x, L0.y, L0.w, L0.h, dst.x, dst.y, dst.w, dst.h));
      // A ring lands on each stop as the camera reaches it.
      for (let j = 0; j < stops.length; j++) {
        if (f.lb < arrive[j]) continue;
        const q = M.sp(f.since(arrive[j]), 'stiff');
        if (q >= 0.985) continue;
        const r = stops[j], box = { x: dst.x + (r.x - L0.x) * kk, y: dst.y + (r.y - L0.y) * kk, w: r.w * kk, h: r.h * kk };
        D.strokeBox(ctx, L.inset(box, -(8 + q * 30) * F.u), 'fg', 6 * F.u * (1 - q), rad);
      }
      ctx.restore();
    }
    if (plan && shotA && w < 0.5) {
      const resolve = (to) => {
        if (Array.isArray(to)) return [vis.x + to[0] * vis.w, vis.y + to[1] * vis.h];
        const r = mapCrop(shotA, A.capRect(s0, to));
        const [x, y] = L.center(r);
        return [cA[0] - w * travel + (x - cA[0]) * kA, cA[1] + (y - cA[1]) * kA];
      };
      K.drawCursor(ctx, theme, K.cursorAt(plan, f, resolve, UI), F.u * 1.25);
    }
    if (sayFit && f.lb >= sayAt - 0.25) {
      const g = M.clamp(M.sp(f.since(sayAt - 0.25), 'stiff'));   // the plate wipes in from the left, the words slam onto it
      D.fillBox(ctx, { ...plateBox, w: plateBox.w * g }, 'bg', theme.radius * 0.5);
      T.kinetic(f, sayFit, { by: 'word', at: sayAt - 0.15, stagger: 0.1, from: 'mask', spring: TYPE, color: 'fg' });
    }
    T.kinetic(f, idxFit, { by: 'char', at: 0, stagger: 0.04, from: 'below', spring: TYPE, color: inkOn(api, 'fg', GROUND, idxFit.size) });
    T.kinetic(f, titleFit, { by: 'word', at: 0.25, stagger: 0.2, from: 'mask', spring: TYPE, color: inkOn(api, 'fg', GROUND, titleFit.size) });
  } };
}
