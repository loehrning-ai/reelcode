// social-ad window motif: a foreground frame (an RGBA overlay with a transparent window, e.g. a train carriage made
// in code by a project script) that the world slides past behind. content.frame = {image, hole:[x,y,w,h] (0..1 of
// the frame), radius (0..1 of the short side)}; set one per aspect with overrides.<fmt>.content.frame so the window is
// laid out for each frame instead of cropped. The camera k (0 = the whole carriage, 1 = pushed through the window so
// the hole covers the frame) drives push-ins and pull-backs. Also: the frame shot (a photo/clip seen through the
// window with a pull-back reveal) and the split-flap board shot (UI that flips on the beat; no photo needed).
import { TYPE, q, cues } from './parts.js';

/** Build-time window geometry for this format, or null when the project has no frame. */
export function windowFrame(api, frame) {
  if (!frame || !frame.image) return null;
  const { F, M } = api;
  const img = api.assets.images && api.assets.images[frame.image];
  if (!img) throw new Error(`social-ad: frame image "${frame.image}" is not in project.assets`);
  const [hx, hy, hw, hh] = Array.isArray(frame.hole) ? frame.hole : [0.08, 0.08, 0.84, 0.62];
  const hole = { x: hx * F.w, y: hy * F.h, w: hw * F.w, h: hh * F.h };
  const radius = (frame.radius ?? 0.1) * Math.min(F.w, F.h);
  const hc = [hole.x + hole.w / 2, hole.y + hole.h / 2];
  const sMax = Math.max(F.w / hole.w, F.h / hole.h) * 1.02;
  /** Apply the camera for push k (0..1): a similarity that maps the hole onto the whole frame at k = 1. */
  const camera = (ctx, k) => {
    const kk = M.clamp(k), s = 1 + (sMax - 1) * kk;
    ctx.translate(hc[0] + (F.cx - hc[0]) * kk, hc[1] + (F.cy - hc[1]) * kk);
    ctx.scale(s, s);
    ctx.translate(-hc[0], -hc[1]);
  };
  /**
   * Draw world(box, ctx) inside the window and the carriage over it, under camera k (into ctx, default f.ctx).
   * screen(ctx) (optional) paints in frame coordinates over the world but under the carriage, clipped to the glass:
   * a scrim that darkens the view without dimming the carriage.
   */
  const draw = (f, k, world, ctx = f.ctx, screen = null) => {
    const { theme } = f;
    const base = ctx.getTransform();
    ctx.save();
    camera(ctx, k);
    ctx.save(); api.D.rrect(ctx, hole, radius); ctx.clip();
    world(hole, ctx);
    if (screen) { ctx.save(); ctx.setTransform(base); screen(ctx); ctx.restore(); }
    ctx.restore();
    if (k < 0.995) api.media.drawMedia(ctx, theme, img, F.full, { radius: 0 });
    ctx.restore();
  };
  return { hole, radius, draw, camera, img };
}

/**
 * A wide still sliding past inside box: drift is the pan across the scene (fractions of the view, + = the picture
 * moves left, the train travels right), so a 3:1 plate streams past for the whole shot.
 */
export function slideWorld(api, src, { drift = 0.5, zoom = 1.02 } = {}) {
  const img = api.assets.images && api.assets.images[src.image];
  if (!img) throw new Error(`social-ad: no image "${src.image}" in project.assets`);
  const focus = Array.isArray(src.focus) ? src.focus : [0.5, 0.5];
  return (f, box, p, ctx = f.ctx) => api.media.drawMedia(ctx, api.theme, img, box,
    { focus, zoom, pan: [(-0.5 + p) * drift, 0], duotone: src.duotone, radius: 0 });
}

/** A transparent layer tiled horizontally and moving at speed (frame widths per second): parallax in front. */
export function nearLayer(api, id, speed = 0.9) {
  const img = id && api.assets.images && api.assets.images[id];
  if (!id) return null;
  if (!img) throw new Error(`social-ad: no image "${id}" in project.assets`);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  return (f, box, ctx = f.ctx) => {
    const s = box.h / ih, tw = iw * s;
    const off = api.M.mod(f.lt * speed * api.F.w, tw);
    for (let x = box.x - off; x < box.x + box.w; x += tw) ctx.drawImage(img, x, box.y, tw + 1, box.h);
  };
}

/**
 * The window shot: the shot's photo/clip slides past inside the window; the camera starts pushed through the glass
 * (the world fills the frame) and pulls back out over `pull` beats to reveal the carriage (berth, lamp, tray).
 * Its line sits on a plate at the top. shot.near (an RGBA plate id, shot.nearSpeed frame widths/s) streams past in front
 * of the world; shot.creep (0..1) keeps the camera pushing toward the glass after the pull-back. -> Scene
 */
