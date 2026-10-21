// heroes.js: one hero shot per step. The subject changes form at each stage instead of being one card with props:
//   scrub      the frame takes the whole hero box; a scrubber drags t on every beat and the poses it has visited stay
//              as an onion skin (three dimmed balls), so every tile shows time; a big `t = 1.25 s` timecode
//   paint      a browser window over an EMPTY canvas; the frame is built one primitive per beat, synced to the call in
//              the address bar (fillRect -> fill, fillText -> word, lineTo -> ground, ellipse -> shadow, arc -> ball),
//              each call's bounding box flashing in the accent as it lands
//   filmstrip  a shutter flash stamps the canvas and launches it into a filmstrip that streams past an accent gate
//              (vertical, top to bottom through the whole frame in 9:16 / 4:5; horizontal in 1:1 / 16:9)
//   blend      four sub-frames stacked offset collapse into one frame whose ball is a motion-blur streak along its
//              arc; a waveform rises under it and both lock into a play tile
//   diagram    (default) the step's flow diagram, large, as the hero
// Every hero starts from the base frame (the film at ft=8 in g.film) and its tail(q) retracts its own props back to
// that base frame (q: 1 = end state, 0 = base), so the next step's hero picks the object up. Pure functions of f.
import { drawFilm, drawStreak, drawWave, layerBox, LAYERS } from './film.js';
import { flowTiming, planFlow, drawFlow, chooseAxis } from './diagram.js';

export const KINDS = ['scrub', 'paint', 'filmstrip', 'blend', 'diagram'];
const SCRUB_FT = [1, 3, 6, 2, 7, 4, 5];               // film beats the playhead jumps to, one per beat (t = 0.62/1.87/3.75 s ...)
const CALLS = ['fillRect()', 'fillText()', 'lineTo()', 'ellipse()', 'arc()'];
const SUB = 0.09;                                      // film beats between drawn sub-frames (blend)
const BASE = 8;

