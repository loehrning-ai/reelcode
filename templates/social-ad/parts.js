// social-ad helpers: the stage (safe area above the caption lane), springs, cue plumbing and the hook scene.
// Everything here is a pure function of the frame object; layout is computed once per format at build time.
export const TYPE = [0.35, 1]; // critically damped type: no overshoot on glyphs
export const UI = [0.28, 0.75];   // cards, chips and pills: a hair of bounce
export const q = (b) => Math.round(b * 4) / 4; // cue times on the 1/16 grid

/** The box ad copy may use: F.safe, cut above the burned-in caption lane (api.captionTop) when captions are on. */
export function stage(api) {
  const { F } = api, s = F.safe;
  const floor = Number.isFinite(api.captionTop) ? Math.min(s.y + s.h, api.captionTop - 24 * F.u) : s.y + s.h;
  return { x: s.x, y: s.y, w: s.w, h: floor - s.y };
}

/** Split along the frame's long side: stacked in portrait, side by side in square and landscape. */
export const along = (api, box, ratios, gapK = 40) =>
  api.L.split(box, ratios, { axis: api.F.orient === 'v' ? 'y' : 'x', gap: gapK * api.F.u });

/** Merge events and sfx lists (deduped, sorted, kept inside the planned scene length). */
export function cues(nb, events, sfx) {
  const ev = [...new Set(events.map(q))].filter((b) => b >= 0 && b < nb).sort((a, b) => a - b);
  const seen = new Set();
  const sx = sfx.map((m) => ({ ...m, at: q(m.at) })).filter((m) => {
    const k = `${m.at}|${m.sfx}`;
    if (m.at < 0 || m.at >= nb || seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a, b) => a.at - b.at);
  return { events: ev, sfx: sx };
}

/**
 * Media that bleeds off the frame: portrait runs the box to the canvas sides and to edges.v ('top'|'bottom');
 * landscape runs it to the full height and to edges.h ('left'|'right'); square keeps the rounded box. Media may sit
 * under platform chrome and the caption plate; text never does. -> {box, radius}
 */
export function bleed(api, box, edges = {}) {
  const { F } = api, full = F.full;
  if (F.orient === 'v' && edges.v) {
    const y0 = edges.v === 'top' ? full.y : box.y, y1 = edges.v === 'top' ? box.y + box.h : full.y + full.h;
    return { box: { x: full.x, y: y0, w: full.w, h: y1 - y0 }, radius: 0 };
  }
  if (F.orient === 'h' && edges.h) {
    const x0 = edges.h === 'left' ? full.x : box.x, x1 = edges.h === 'left' ? box.x + box.w : full.x + full.w;
    return { box: { x: x0, y: full.y, w: x1 - x0, h: full.h }, radius: 0 };
  }
  return { box, radius: api.theme.radius };
}

/**
 * Justified type: every line sized to the full box width, scaled down together to fit the height, centred
 * vertically. Sized on cap height (descenders may hang into the gap), so lines really fill the width. -> fit[]
 */
export function justify(api, lines, box, gapK = 0.24) {
  const { ctx, theme, T } = api;
  const cap100 = T.measure(ctx, theme, 'display', 'H', 100).cap / 100;
  let sizes = lines.map((l) => (box.w / T.measure(ctx, theme, 'display', l, 100).w) * 100);
  const height = (ss) => ss.reduce((a, x) => a + x * cap100, 0) + (ss.length - 1) * gapK * Math.min(...ss) * cap100;
  const k = Math.min(1, box.h / height(sizes));
  sizes = sizes.map((x) => x * k);
  let y = box.y + (box.h - height(sizes)) / 2;
  const gap = gapK * Math.min(...sizes) * cap100;
  return lines.map((l, i) => {
    const size = sizes[i], cap = size * cap100, w = T.measure(ctx, theme, 'display', l, size).w;
    const ft = { role: 'display', size, cap, overflow: false, lines: [{ s: l, x: box.x, y: y + cap, w }], box: { x: box.x, y, w, h: cap } };
    y += cap + gap;
    return ft;
  });
}

/** A media scene (photo or clip) inside a box, or null. Shared by hook, offer and CTA. */
export function mediaIn(api, id, src, box, o = {}) {
  if (!src || (!src.image && !src.clip)) return null;
  const common = { id, beats: o.beats, box, radius: o.radius ?? api.theme.radius, focus: src.focus, move: src.move || o.move,
    reveal: src.reveal || o.reveal, dir: src.dir || o.dir, revealAt: o.revealAt, duotone: src.duotone, amount: src.amount };
  return src.clip ? api.media.clipBlock(api, { ...common, clip: src.clip, from: src.from, to: src.to, rate: src.rate, loop: src.loop })
    : api.media.imageBlock(api, { ...common, image: src.image });
}

/**
 * A full-bleed backdrop that is on screen from the scene's first frame (no reveal over bare bg: the cut into the
 * scene is the reveal). Stills drift linearly from `from` to `to` ({zoom, pan:[x,y]}) over the scene, so two scenes
 * that share a photo continue one camera move across their seam (offer -> CTA). Clips play as a clipBlock.
 * -> {draw(f)} or null
 */
export function backdrop(api, id, src, beats, { from = { zoom: 1, pan: [0, 0] }, to = { zoom: 1.06, pan: [0, 0] } } = {}) {
  if (!src || (!src.image && !src.clip)) return null;
  const { F, theme, M } = api;
  if (src.clip) return mediaIn(api, id, { ...src, reveal: 'none' }, F.full, { beats, radius: 0 });
  const img = api.assets.images && api.assets.images[src.image];
  if (!img) throw new Error(`social-ad: no image "${src.image}" in project.assets (have: ${Object.keys(api.assets.images || {}).join(', ') || 'none'})`);
  const focus = Array.isArray(src.focus) ? src.focus : [0.5, 0.5];
  return {
    draw(f) {
      const p = M.clamp(f.lt / (f.scene.beats * f.grid.spb));
      const zoom = from.zoom + (to.zoom - from.zoom) * p;
      const pan = [0, 1].map((k) => from.pan[k] + (to.pan[k] - from.pan[k]) * p);
      api.media.drawMedia(f.ctx, theme, img, F.full, { focus, zoom, pan, duotone: src.duotone, radius: 0 });
    },
  };
}

/** The offer/CTA camera when they share a photo: one move over both scenes (16:9 pans right to left, the others push in). */
export const cardMove = (api, part) => {
  const pan = api.F.orient === 'h';
  const k = part === 'cta' ? [0.5, 1] : [0, 0.5];
  const at = (x) => (pan ? { zoom: 1.14, pan: [0.05 - 0.1 * x, 0] } : { zoom: 1 + 0.12 * x, pan: [0, 0] });
  return { from: at(k[0]), to: at(k[1]) };
};

/**
 * Hook: one idea in one move. Layer A (hook.image + the first `turn` lines) is on screen, set large, on frame 0;
 * its remaining lines land from b0.5. On `turnAt` the whole frame slides left like a train window and layer B
 * (hook.then + the remaining lines) slides in; its words land as the slide settles and the accent word punches a
 * beat later. Without `then` it is one layer. Type sits low; both photos are framed a little tight (zoom 1.25+) so
 * focus [x, 1] lifts a horizon above the type and keeps it over the darker foreground.
 */
export function hookScene(api, o) {
  const { F, ctx, theme, T, L, M } = api;
  const { id, beats, hook } = o;
  const ST = 0.25, SLIDE = 0.75;
  const st = stage(api), hasMedia = !!(hook.image || hook.clip);
  const second = hook.then && (hook.then.image || hook.then.clip) ? hook.then : null;
  const n = hook.lines.length;
  const turn = second && n > 1 ? M.clamp(hook.turn ?? Math.ceil(n / 2), 1, n - 1) : n;
  const turnAt = second ? q(hook.turnAt ?? Math.min(3, beats - 4)) : beats;
  const region = !hasMedia ? st : F.pick({
    v: { x: st.x, y: st.y + st.h * 0.5, w: st.w, h: st.h * 0.5 },
    s: { x: st.x, y: st.y + st.h * 0.44, w: st.w, h: st.h * 0.56 },
    h: { x: st.x, y: st.y + st.h * 0.36, w: st.w * 0.62, h: st.h * 0.64 },
  });
  const box = L.inset(region, { l: region.w * 0.025, r: region.w * 0.025, t: region.h * 0.03, b: region.h * 0.03 }); // the 3.5 % accent punch scales about the centre: room on both sides
  const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const layer = (lines, at0, rest) => {
    let offset = 0;
    return justify(api, lines, box).map((ft, i) => {
      const units = T.kineticUnits(ctx, theme, ft, 'word');
      const at = i === 0 && rest ? -2 - units.length * ST : at0 + offset * ST;
      if (!(i === 0 && rest)) offset += units.length;
      return { ft, at, n: units.length, acc: hook.accent ? units.map((u, k) => (norm(u.s) === norm(hook.accent) ? k : -1)).filter((k) => k >= 0) : [] };
    });
  };
  const A = layer(hook.lines.slice(0, turn), 0.5, turn > 1 || !!second);
  const B = second ? layer(hook.lines.slice(turn), turnAt + 0.5, false) : [];
  const groups = [...A, ...B];
  const lastAt = Math.max(...groups.map((g) => g.at + (g.n - 1) * ST));
  const hasAccent = groups.some((g) => g.acc.length);
  const accentAt = q(Math.min(beats - 1.5, Math.max(0.5, lastAt + 1)));
  const mediaA = hasMedia ? backdrop(api, `${id}-a`, hook, beats, { from: { zoom: 1.25, pan: [0, 0] }, to: { zoom: 1.33, pan: [0, 0] } }) : null;
  const mediaB = second ? backdrop(api, `${id}-b`, second, beats, { from: { zoom: 1.36, pan: [0, 0] }, to: { zoom: 1.26, pan: [0, 0] } }) : null;
  const starts = groups.map((g) => g.at).filter((at) => at >= 0).map(q);
  const c = cues(beats, [0, ...starts, ...(second ? [turnAt] : []), ...(hasAccent ? [accentAt] : [])],
    [{ at: 0, sfx: 'thump', gain_db: -6 }, ...starts.map((at) => ({ at, sfx: 'pop', gain_db: -8 })),
      ...(second ? [{ at: turnAt, sfx: 'whoosh', gain_db: -7 }] : []), ...(hasAccent ? [{ at: accentAt, sfx: 'thump', gain_db: -3 }] : [])]);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const type = (f, gs) => {
    const lit = f.lb >= accentAt;
    const punch = hasAccent ? f.hit(accentAt, 0.12) * 0.035 : 0;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1 + punch, 1 + punch); ctx.translate(-cx, -cy);
    for (const g of gs) T.kinetic(f, g.ft, { by: 'word', at: g.at, stagger: ST, from: 'mask', spring: TYPE, accent: lit ? g.acc : [] });
    ctx.restore();
  };
  return {
    id, beats, ...c, cut: 'keep',
    draw(f) {
      const p = second ? M.easeInOutCubic(f.since(turnAt) / (SLIDE * f.grid.spb)) : 0;
      // layer A slides out to the left; text is drawn but not logged once it moves (it is leaving the frame)
      if (p < 1) {
        ctx.save(); ctx.translate(-p * F.w, 0);
        if (mediaA) mediaA.draw(f);
        if (p > 0) T.quiet(() => type(f, A)); else type(f, A);
        ctx.restore();
      }
      if (p > 0) {
        ctx.save(); ctx.translate((1 - p) * F.w, 0);
        if (p < 1) api.D.fillBox(ctx, F.full, 'bg');
        if (mediaB) mediaB.draw(f);
        if (p < 1) T.quiet(() => type(f, B)); else type(f, B);
        ctx.restore();
      }
    },
  };
}