export function frameShot(api, o) {
  const { M } = api;
  const { id, beats, shot, win, transition, cut } = o;
  const pull = shot.pull ?? 3;
  const world = shot.clip ? null : slideWorld(api, shot, { drift: shot.amount ?? 0.35 });
  const near = nearLayer(api, shot.near, shot.nearSpeed ?? 0.7);
  const creep = shot.creep ?? 0; // after the pull-back the camera keeps pushing toward the glass by this much of k
  const clip = shot.clip ? api.clips && api.clips[shot.clip] : null;
  if (shot.clip && !clip) throw new Error(`social-ad: frame shot "${id}" clip "${shot.clip}" is not loaded`);
  const tm = clip ? { from: shot.from ?? clip.from, to: shot.to ?? clip.to, rate: shot.rate ?? 1, loop: !!shot.loop, fps: clip.fps } : null;
  const cap = shot.line ? api.media.plateLayout(api, { title: shot.line, anchor: 'top', side: shot.side || 'l', titleK: 1.9, lines: 3, widthK: { v: 0.92, s: 0.86, h: 0.56 } }) : null;
  const capAt = 0.5;
  const pc = cap ? api.media.plateCues(capAt, undefined, beats) : { events: [], sfx: [] };
  const c = cues(beats, [0, q(pull), ...pc.events], [{ at: q(pull - 0.5), sfx: 'swish', gain_db: -11 }, ...pc.sfx]);
  return {
    id, beats, transition, cut, ...c,
    draw(f) {
      const p = M.clamp(f.lt / (f.scene.beats * f.grid.spb));
      const rest = Math.max(0, f.scene.beats - pull) * f.grid.spb;
      const k = 1 - M.easeInOutCubic(f.since(0) / (pull * f.grid.spb)) + creep * M.easeInOutCubic(M.clamp((f.since(pull) / Math.max(rest, 1e-6))));
      win.draw(f, k, (box, cx) => {
        if (clip) api.media.drawMedia(cx, api.theme, clip.frameAt(api.media.clipTime(f.lt, tm)), box,
          { focus: shot.focus || [0.5, 0.5], zoom: 1.08, pan: [(-0.5 + p) * 0.12, 0], radius: 0 });
        else world(f, box, p, cx);
        if (near) near(f, box, cx);
      });
      if (cap) api.media.drawPlate(f, cap, capAt);
    },
  };
}

// ---------- split-flap board ----------
const ALPH = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:→·';
const FLIP = 0.125; // beats per flap

/**
 * Split-flap board: content rows (shot.flap.rows, up to 4, <= 12 chars) flip into place row by row on the beat over a
 * wall of blank tiles that bleeds off every edge. shot.flap.accent: the row index set in the accent colour. A slow
 * push-in carries it; the line VO is the picture (no plate). -> Scene
 */
