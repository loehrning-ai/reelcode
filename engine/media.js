// media.js: photo / video-clip / lower-third blocks for templates (v2 interface; owner: media).
// Exposed to templates as api.media (the module namespace). Same rules as engine/blocks.js: each block returns a
// Scene {id, beats, events, sfx, transition, draw(f)} (or a persistent layer {id, draw(f)}), draws only from f,
// colours from theme keys, sizes from F, no globalAlpha, no glow. Clips are pre-extracted PNG sequences
// (engine/cli/lib/clips.mjs) so a frame is a pure function of t: no <video> element, no decode during seek.
//
// Text over media always sits on an opaque plate whose colours are picked by WCAG contrast at build time, and every
// text unit starts only after its plate is fully open (and stops logging when the plate starts to close), so the
// text-vs-pixels-behind check always reads the plate.
import { sp, spring, clamp, quant, settle } from './motion.js';
import { fitText, kinetic, drawText, readable, paint, logMedia } from './text.js';
import { fillBox, rrect } from './draw.js';
import { loadImages } from './assets.js';
import { parseAt } from './beat.js';

// ---------- small pure helpers (exported for tests) ----------
const plan = (beats) => (beats === 'fill' ? 8 : beats);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of '#RRGGBB'. */
export const luma = (hex) => { const [r, g, b] = hexRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG contrast ratio (1..21) of two '#RRGGBB' colours. */
export const contrast = (a, b) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/**
 * inkFor(theme) -> {plate, ink, sub, ratio}: theme keys for a text plate. bg plate + fg ink when that reaches 7:1,
 * else the best pair; the secondary line uses muted when it still clears 4.5:1, else the main ink.
 */
export function inkFor(theme) {
  const c = theme.colors;
  let best = { plate: 'bg', ink: 'fg', ratio: contrast(c.bg, c.fg) };
  if (best.ratio < 7) {
    for (const plate of ['bg', 'surface', 'fg', 'accent']) for (const ink of ['fg', 'bg']) {
      if (plate === ink) continue;
      const r = contrast(c[plate], c[ink]);
      if (r > best.ratio) best = { plate, ink, ratio: r };
    }
  }
  const sub = contrast(c[best.plate], c.muted) >= 4.5 && best.ink === 'fg' ? 'muted' : best.ink;
  return Object.freeze({ ...best, sub });
}

/**
 * coverView(iw, ih, box, {zoom=1, focus=[.5,.5], pan=[0,0]}) -> {sx, sy, sw, sh}: the source rect (aspect of box) that
 * covers box. zoom >= 1 narrows it; focus is the point of interest (0..1 of the image) it centres on; pan shifts it by
 * fractions of its own size. Always clamped inside the image, so the box is always covered.
 */
export function coverView(iw, ih, box, { zoom = 1, focus = [0.5, 0.5], pan = [0, 0] } = {}) {
  const ar = box.w / box.h, z = Math.max(1, zoom);
  const w0 = Math.min(iw, ih * ar), h0 = w0 / ar;
  const sw = w0 / z, sh = h0 / z;
  const cx = clamp(focus[0] * iw + pan[0] * sw, sw / 2, iw - sw / 2);
  const cy = clamp(focus[1] * ih + pan[1] * sh, sh / 2, ih - sh / 2);
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/** containView(iw, ih, box, {zoom=1, focus=[.5,.5]}) -> {dx, dy, dw, dh}: the whole image inside box (letterboxed). */
export function containView(iw, ih, box, { zoom = 1, focus = [0.5, 0.5] } = {}) {
  const s = Math.min(box.w / iw, box.h / ih) * Math.max(0.01, zoom);
  const dw = iw * s, dh = ih * s;
  return { dx: box.x + (box.w - dw) * focus[0], dy: box.y + (box.h - dh) * focus[1], dw, dh };
}

const MOVES = ['push-in', 'pull-out', 'pan-l', 'pan-r', 'pan-u', 'pan-d', 'none'];
/**
 * kenBurns(move, amount=0.1) -> {z0, z1, p0:[x,y], p1:[x,y]}: start/end zoom and pan (fractions of the view).
 * pan-l: the picture drifts left on screen (the camera travels right); pan-u: drifts up.
 */
export function kenBurns(move = 'push-in', amount = 0.1) {
  if (!MOVES.includes(move)) throw new Error(`media: move "${move}" (use ${MOVES.join(', ')})`);
  const a = Math.max(0, amount), z = 1 + a, d = a / 2;
  switch (move) {
    case 'push-in': return { z0: 1, z1: z, p0: [0, 0], p1: [0, 0] };
    case 'pull-out': return { z0: z, z1: 1, p0: [0, 0], p1: [0, 0] };
    case 'pan-l': return { z0: z, z1: z, p0: [-d, 0], p1: [d, 0] };
    case 'pan-r': return { z0: z, z1: z, p0: [d, 0], p1: [-d, 0] };
    case 'pan-u': return { z0: z, z1: z, p0: [0, -d], p1: [0, d] };
    case 'pan-d': return { z0: z, z1: z, p0: [0, d], p1: [0, -d] };
    default: return { z0: 1, z1: 1, p0: [0, 0], p1: [0, 0] };
  }
}

// The Ken Burns drift: a critically damped spring stretched over the scene (it is still moving on the last frame),
// plus, on scenes of 6+ beats, a faster spring that re-frames on the middle beat (a structural event, not decoration).
const KB = [0.99, 1]; // slow and critically damped: a Ken Burns move never bounces
const REFRAME = [0.66, 1];
/** kbProgress(lt, sceneSec, midSec|null) -> 0..1 (a hair over 1 at most). */
export function kbProgress(lt, sceneSec, mid = null) {
  const S = settle(KB, 0.01);
  const slow = spring(lt * S / (Math.max(0.1, sceneSec) * 1.15), KB[0], KB[1]);
  return mid === null ? slow : 0.62 * slow + 0.38 * sp(lt - mid, REFRAME);
}

/**
 * maskPath(ctx, type, p, box, {dir, origin, n}): add a reveal shape inside box to the current path (p 0..1).
 * type: wipe (dir l|r|u|d: the edge travels that way) | iris (origin [x,y] 0..1 of box) | slats (n bands) | none.
 */
export function maskPath(ctx, type, p, box, o = {}) {
  const { x, y, w, h } = box;
  p = clamp(p);
  if (type === 'none' || p >= 1) { ctx.rect(x, y, w, h); return; }
  if (p <= 0) return;
  if (type === 'wipe') {
    const d = o.dir || 'r';
    if (d === 'r') ctx.rect(x, y, w * p, h);
    else if (d === 'l') ctx.rect(x + w * (1 - p), y, w * p, h);
    else if (d === 'd') ctx.rect(x, y, w, h * p);
    else ctx.rect(x, y + h * (1 - p), w, h * p);
  } else if (type === 'iris') {
    const [fx, fy] = o.origin || [0.5, 0.5], ox = x + fx * w, oy = y + fy * h;
    const R = Math.max(Math.hypot(ox - x, oy - y), Math.hypot(x + w - ox, oy - y), Math.hypot(ox - x, y + h - oy), Math.hypot(x + w - ox, y + h - oy));
    ctx.moveTo(ox + R * p, oy); ctx.arc(ox, oy, R * p, 0, Math.PI * 2);
  } else if (type === 'slats') {
    const vertical = w >= h, n = o.n || (vertical ? 7 : 5), span = vertical ? w : h, len = vertical ? h : w, sw = span / n;
    for (let i = 0; i < n; i++) {
      const q = clamp(p * 1.6 - (i / n) * 0.6);
      if (q <= 0) continue;
      if (vertical) ctx.rect(x + i * sw, y + len * (1 - q), sw + 0.5, len * q);
      else ctx.rect(x, y + i * sw, len * q, sw + 0.5);
    }
  } else throw new Error(`media: reveal "${type}" (use wipe, iris, slats, none)`);
}

/** Clip frame index for a time in SOURCE seconds: floor((sec - from) * fps), held at the first/last frame. */
export const frameIndex = (clip, sec) => clamp(Math.floor((sec - clip.from) * clip.fps + 1e-6), 0, clip.frames - 1);

/**
 * clipTime(lt, {from, to, rate=1, loop=false, fps}) -> source seconds for local time lt (seconds into the scene).
 * Plays from `from` at `rate`; past `to` it holds the last frame (or wraps when loop).
 */
export function clipTime(lt, { from, to, rate = 1, loop = false, fps = 30 }) {
  const t = from + Math.max(0, lt) * rate, span = to - from;
  if (!(span > 0)) return from;
  if (loop) return from + (((t - from) % span) + span) % span;
  return Math.min(t, to - 0.5 / fps);
}

// ---------- drawing ----------
const resolveImage = (api, ref) => {
  const { images = {}, screens = {} } = api.assets || {};
  if (images[ref]) return images[ref];
  if (screens[ref]) return screens[ref].img;
  throw new Error(`media: no image "${ref}" (project.assets: ${Object.keys(images).join(', ') || 'none'}; screens: ${Object.keys(screens).join(', ') || 'none'})`);
};

const duoKeys = (d) => (d === true ? ['bg', 'accent'] : Array.isArray(d) && d.length === 2 ? d : null);

/**
 * drawMedia(ctx, theme, img, box, {fit, focus, zoom, pan, duotone, radius}): one frame of a picture in box.
 * duotone: true (bg shadows -> accent highlights) or [shadowKey, highlightKey]: grayscale, then multiply by the
 * highlight and screen the shadow colour (two composite fills; no per-pixel work, no state).
 */
export function drawMedia(ctx, theme, img, box, o = {}) {
  const { fit = 'cover', focus = [0.5, 0.5], zoom = 1, pan = [0, 0], radius = 0 } = o;
  const duo = duoKeys(o.duotone);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  ctx.save();
  rrect(ctx, box, radius); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  let area = box;
  if (duo) ctx.filter = 'grayscale(1) contrast(1.12)';
  if (fit === 'contain') {
    fillBox(ctx, box, 'surface');
    const v = containView(iw, ih, box, { zoom, focus });
    ctx.drawImage(img, v.dx, v.dy, v.dw, v.dh);
    area = { x: v.dx, y: v.dy, w: v.dw, h: v.dh };
  } else {
    const v = coverView(iw, ih, box, { zoom, focus, pan });
    ctx.drawImage(img, v.sx, v.sy, v.sw, v.sh, box.x, box.y, box.w, box.h);
  }
  ctx.filter = 'none';
  logMedia(ctx, box, 'media');
  if (duo) {
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = paint(theme, duo[1]); ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = paint(theme, duo[0]); ctx.fillRect(area.x, area.y, area.w, area.h);
  }
  ctx.restore();
}

// ---------- text plates (caption + lower third share them) ----------
/**
 * plateLayout(api, {title, sub, anchor:'top'|'bottom', side:'l'|'r', titleK, subK, lines, widthK}) -> layout (build time).
 * Text is fitted inside an opaque plate inside F.safe; an accent bar marks the plate's inner edge.
 * Exported (with drawPlate and plateCues) so templates can place their own cued plates without copying them.
 */
export function plateLayout(api, o) {
  const { F, ctx, theme } = api;
  const ink = inkFor(theme);
  const side = o.side === 'r' ? 'r' : 'l';
  const titleSize = readable(F, o.titleK ?? 1.5), subSize = readable(F, o.subK ?? 1.0);
  const pad = Math.round(titleSize * 0.42), bar = Math.max(6, Math.round(10 * F.u));
  const maxW = F.safe.w * F.pick(o.widthK || { v: 0.9, s: 0.8, h: 0.5 }) - pad * 2 - bar;
  // Both lines wrap (title up to o.lines, default 2; sub up to 2) before they shrink, and never below readable(F).
  const lines = o.lines || 2;
  const title = fitText(ctx, theme, o.title, { role: 'display', box: { x: 0, y: 0, w: maxW, h: titleSize * (1 + (lines - 1) * 1.05) },
    max: titleSize, min: readable(F), lines: 'auto', leading: 1.05 });
  const sub = o.sub ? fitText(ctx, theme, o.sub, { role: 'ui', box: { x: 0, y: 0, w: maxW, h: subSize * 2.3 }, max: subSize, min: readable(F), lines: 'auto', leading: 1.3 }) : null;
  const gap = sub ? Math.round(title.size * 0.42) : 0;
  const textW = Math.max(title.box.w, sub ? sub.box.w : 0);
  const textH = title.box.h + (sub ? gap + sub.box.h + sub.size * 0.22 : title.size * 0.22);
  const w = Math.ceil(textW + pad * 2 + bar), h = Math.ceil(textH + pad * 2);
  const x = side === 'l' ? F.safe.x : F.safe.x + F.safe.w - w;
  // bottom plates sit above the burned-in caption lane when captions are on (api.captionTop, runtime.js)
  const floor = Number.isFinite(api.captionTop) ? Math.min(F.safe.y + F.safe.h, api.captionTop) : F.safe.y + F.safe.h;
  const y = o.anchor === 'top' ? F.safe.y : floor - h;
  const tx = side === 'l' ? x + bar + pad : x + pad, ty = y + pad;
  const shift = (ft, dx, dy) => Object.freeze({ ...ft, lines: ft.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })), box: { ...ft.box, x: ft.box.x + dx, y: ft.box.y + dy } });
  return Object.freeze({
    ink, side, plate: { x, y, w, h }, bar: { x: side === 'l' ? x : x + w - bar, y, w: bar, h },
    title: shift(title, tx, ty), sub: sub ? shift(sub, tx, ty + title.box.h + gap) : null,
  });
}

