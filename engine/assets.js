// assets.js: image loading (boot only), cover/contain placement and screenshot rect mapping.
import { rrect } from './draw.js';

const REG = { images: {}, screens: {}, logo: null, json: null };

/** Load {id: url} into {id: HTMLImageElement}. Rejects with every failing path. */
export async function loadImages(map) {
  const out = {}, failed = [];
  await Promise.all(Object.entries(map).map(async ([id, url]) => {
    try {
      const img = new Image();
      img.decoding = 'sync';
      img.src = url;
      await img.decode();
      out[id] = img;
    } catch { failed.push(url); }
  }));
  if (failed.length) throw new Error(`assets: could not load ${failed.join(', ')}`);
  return out;
}

/** Called once by runtime.boot after loading. */
export function setRegistry({ images = {}, screens = {}, logo = null, json = null }) {
  REG.images = images; REG.screens = screens; REG.logo = logo; REG.json = json;
  return REG;
}
export const registry = () => REG;
export const image = (id) => {
  const img = REG.images[id];
  if (!img) throw new Error(`assets: no image "${id}" (declare it in project.assets)`);
  return img;
};

/** screen(id) -> {img, w, h, rects:{capId:[x,y,w,h]}} from assets/assets.json. */
export function screen(id) {
  const s = REG.screens[id];
  if (!s) throw new Error(`assets: no screen "${id}" (have: ${Object.keys(REG.screens).join(', ') || 'none; run capture'})`);
  return s;
}

/** Rect of a capture id on a screen, in screenshot pixels: {x, y, w, h}. */
export function capRect(s, capId) {
  const r = s.rects && s.rects[capId];
  if (!r) throw new Error(`assets: screen has no rect "${capId}" (have: ${Object.keys(s.rects || {}).join(', ')})`);
  return { x: r[0], y: r[1], w: r[2], h: r[3] };
}

/**
 * drawImage(ctx, img, box, {fit:'cover'|'contain', focus:[fx,fy], crop:[x,y,w,h], radius})
 * -> placed {x, y, w, h, scale, cx, cy}: where the (cropped) source lands in canvas pixels.
 */
export function drawImage(ctx, img, box, o = {}) {
  const { fit = 'cover', focus = [0.5, 0.5], crop, radius = 0, draw = true } = o;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const [cx, cy, cw, ch] = crop || [0, 0, iw, ih];
  const scale = fit === 'cover' ? Math.max(box.w / cw, box.h / ch) : Math.min(box.w / cw, box.h / ch);
  const w = cw * scale, h = ch * scale;
  const x = box.x + (box.w - w) * focus[0], y = box.y + (box.h - h) * focus[1];
  if (draw && box.w > 0 && box.h > 0) {
    ctx.save();
    rrect(ctx, fit === 'cover' ? box : { x, y, w, h }, radius); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
    ctx.restore();
  }
  return { x, y, w, h, scale, cx, cy };
}

/** Map a screenshot rect ([x,y,w,h] or Box) into canvas pixels after drawImage placed it. */
export function mapRect(rect, placed) {
  const r = Array.isArray(rect) ? { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } : rect;
  return { x: placed.x + (r.x - placed.cx) * placed.scale, y: placed.y + (r.y - placed.cy) * placed.scale, w: r.w * placed.scale, h: r.h * placed.scale };
}