export function flapShot(api, o) {
  const { F, ctx, theme, T, D, M } = api;
  const { id, beats, shot, transition, cut } = o;
  const rows = shot.flap.rows.map((r) => String(r).toUpperCase());
  const accent = shot.flap.accent ?? 0;
  const cols = Math.max(...rows.map((r) => [...r].length));
  const st = F.safe;
  const gap = Math.max(4, 8 * F.u);
  const ZOOM = 1.07; // the push-in: rows are sized so the zoomed board still sits inside the safe area
  const AR = 1.3, GLYPH = 0.8; // tile height/width, glyph size/tile height
  // every row gets the biggest tiles its length allows (a short time row reads big), capped at 1.7x the longest row's
  const fitW = (n) => (st.w / ZOOM - gap * (n - 1)) / n;
  const base = fitW(cols);
  let tws = rows.map((r) => Math.min(fitW([...r].length), base * 1.7));
  const hSum = (ts) => ts.reduce((a, t) => a + t * AR, 0) + gap * 1.5 * (rows.length - 1);
  const kH = Math.min(1, (st.h * 0.86 / ZOOM) / hSum(tws));
  tws = tws.map((t) => t * kH);
  const tw = base * kH, th = tw * AR; // the blank wall's pitch
  const size = th * GLYPH;
  const cap = T.measure(ctx, theme, 'display', 'H', size).cap;
  const nx = Math.ceil(F.w / (tw + gap)) + 3, ny = Math.ceil(F.h / (th + gap)) + 3;
  const x0 = F.cx - (cols * tw + (cols - 1) * gap) / 2, y0 = F.cy - (rows.length * th + (rows.length - 1) * gap) / 2;
  let yy = F.cy - hSum(tws) / 2;
  const rowGeo = tws.map((t, r) => {
    const n = [...rows[r]].length, w = n * t + (n - 1) * gap;
    const g = { tw: t, th: t * AR, size: t * AR * GLYPH, x: F.cx - w / 2, y: yy };
    g.cap = T.measure(ctx, theme, 'display', 'H', g.size).cap;
    yy += g.th + gap * 1.5;
    return g;
  });
  const starts = rows.map((_, r) => q(0.25 + r * 0.75));
  const cells = rows.map((row, r) => [...row].map((ch, c) => {
    const n = ch === ' ' ? 0 : 5 + ((c * 7 + r * 3) % 4);
    const seq = [];
    let k = (c * 11 + r * 5) % ALPH.length;
    for (let i = 0; i < n; i++) { seq.push(ALPH[k]); k = (k + 1 + ((c + i) % 3)) % ALPH.length; }
    seq.push(ch);
    const g = rowGeo[r];
    return { ch, seq, at: starts[r] + c * 0.03, box: { x: g.x + c * (g.tw + gap), y: g.y, w: g.tw, h: g.th } };
  }));
  const lands = rows.map((_, r) => Math.max(...cells[r].map((cl) => cl.at + (cl.seq.length - 1) * FLIP)));
  const ticks = starts.flatMap((s) => [s, s + 0.25, s + 0.5]).map((at) => ({ at, sfx: 'tick', gain_db: -13 }));
  const c = cues(beats, [0, ...starts, ...lands.map((l) => q(l + 0.125))],
    [...ticks, ...lands.map((l, r) => ({ at: q(l + 0.125), sfx: r === accent ? 'thump' : 'click', gain_db: r === accent ? -5 : -9 }))]);
  const glyph = (ch, b, col, clipTop, inkOf) => {
    if (ch === ' ') return;
    const gs = b.h * GLYPH, gc = T.measure(ctx, theme, 'display', 'H', gs).cap;
    ctx.save(); ctx.beginPath();
    ctx.rect(b.x, clipTop ? b.y : b.y + b.h / 2, b.w, b.h / 2); ctx.clip();
    T.drawText(ctx, theme, ch, b.x + b.w / 2, b.y + b.h / 2 + gc / 2, { role: 'display', size: gs, color: col, align: 'c', log: false, inkOf });
    ctx.restore();
  };
  const split = (b) => D.fillBox(ctx, { x: b.x, y: b.y + b.h / 2 - Math.max(1.5, 2 * F.u), w: b.w, h: Math.max(3, 4 * F.u) }, 'bg');
  void size; void cap;
  const pitchX = tw + gap, pitchY = th + gap;
  const i0 = -Math.ceil(x0 / pitchX) - 1, j0 = -Math.ceil(y0 / pitchY) - 1;
  return {
    id, beats, transition, cut, ...c,
    draw(f) {
      const p = M.clamp(f.lt / (f.scene.beats * f.grid.spb));
      const z = 1 + (ZOOM - 1) * M.easeInOutCubic(p);
      D.fillBox(ctx, F.full, 'bg');
      ctx.save();
      ctx.translate(F.cx, F.cy); ctx.scale(z, z); ctx.translate(-F.cx, -F.cy);
      for (let j = j0; j < j0 + ny; j++) for (let i = i0; i < i0 + nx; i++) {
        const b = { x: x0 + i * pitchX, y: y0 + j * pitchY, w: tw, h: th };
        D.fillBox(ctx, b, 'surface', tw * 0.08); split(b);
      }
      cells.forEach((row, r) => {
        const col = r === accent ? 'accent' : 'fg';
        let li;
        if (f.lb >= lands[r]) {
          // the landed row's resting slot (text QA reads the glyphs below through inkOf)
          const l = row[0].box, rr = row[row.length - 1].box, g = rowGeo[r];
          li = T.logText(ctx, rows[r], { x: l.x + g.tw * 0.12, y: l.y + l.h / 2 - g.cap / 2, w: rr.x + rr.w - l.x - g.tw * 0.24, h: g.cap }, g.size, 'display', false,
            { color: T.paint(theme, col), rest: true });
        }
        row.forEach((cl) => {
          const b = cl.box;
          const t = f.lb - cl.at;
          const i = t <= 0 ? 0 : Math.min(cl.seq.length - 1, Math.floor(t / FLIP));
          const ph = t <= 0 || i >= cl.seq.length - 1 ? 1 : (t - i * FLIP) / FLIP;
          const cur = t <= 0 ? ' ' : cl.seq[i], prev = t <= 0 || i === 0 ? ' ' : cl.seq[i - 1];
          if (ph >= 1) { glyph(cur, b, col, true, li); glyph(cur, b, col, false, li); return; }
          // the new glyph's top half shows as the old top flap falls; the old bottom half stays until the flap lands
          glyph(cur, b, col, true); glyph(prev, b, col, false);
          const fold = Math.cos(ph * Math.PI);
          ctx.save();
          ctx.translate(0, b.y + b.h / 2); ctx.scale(1, Math.max(0.001, Math.abs(fold))); ctx.translate(0, -(b.y + b.h / 2));
          D.fillBox(ctx, fold > 0 ? { x: b.x, y: b.y, w: b.w, h: b.h / 2 } : { x: b.x, y: b.y + b.h / 2, w: b.w, h: b.h / 2 }, 'surface');
          glyph(fold > 0 ? prev : cur, b, col, fold > 0);
          ctx.restore();
          split(b);
        });
      });
      ctx.restore();
    },
  };
}