/** Seconds the plate takes to retract after `until` (text is cut first, so nothing is logged over a half plate). */
const EXIT_BEATS = 0.75;

/**
 * drawPlate(fr, L, at, until): fr = {ctx, theme, grid, since(beats)} (a scene frame or a persistent pseudo-frame).
 * Build: the accent bar grows and the plate snaps open beside it (0; open within ~0.1 s), the title rises (0.25), the sub (0.5).
 * Exit (until): the text is cut, the plate folds back into the bar, then the bar drops.
 */
export function drawPlate(fr, L, at, until) {
  const { ctx, theme } = fr, spb = fr.grid.spb;
  const t = fr.since(at);
  if (t <= 0) return;
  const out = until === undefined ? -1 : fr.since(until);
  if (out > EXIT_BEATS * spb + 0.6) return;
  const { plate, bar, side, ink } = L;
  const barP = clamp(sp(t, 'snap')) * (out > 0 ? 1 - clamp(sp(out - EXIT_BEATS * spb * 0.6, 'stiff')) : 1);
  if (barP <= 0) return;
  const open = clamp(sp(t, 'snap')) * (out > 0 ? 1 - clamp(sp(out, 'stiff')) : 1);
  const pw = (plate.w - bar.w) * open;
  const pb = side === 'l' ? { x: bar.x + bar.w, y: plate.y, w: pw, h: plate.h } : { x: bar.x - pw, y: plate.y, w: pw, h: plate.h };
  fillBox(ctx, pb, ink.plate);
  const bh = bar.h * barP;
  fillBox(ctx, { x: bar.x, y: bar.y + (bar.h - bh), w: bar.w, h: bh }, 'accent');
  if (pw <= 0.5) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(pb.x, pb.y, pb.w, pb.h); ctx.clip();
  if (out <= 0) {
    // At rest and while entering: kinetic logs each unit's resting slot (the plate is fully open by then).
    kinetic(fr, L.title, { by: 'word', at: at + 0.25, stagger: 0.125, from: 'mask', spring: 'stiff', color: ink.ink });
    if (L.sub) kinetic(fr, L.sub, { by: 'line', at: at + 0.5, from: 'mask', spring: 'stiff', color: ink.sub });
  } else {
    // Leaving: drawn, not logged (the plate behind it is closing).
    for (const l of L.title.lines) drawText(ctx, theme, l.s, l.x, l.y, { role: 'display', size: L.title.size, color: ink.ink, log: false });
    if (L.sub) for (const l of L.sub.lines) drawText(ctx, theme, l.s, l.x, l.y, { role: 'ui', size: L.sub.size, color: ink.sub, log: false });
  }
  ctx.restore();
}