export function makeHeroes(api, { R, S, ink }) {
  const { F, M, D, T, L, ctx, theme } = api;
  const u = F.u, sp = (f, at, s = 'stiff') => M.sp(f.since(at), s);
  const spb = api.grid.spb, vert = F.orient === 'v';
  const rad = (r) => Math.min(theme.radius * 0.7, r.h * 0.08);

  // ---------- scrub ----------
  const scrubKeys = Array.from({ length: Math.max(1, S - 1) }, (_, j) => (j === S - 2 ? BASE : SCRUB_FT[j % SCRUB_FT.length]));
  const scrubFt = (f) => scrubKeys.reduce((v, k, j) => v + (k - (j ? scrubKeys[j - 1] : 0)) * M.clamp(sp(f, j + 1)), 0);
  const tcSize = R * 1.5;
  const scrubBand = (g, ft, grow) => {
    const tr = { x: g.band.x, y: g.band.y + g.band.h * 0.18, w: g.band.w * grow, h: Math.max(8, 12 * u) };
    D.fillBox(ctx, tr, 'surface', tr.h / 2);
    for (let i = 0; i <= 8; i++) D.fillBox(ctx, { x: g.band.x + (g.band.w * i) / 8 - 1.5 * u, y: tr.y - 8 * u, w: 3 * u, h: tr.h + 16 * u }, i / 8 <= grow ? 'muted' : 'bg');
    const px = g.band.x + g.band.w * Math.min(grow, ft / 8);
    D.fillBox(ctx, { x: g.band.x, y: tr.y, w: px - g.band.x, h: tr.h }, 'accent', tr.h / 2);
    D.fillBox(ctx, { x: px - 2.5 * u, y: g.film.y + g.film.h, w: 5 * u, h: tr.y - g.film.y - g.film.h }, 'accent');
    D.disc(ctx, px, tr.y + tr.h / 2, R * 0.42, 'accent');
    return tr;
  };
  const visited = (f) => scrubKeys.filter((_, j) => f.lb >= j + 1.35).slice(-4, -1);   // the poses left behind, newest last
  const scrub = {
    events: (S) => [0.5, ...scrubKeys.map((_, j) => j + 1)].filter((b) => b < S),
    sfx: () => [{ at: 0.5, sfx: 'swish', gain_db: -12 }, ...scrubKeys.map((_, j) => ({ at: j + 1, sfx: 'tick', gain_db: -6 }))],
    draw(f, g) {
      const ft = scrubFt(f), grow = M.clamp(sp(f, 0.4, 'snap'), 0, 1);
      drawFilm(api, g.film, ft, { ghosts: visited(f) });
      if (grow <= 0) return;
      const tr = scrubBand(g, ft, grow);
      const y = tr.y + tr.h + R * 0.45 + tcSize * 0.75, p = sp(f, 0.75);
      const tc = `t = ${(ft * spb).toFixed(2)} s`;
      D.withClip(ctx, (c) => c.rect(g.band.x - R, tr.y + tr.h + R * 0.2, g.band.w + 2 * R, tcSize * 1.4), () =>
        T.drawText(ctx, theme, tc, g.band.x, y + (1 - p) * tcSize * 1.2, { role: 'display', size: tcSize, color: 'fg', rest: [g.band.x, y] }));
    },
    tail(f, g, q) {
      drawFilm(api, g.film, BASE);
      D.withClip(ctx, (c) => c.rect(g.band.x - R, g.band.y, g.band.w + 2 * R, g.band.h), () => {
        ctx.save(); ctx.translate(0, (1 - q) * g.band.h); scrubBand(g, BASE, q); ctx.restore();
      });
    },
  };

  // ---------- paint ----------
  const barHOf = (g) => Math.max(R * 2.1, g.film.h * 0.12);
  const paintAt = (i) => 1 + i, clearAt = 0.5;
  // the window is the film rect itself: its bar grows down inside it and the canvas is what is left below the bar
  const windowed = (f, g, barK, callIdx) => {
    const bh = barHOf(g) * barK, w = g.film, canvas = { x: w.x, y: w.y + bh, w: w.w, h: w.h - bh };
    if (bh > 0.5) {
      D.fillBox(ctx, w, 'surface', rad(w));
      [0, 1, 2].forEach((j) => D.disc(ctx, w.x + bh * (0.42 + j * 0.36), w.y + bh / 2, bh * 0.11, 'muted'));
      const pill = { x: w.x + bh * 1.45, y: w.y + bh * 0.1, w: w.w - bh * 1.6, h: bh * 0.8 };
      D.fillBox(ctx, pill, 'bg', pill.h / 2);
      if (barK >= 0.999 && callIdx != null) {
        const s = callIdx < 0 ? 'page.html' : `ctx.${CALLS[callIdx]}`;
        const p = callIdx < 0 ? 1 : sp(f, paintAt(callIdx) - 0.05);
        const size = Math.max(R, Math.min(R * 1.25, pill.h * 0.6)), x = pill.x + pill.h * 0.45, y = pill.y + pill.h / 2 + size * 0.36;
        D.withClip(ctx, (c) => c.rect(pill.x, pill.y, pill.w, pill.h), () =>
          T.drawText(ctx, theme, s, x, y + (1 - p) * pill.h, { role: 'ui', size, color: ink('fg', size, 'bg'), rest: [x, y] }));
      }
    }
    return canvas;
  };
  const flash = (f, r, at) => {
    const k = M.clamp(sp(f, at, 'snap'), 0, 1.06);
    if (k <= 0) return;
    const [cx, cy] = L.center(r), w = Math.max(4, 6 * u), grow = 1 + (1 - Math.min(1, k)) * 0.08;
    D.strokeBox(ctx, { x: cx - (r.w * grow) / 2 - w, y: cy - (r.h * grow) / 2 - w, w: r.w * grow + 2 * w, h: r.h * grow + 2 * w }, 'accent', w, Math.min(r.h / 2, R * 0.3));
  };
  const paint = {
    events: (S) => [0.5, ...CALLS.map((_, i) => paintAt(i))].filter((b) => b < S),
    sfx: (S) => [{ at: 0.25, sfx: 'pop', gain_db: -10 }, { at: clearAt, sfx: 'whoosh', gain_db: -14 },
      ...CALLS.map((_, i) => ({ at: paintAt(i), sfx: 'swish', gain_db: -7 }))].filter((m) => m.at < S),
    draw(f, g) {
      const barK = M.clamp(sp(f, 0.2, 'snap'), 0, 1);
      let idx = -1;
      CALLS.forEach((_, i) => { if (f.lb >= paintAt(i)) idx = i; });
      const cv = windowed(f, g, barK, f.lb < clearAt ? -1 : idx);
      const clear = M.clamp(sp(f, clearAt));
      D.fillBox(ctx, cv, 'bg');
      D.strokeBox(ctx, cv, 'muted', Math.max(2, 3 * u));
      const layers = CALLS.map((_, i) => M.clamp(sp(f, paintAt(i), i >= 3 ? 'snap' : 'stiff'), 0, i >= 3 ? 1.1 : 1));
      if (idx >= 0) drawFilm(api, cv, BASE, { layers });
      // the old frame, until the clear sweep passes it: the canvas starts EMPTY, then fills one call per beat
      if (clear < 1) D.withClip(ctx, (c) => c.rect(cv.x + cv.w * clear, cv.y - 1, cv.w * (1 - clear) + 2, cv.h + 2), () => drawFilm(api, cv, BASE));
      if (idx >= 0 && f.lb < paintAt(idx) + 0.85) flash(f, layerBox(api, cv, idx, BASE), paintAt(idx));
    },
    tail(f, g, q) { drawFilm(api, windowed(f, g, q, null), BASE); },
  };

  // ---------- filmstrip ----------
  // along = the strip's running axis (x in landscape strips, y in portrait), across = its thickness.
  const stripOf = (g) => {
    const ratio = g.film.w / g.film.h, [cx, cy] = L.center(g.film);
    const cw = vert ? g.film.w * 0.6 : g.film.h * 0.52 * ratio, ch = cw / ratio;
    const along = vert ? ch : cw, thick = (vert ? cw : ch) * 1.42;
    const span = vert ? [g.hero.y - R * 0.3, F.h] : spanOf(g);
    return { vert, cw, ch, along, thick, pitch: along * 1.14, c: vert ? cy : cx, k: vert ? cx : cy, span, cell: { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch } };
  };
  const box = (st, a0, a1, c0, c1) => (st.vert ? { x: c0, y: a0, w: c1 - c0, h: a1 - a0 } : { x: a0, y: c0, w: a1 - a0, h: c1 - c0 });
  const streamOff = (f, st) => {
    const d = Math.max(0, f.lb - 2.5);
    return st.pitch * 2.6 * (d - (1 - Math.exp(-d * 3)) / 3);
  };
  const spanOf = (g) => (g.hero.x > F.w / 2 - g.hero.w / 2 && g.hero.x + g.hero.w > F.w * 0.75 ? [g.hero.x - R * 0.5, F.w] : [0, g.hero.x + g.hero.w + R * 0.5]);
  const dir = vert ? 1 : -1;                                       // portrait streams top to bottom, landscape right to left
  const drawStrip = (st, off, lenK, thickK, skipCentre) => {
    const full = st.vert ? F.h : F.w, half = (full * lenK) / 2;
    const a0 = Math.max(st.span[0], st.c - half), a1 = Math.min(st.span[1], st.c + half);
    const c0 = st.k - (st.thick * thickK) / 2, c1 = st.k + (st.thick * thickK) / 2;
    const band = box(st, a0, a1, c0, c1);
    if (band.w < 1 || band.h < 1) return;
    D.withClip(ctx, (c) => c.rect(band.x, band.y, band.w, band.h), () => {
      D.fillBox(ctx, band, 'muted');
      const hole = st.pitch / 4, hl = hole * 0.42, ht = (st.thick - (st.vert ? st.cw : st.ch)) * 0.22;
      const h0 = Math.floor((a0 - st.c - dir * off) / hole) - 1, h1 = Math.ceil((a1 - st.c - dir * off) / hole) + 1;
      for (let i = h0; i <= h1; i++) {
        const a = st.c + i * hole + dir * off;
        [st.k - st.thick / 2 + ht * 0.6, st.k + st.thick / 2 - ht * 1.6].forEach((c) => D.fillBox(ctx, box(st, a, a + hl, c, c + ht), 'bg', ht * 0.3));
      }
      const i0 = Math.floor((a0 - st.c - dir * off) / st.pitch) - 1, i1 = Math.ceil((a1 - st.c - dir * off) / st.pitch) + 1;
      for (let i = i0; i <= i1; i++) {
        if (skipCentre && i === 0 && off === 0) continue;
        const a = i * st.pitch + dir * off;
        drawFilm(api, st.vert ? { ...st.cell, y: st.cell.y + a } : { ...st.cell, x: st.cell.x + a }, BASE - i * 0.5);
      }
    });
  };
  const labelFit = (g, label) => {
    if (vert) {   // portrait: the rate sits on its own plate at the foot of the hero, over the running strip
      const h = R * 2.4, b = { x: g.hero.x, y: g.hero.y + g.hero.h - h, w: g.hero.w, h };
      return T.tryFit(ctx, theme, label, { role: 'display', box: b, lines: 1, max: R * 2, min: R, align: 'c', valign: 'c' });
    }
    const st = stripOf(g), top = st.k + st.thick / 2 + R * 0.6;
    const b = { x: g.hero.x, y: top, w: g.hero.w, h: Math.max(R, g.hero.y + g.hero.h - top) };
    return T.tryFit(ctx, theme, label, { role: 'display', box: b, lines: 1, max: R * 2.2, min: R, align: 'c', valign: 't' });
  };
  const filmstrip = {
    events: (S) => [1.25, 1.75, 2.5, 2.75, ...Array.from({ length: S }, (_, j) => j).filter((j) => j >= 3)].filter((b) => b < S),
    sfx: (S) => [{ at: 1.25, sfx: 'click', gain_db: -4 }, { at: 1.75, sfx: 'whoosh', gain_db: -10 },
      ...Array.from({ length: S }, (_, j) => j).filter((j) => j >= 3).map((j) => ({ at: j, sfx: 'click', gain_db: -9 }))],
    draw(f, g, step) {
      const st = stripOf(g), e = M.clamp(sp(f, 1.6)), grow = M.clamp(sp(f, 1.75, 'snap'), 0, 1);
      const off = streamOff(f, st);
      if (grow > 0) drawStrip(st, off, grow, 1, off === 0);
      const r = L.lerpBox(g.film, st.cell, e);
      if (off === 0) drawFilm(api, r, BASE);
      // shutter: a hard flash of the canvas at the stamp, then two accent blades close over it and open again
      if (f.lb >= 1.25 && f.lb < 1.4) D.fillBox(ctx, L.inset(r, -R * 0.4), 'bg', rad(r));
      const close = M.clamp(sp(f, 1.25, 'snap')) - M.clamp(sp(f, 1.55, 'snap'));
      if (close > 0.001) {
        const h = (r.h / 2) * close;
        D.fillBox(ctx, { x: r.x, y: r.y, w: r.w, h }, 'accent'); D.fillBox(ctx, { x: r.x, y: r.y + r.h - h, w: r.w, h }, 'accent');
      }
      // the gate: an accent bracket around the centre slot that stamps on every beat
      if (f.lb >= 2.5) {
        let kick = 0;
        for (let j = 3; j < S; j++) kick = Math.max(kick, f.hit(j, 0.12, 'snap'));
        const gp = M.clamp(sp(f, 2.5, 'snap'), 0, 1.03), k = 1 + 0.06 * kick;
        const gb = L.inset(st.cell, -R * 0.28 * k);
        D.strokeBox(ctx, vert ? { x: gb.x, y: st.c - (gb.h / 2) * gp, w: gb.w, h: gb.h * gp } : { x: st.c - (gb.w / 2) * gp, y: gb.y, w: gb.w * gp, h: gb.h }, 'accent', 8 * u, rad(gb));
      }
      if (step.hero.label) {
        const fit = labelFit(g, step.hero.label);
        if (!fit.overflow) {
          if (vert && f.lb >= 2.75) {
            const b = fit.box, pad = R * 0.5, open = M.clamp(sp(f, 2.75, 'snap'), 0, 1.04);
            D.fillBox(ctx, { x: b.x - pad, y: b.y - pad, w: (b.w + 2 * pad) * open, h: b.h + 2 * pad }, 'bg', R * 0.3);
          }
          T.kinetic(f, fit, { by: 'char', at: 2.75, stagger: 0.04, from: 'mask', spring: 'stiff' });
        }
      }
    },
    tail(f, g, q) {
      const st = stripOf(g), off = st.pitch * 2.6 * (S - 2.5 - 1 / 3);
      drawStrip(st, M.mod(off, st.pitch), q, q, false);
      drawFilm(api, L.lerpBox(g.film, st.cell, q), BASE);
    },
  };

  // ---------- blend ----------
  const tileOf = (g) => {
    const wv = { x: g.film.x, y: g.band.y + g.band.h * 0.12, w: g.film.w, h: Math.min(g.band.h * 0.66, g.film.h * 0.3) };
    const pad = R * 0.5;
    return { wv, tile: { x: g.film.x - pad, y: g.film.y - pad, w: g.film.w + 2 * pad, h: wv.y + wv.h + pad - g.film.y + pad } };
  };
  const playBtn = (r, s) => {
    if (s <= 0) return;
    const [cx, cy] = L.center(r), rr = Math.min(r.w, r.h) * 0.15 * s;
    D.disc(ctx, cx, cy, rr, 'bg');
    D.fillPoly(ctx, [[cx - rr * 0.32, cy - rr * 0.45], [cx + rr * 0.5, cy], [cx - rr * 0.32, cy + rr * 0.45]], 'accent');
  };
  const T0 = BASE + 0.62;                                          // a fast stretch of the arc: the streak reads
  const blendState = (f, g, lb, k) => {
    const { wv, tile } = tileOf(g);
    const lock = M.clamp(sp(f, 4, 'snap'), 0, 1.02) * k;
    if (lock > 0) D.fillBox(ctx, L.lerpBox(g.film, tile, lock), 'fg', rad(tile));
    const rise = M.clamp(sp(f, 3, 'snap'), 0, 1.05) * k;
    if (rise > 0) drawWave(api, { ...wv, y: wv.y + (1 - Math.min(1, rise)) * g.band.h * 0.6 }, Math.min(1, rise), lock > 0.5 ? 'bg' : 'fg');
    const playing = lb >= 5 ? lb - 5 : 0;
    drawFilm(api, g.film, T0 + 4 * SUB + playing, { ball: playing > 0 });
    if (!playing) drawStreak(api, g.film, T0, T0 + 4 * SUB * 1.6, M.clamp(sp(f, 2.1)));
    playBtn(g.film, M.clamp(sp(f, 4.25, 'snap'), 0, 1.05) * k);
  };
  const blend = {
    events: (S) => [1, 2, 3, 4, 4.25, 5].filter((b) => b < S),
    sfx: (S) => [{ at: 1, sfx: 'pop', gain_db: -10 }, { at: 2, sfx: 'whoosh', gain_db: -8 }, { at: 3, sfx: 'swish', gain_db: -10 },
      { at: 4, sfx: 'thump', gain_db: -3 }, { at: 4.25, sfx: 'pop', gain_db: -8 }, { at: 5, sfx: 'tick', gain_db: -8 }].filter((m) => m.at < S),
    draw(f, g) {
      // four sub-frames fan out (down and right, never up into the title), stacked back to front, then collapse
      const fan = M.clamp(sp(f, 1)) - M.clamp(sp(f, 2)), collapsed = f.lb >= 2;
      if (!collapsed || fan > 0.002) {
        const dx = g.film.w * 0.05 * fan, dy = Math.min(g.film.h * 0.06, g.band.h * 0.22) * fan;
        for (let d = 3; d >= 1; d--) drawFilm(api, { ...g.film, x: g.film.x + d * dx, y: g.film.y + d * dy }, T0 + d * SUB * 1.6);
        if (!collapsed) { drawFilm(api, g.film, T0); return; }
      }
      blendState(f, g, f.lb, 1);
    },
    tail(f, g, q) { blendState({ ...f, since: () => 99 }, g, 4.9, q); },
  };

  // ---------- diagram (default hero) ----------
  const diagram = {
    plan: (step, g) => {
      const d = step.diagram, lay = planFlow(api, d, g.hero, chooseAxis(api, [d], g.hero)), tm = flowTiming(d, 1, 1);
      return { d, lay, tm, focus: d.focus ?? d.nodes.length - 1, focusAt: tm.doneAt + 0.25 };
    },
    events: (S, pl) => [...pl.d.nodes.map((_, j) => pl.tm.nodeAt(j)), pl.focusAt].filter((b) => b < S),
    sfx: (S, pl) => [...pl.d.nodes.map((_, j) => ({ at: pl.tm.nodeAt(j), sfx: 'pop', gain_db: -10 })),
      ...pl.tm.edges.map((e) => ({ at: pl.tm.edgeAt(e), sfx: 'swish', gain_db: -14 })), { at: pl.focusAt, sfx: 'click', gain_db: -8 }].filter((m) => m.at < S),
    draw(f, g, step, pl) {
      drawFlow(f, api, pl.lay, pl.tm, { packetAt: pl.focusAt + 0.5, lit: (j) => (j === pl.focus ? M.clamp(sp(f, pl.focusAt, 'snap')) : 0) });
    },
    tail() {},
  };

  return { scrub, paint, filmstrip, blend, diagram, LAYERS, BASE };
}