/** Events + sfx a plate adds to its scene (local beats). */
export const plateCues = (at, until, sceneBeats) => {
  const ev = [quant(at), ...(until !== undefined ? [quant(until)] : [])].filter((b) => b >= 0 && b < sceneBeats);
  const sfx = [{ at: quant(at), sfx: 'swish', gain_db: -12 }, { at: quant(at + 0.25), sfx: 'pop', gain_db: -10 },
    ...(until !== undefined ? [{ at: quant(until), sfx: 'swish', gain_db: -14 }] : [])].filter((m) => m.at >= 0 && m.at < sceneBeats);
  return { events: ev, sfx };
};

// ---------- the shared media scene ----------
function mediaScene(api, o, kind, frameOf) {
  const { F, theme } = api;
  const { id, beats, transition } = o;
  if (typeof id !== 'string' || !id) throw new Error(`media.${kind}: id is required`);
  const nb = plan(beats);
  const box = o.box || F.full;
  const radius = o.radius ?? (box === F.full ? 0 : theme.radius);
  const fit = o.fit === 'contain' ? 'contain' : 'cover';
  const focus = Array.isArray(o.focus) ? o.focus : [0.5, 0.5];
  const move = o.move || (kind === 'imageBlock' ? 'push-in' : 'none');
  const kb = kenBurns(move, o.amount ?? (kind === 'imageBlock' ? 0.1 : 0.05));
  const reveal = o.reveal || (transition && transition.type !== 'cut' ? 'none' : 'wipe');
  const revealOpts = { dir: o.dir, origin: o.origin || focus, n: o.slats };
  const revealSpring = o.spring || [0.5, 1];
  // The reveal is already under way on the scene's first frame (default -0.25 beats), so a cut never shows an empty frame.
  const revealAt = o.revealAt ?? -0.25;
  const mid = move !== 'none' && nb >= 6 ? quant(nb / 2) : null;
  const cap = o.caption ? plateLayout(api, { title: o.caption, anchor: 'top', side: o.captionSide || 'l', titleK: 1.9, lines: 3, widthK: { v: 0.92, s: 0.86, h: 0.56 } }) : null;
  const capAt = o.captionAt !== undefined ? parseAt(o.captionAt, api.grid) : 1;
  const lower = o.lower ? plateLayout(api, { title: o.lower.title, sub: o.lower.sub, anchor: 'bottom', side: o.lower.side || 'l' }) : null;
  const lowAt = o.lower ? parseAt(o.lower.at ?? 1.5, api.grid) : 0;
  const lowUntil = o.lower && o.lower.until !== undefined ? parseAt(o.lower.until, api.grid) : undefined;
  const pc = lower ? plateCues(lowAt, lowUntil, nb) : { events: [], sfx: [] };
  const events = [0, ...(cap ? [quant(capAt)] : []), ...(mid !== null ? [mid] : []), ...pc.events].filter((b) => b < nb);
  const sfx = [...(reveal !== 'none' ? [{ at: 0, sfx: 'whoosh', gain_db: -10 }] : []), ...(cap ? [{ at: quant(capAt), sfx: 'pop', gain_db: -8 }] : []),
    ...(mid !== null ? [{ at: mid, sfx: 'swish', gain_db: -12 }] : []), ...pc.sfx].filter((m) => m.at < nb);
  return {
    id, beats, transition, events: [...new Set(events)].sort((a, b) => a - b), sfx, cut: o.cut,
    draw(f) {
      const { ctx } = f;
      const sec = f.scene.beats * f.grid.spb;
      const p = kbProgress(f.lt, sec, mid === null ? null : mid * f.grid.spb);
      const zoom = kb.z0 + (kb.z1 - kb.z0) * p;
      const pan = [kb.p0[0] + (kb.p1[0] - kb.p0[0]) * p, kb.p0[1] + (kb.p1[1] - kb.p0[1]) * p];
      const r = reveal === 'none' ? 1 : clamp(sp(f.since(revealAt), revealSpring));
      if (r > 0) {
        ctx.save();
        ctx.beginPath(); maskPath(ctx, reveal, r, box, revealOpts); ctx.clip();
        drawMedia(ctx, theme, frameOf(f), box, { fit, focus, zoom, pan, duotone: o.duotone, radius });
        ctx.restore();
      }
      if (cap) drawPlate(f, cap, capAt, o.captionUntil !== undefined ? parseAt(o.captionUntil, f.grid) : undefined);
      if (lower) drawPlate(f, lower, lowAt, lowUntil);
    },
  };
}

/**
 * imageBlock(api, o) -> Scene
 * o: {id, beats: n|'fill', image: asset id (project.assets) | screen id, fit: 'cover'|'contain', focus: [x, y] (0..1),
 *     move: 'push-in'|'pull-out'|'pan-l'|'pan-r'|'pan-u'|'pan-d'|'none' (default push-in), amount (0.1),
 *     reveal: 'wipe'|'iris'|'slats'|'none' (default wipe; none when the scene has a transition), dir, origin, slats,
 *     revealAt (beats; default -0.25: about half open on the first frame),
 *     duotone: true | [shadowKey, highlightKey], caption, captionAt (1), captionUntil, captionSide,
 *     lower: {title, sub, at (1.5), until, side}, box (F.full), radius, transition, spring (reveal), cut}
 * Ken Burns: a spring-driven drift over the whole scene; on 6+ beats it re-frames on the middle beat (event + swish).
 */
export function imageBlock(api, o) {
  const img = resolveImage(api, o.image);
  return mediaScene(api, o, 'imageBlock', () => img);
}

/**
 * clipBlock(api, o) -> Scene
 * o: {id, beats: n|'fill', clip: project.clips id, from: seconds into the source (default clip.from), to (clip.to),
 *     rate: 1 (speed), loop: false, fit: 'cover'|'contain', focus, move (default none), amount (0.05), reveal, dir,
 *     duotone, caption, lower, box (default F.full), radius, transition, cut}
 * Frame for local time lt: api.clips[clip].frameAt(clipTime(lt)) (held on the last frame past `to`, or wrapped).
 */
export function clipBlock(api, o) {
  const c = api.clips && api.clips[o.clip];
  if (!c) throw new Error(`media.clipBlock "${o.id}": clip "${o.clip}" is not loaded (have: ${Object.keys(api.clips || {}).join(', ') || 'none'}; declare it in project.clips and run make)`);
  const from = o.from ?? c.from, to = o.to ?? c.to, rate = o.rate ?? 1;
  if (!(from >= c.from - 1e-6 && to <= c.to + 1e-6 && to > from)) throw new Error(`media.clipBlock "${o.id}": from/to ${from}-${to} must lie inside the extracted ${c.from}-${c.to}s`);
  if (!(rate > 0)) throw new Error(`media.clipBlock "${o.id}": rate must be > 0`);
  const tm = { from, to, rate, loop: !!o.loop, fps: c.fps };
  return mediaScene(api, o, 'clipBlock', (f) => c.frameAt(clipTime(f.lt, tm)));
}

/**
 * lowerThird(api, o) -> persistent layer {id, draw(f)}
 * o: {id, title, sub, at: time ref, until: time ref, side: 'l'|'r', scene: scene id}
 * Global refs by default; with `scene`, at/until are local to that scene and the layer draws only while it is active
 * (cutdown-safe). The plate is opaque and paints nothing else, so it composites over footage or a transparent canvas.
 * Persistent layers add no events or sfx; use the blocks' `lower` option for a cued, in-scene lower third.
 */
export function lowerThird(api, o) {
  if (typeof o.id !== 'string' || !o.id) throw new Error('media.lowerThird: id is required');
  if (typeof o.title !== 'string' || !o.title) throw new Error(`media.lowerThird "${o.id}": title is required`);
  const L = plateLayout(api, { title: o.title, sub: o.sub, anchor: 'bottom', side: o.side || 'l' });
  const at = parseAt(o.at ?? 0, api.grid), until = o.until !== undefined ? parseAt(o.until, api.grid) : undefined;
  return {
    id: o.id,
    layout: L,
    draw(f) {
      if (o.scene !== undefined && f.scene.id !== o.scene) return;
      const since = o.scene !== undefined ? (b) => f.scene.since(b) : (b) => f.t - f.grid.beat(b);
      drawPlate({ ctx: f.ctx, theme: f.theme, grid: f.grid, since }, L, at, until);
    },
  };
}

/**
 * loadClips(base, clips) -> Promise<{[id]: {id, fps, frames, w, h, from, to, frameAt(sec) -> CanvasImageSource, index(sec)}}>
 * Called once at boot by runtime.js when project.clips is non-empty. base = '/projects/<name>/';
 * clips = resolved project.clips. Reads assets/clips/<id>/clip.json ({fps, frames, w, h, pattern}) written by
 * engine/cli/lib/clips.mjs and preloads every frame (decode at boot, never during seek).
 */
export async function loadClips(base, clips) {
  const out = {};
  for (const [id, spec] of Object.entries(clips || {})) {
    const dir = `${base}assets/clips/${id}/`;
    const r = await fetch(`${dir}clip.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`clips: "${id}" has no frames (${dir}clip.json); run make, or node engine/cli/lib/clips.mjs projects/<name>`);
    const j = await r.json();
    const stale = [['fps', spec.fps], ['from', spec.from], ['to', spec.to]].filter(([k, v]) => v !== undefined && Math.abs(v - j[k]) > 1e-6);
    if (stale.length) throw new Error(`clips: "${id}" frames are stale (${stale.map(([k, v]) => `${k} ${j[k]} != ${v}`).join(', ')}); run make to re-extract`);
    if (!(j.frames >= 1 && j.fps > 0)) throw new Error(`clips: "${id}" clip.json is invalid`);
    const name = (i) => j.pattern.replace('%05d', String(i).padStart(5, '0'));
    const imgs = await loadImages(Object.fromEntries(Array.from({ length: j.frames }, (_, i) => [i, dir + name(i)])));
    const list = Array.from({ length: j.frames }, (_, i) => imgs[i]);
    const clip = { id, fps: j.fps, frames: j.frames, w: j.w, h: j.h, from: j.from, to: j.to };
    clip.index = (sec) => frameIndex(clip, sec);
    clip.frameAt = (sec) => list[frameIndex(clip, sec)];
    out[id] = Object.freeze(clip);
  }
  return out;
}
