// film.js: the film inside the film. One real, high-contrast shot: a dark frame with a big kinetic word (CODE) and an
// accent ball that bounces across the full frame on a clear arc (landing on every beat, squashing on contact, a
// ground shadow that shrinks as it rises). Drawn as a pure function of film time `ft` (beats). The heroes stage this
// object: scrubbed with an onion skin, painted call by call, stamped into a filmstrip, blended into one streak. Also
// the four aspect frames (9:16, 4:5, 1:1, 16:9) of the cold open and the closing lockup. Text here is picture
// (drawn with log:false): readable copy never lives inside the film.
export const PERIOD = 8;                               // beats for the ball to cross and come back
export const WORD = 'CODE';
export const ASPECTS = [['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['16:9', 16 / 9]];
export const LAYERS = 5;                               // paint order: fill, word, ground, shadow, ball

/** Ball pose for film time ft (beats): x crosses and returns, y in 0..1 bounces (0 = on the ground, on beats). */
export function pose(ft) {
  return { x: 0.5 + 0.44 * Math.sin((2 * Math.PI * ft) / PERIOD), y: Math.abs(Math.sin(Math.PI * ft)) };
}

/** Geometry of the frame's parts for rect r (shared by drawFilm, the paint flashes, ghosts and streaks). */
export function parts(api, r) {
  const { T, ctx, theme } = api;
  const s = Math.min(r.w, r.h), pad = s * 0.09, br = s * 0.085;
  const ground = r.y + r.h * 0.86;
  const m = T.measure(ctx, theme, 'display', WORD, 100);
  const wordMaxH = Math.max(br, r.h * 0.34 - pad);
  const size = Math.max(4, Math.min((100 * (r.w - 2 * pad)) / m.w, (100 * wordMaxH) / Math.max(1, m.cap)));
  const cap = (m.cap * size) / 100, ww = (m.w * size) / 100;
  const word = { x: r.x + pad, y: r.y + pad, w: ww, h: cap, size, base: r.y + pad + cap };
  const rest = ground - br, apex = Math.min(rest - r.h * 0.12, word.y + cap + br * 1.7);
  const ballAt = (ft) => {
    const p = pose(ft), sq = Math.max(0, 1 - p.y * 8) * 0.2;    // squash in the last eighth of the fall
    const sx = 1 + sq, sy = 1 - sq * 0.9;
    return { x: r.x + pad + br + (r.w - 2 * pad - 2 * br) * p.x, y: ground - br * sy - p.y * (rest - apex), sx, sy, h: p.y };
  };
  const shadowAt = (ft) => {
    const b = ballAt(ft), w = br * 2.2 * (1 - 0.55 * b.h), h = Math.max(2, br * 0.32 * (1 - 0.4 * b.h));
    return { x: b.x - w / 2, y: ground - h * 0.35, w, h };
  };
  return { pad, br, ground, word, ballAt, shadowAt, line: { x: r.x + pad * 0.5, y: ground, w: r.w - pad, h: Math.max(2, r.h * 0.012) } };
}

export const ghostInk = (api, k) => api.theme.mix('accent', 'fg', 0.3 + 0.18 * k);

function ball(api, b, br, color) {
  const { ctx, D } = api;
  ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.sx, b.sy);
  D.disc(ctx, 0, 0, br, color);
  ctx.restore();
}

/**
 * drawFilm(api, r, ft, o): the shot at film time ft. o.layers[i] (0..1) reveals each paint layer (fill, word and
 * ground wipe left to right; shadow and ball scale in); omitted = fully painted. o.ball:false hides the ball (blend
 * draws its own streak). o.ghosts: film times drawn as dimmed onion-skin balls under the live ball.
 */
export function drawFilm(api, r, ft, o = {}) {
  const { ctx, D, M, T, theme } = api;
  if (r.w < 2 || r.h < 2) return;
  const Ly = o.layers || Array(LAYERS).fill(1), rad = Math.min(theme.radius * 0.7, r.h * 0.08);
  const g = parts(api, r);
  const wipe = (p, fn) => {
    if (p <= 0) return;
    if (p >= 1) { fn(); return; }
    D.withClip(ctx, (c) => c.rect(r.x - 1, r.y - 1, (r.w + 2) * p, r.h + 2), fn);
  };
  wipe(Ly[0], () => D.fillBox(ctx, r, 'fg', rad));
  wipe(Ly[1], () => T.drawText(ctx, theme, WORD, g.word.x, g.word.base, { role: 'display', size: g.word.size, color: 'bg', log: false }));
  wipe(Ly[2], () => D.fillBox(ctx, g.line, theme.mix('fg', 'bg', 0.4)));
  const sh = M.clamp(Ly[3], 0, 1.1);
  if (sh > 0 && o.ball !== false) {
    const s = g.shadowAt(ft), [cx, cy] = [s.x + s.w / 2, s.y + s.h / 2];
    D.fillBox(ctx, { x: cx - (s.w * sh) / 2, y: cy - (s.h * sh) / 2, w: s.w * sh, h: s.h * sh }, theme.mix('fg', 'bg', 0.22), (s.h * sh) / 2);
  }
  (o.ghosts || []).forEach((gt, k, all) => ball(api, g.ballAt(gt), g.br, ghostInk(api, all.length - 1 - k)));
  if (o.ball !== false && Ly[4] > 0) ball(api, g.ballAt(ft), g.br * M.clamp(Ly[4], 0, 1.1), 'accent');
}

/** Box of paint layer i at film time ft (the paint hero flashes it in the accent as the call lands). */
export function layerBox(api, r, i, ft) {
  const g = parts(api, r), b = g.ballAt(ft), o = g.br * 0.35;
  if (i === 0) return r;
  if (i === 1) return { x: g.word.x - o, y: g.word.y - o, w: g.word.w + 2 * o, h: g.word.h + 2 * o };
  if (i === 2) return { x: g.line.x, y: g.line.y - o, w: g.line.w, h: g.line.h + 2 * o };
  if (i === 3) { const s = g.shadowAt(ft); return { x: s.x - o, y: s.y - o, w: s.w + 2 * o, h: s.h + 2 * o }; }
  return { x: b.x - g.br * b.sx - o, y: b.y - g.br * b.sy - o, w: 2 * g.br * b.sx + 2 * o, h: 2 * g.br * b.sy + 2 * o };
}

/**
 * Motion blur as tmix makes it: four sub-frame copies of the ball along its arc ft0..ft1, dimmer the older they are,
 * merging (p 0..1) into one streak that follows the arc. p = 0: four separate copies; p = 1: one continuous streak.
 */
export function drawStreak(api, r, ft0, ft1, p = 1) {
  const { D, theme } = api, g = parts(api, r);
  const at = (k) => g.ballAt(ft0 + (ft1 - ft0) * k);
  if (p > 0) {
    const pts = Array.from({ length: 17 }, (_, i) => { const b = at(i / 16); return [b.x, b.y]; });
    D.line(api.ctx, pts, { color: theme.mix('accent', 'fg', 0.45), width: 2 * g.br * (0.35 + 0.6 * Math.min(1, p)), cap: 'round' });
  }
  [0, 1 / 3, 2 / 3, 1].forEach((k, j) => ball(api, at(k), g.br, j === 3 ? 'accent' : ghostInk(api, 2 - j)));
}

/** Waveform bars in box b (seeded heights, deterministic). rise 0..1 grows the bars from the centre line. */
export function drawWave(api, b, rise, color = 'fg', seed = 11) {
  const { ctx, D, N } = api;
  const n = Math.max(12, Math.round(b.w / (b.h * 0.22))), pitch = b.w / n, w = pitch * 0.55;
  for (let i = 0; i < n; i++) {
    const env = Math.sin(Math.PI * (i + 0.5) / n) ** 0.6;
    const h = b.h * (0.18 + 0.82 * N.noise1(seed, i * 0.37) * env) * rise;
    if (h > 1) D.fillBox(ctx, { x: b.x + i * pitch + (pitch - w) / 2, y: b.y + (b.h - h) / 2, w, h }, color, w / 2);
  }
}

/**
 * Lay the four aspect frames out inside box. Landscape: one row. Tall and square frames: 9:16 tall on the left,
 * spanning the full height, with 4:5, 1:1 and 16:9 stacked in the right column, so the grid fills the box instead of
 * two short rows. Each frame gets a label slot of height lab under it. Returns [{label, ratio, r, lab}] (ASPECTS order).
 */
export function arrangeFormats(box, { gap, lab, orient }) {
  const out = [];
  if (orient === 'h') {
    const rs = ASPECTS.map((a) => a[1]), sum = rs.reduce((a, b) => a + b, 0);
    const h = Math.min((box.w - gap * 3) / sum, box.h - lab);
    let x = box.x + (box.w - (h * sum + gap * 3)) / 2;
    const y = box.y + (box.h - h - lab) / 2;
    ASPECTS.forEach(([label, ratio]) => { const w = h * ratio; out.push({ label, ratio, r: { x, y, w, h }, lab: { x, y: y + h, w, h: lab } }); x += w + gap; });
    return out;
  }
  const kL = 16 / 9, kR = 5 / 4 + 1 + 9 / 16;           // height per width: left column, right column (3 frames)
  // left height + its label == right column height (3 frames + 2 gaps + 3 labels), widths sum to box.w
  let w2 = ((box.w - gap) * kL - 2 * gap - 2 * lab) / (kL + kR), w1 = box.w - gap - w2;
  const natH = w1 * kL + lab, s = Math.min(1, box.h / natH);
  w1 *= s; w2 *= s;
  const g = gap * s, H = w1 * kL + lab, x0 = box.x + (box.w - (w1 + g + w2)) / 2, y0 = box.y + (box.h - H) / 2;
  out[0] = { label: ASPECTS[0][0], ratio: ASPECTS[0][1], r: { x: x0, y: y0, w: w1, h: w1 * kL }, lab: { x: x0, y: y0 + w1 * kL, w: w1, h: lab } };
  const rh = [5 / 4, 1, 9 / 16].map((k) => w2 * k), slack = H - (rh.reduce((a, b) => a + b, 0) + 3 * lab);
  let y = y0, x = x0 + w1 + g;
  [1, 2, 3].forEach((i, j) => {
    out[i] = { label: ASPECTS[i][0], ratio: ASPECTS[i][1], r: { x, y, w: w2, h: rh[j] }, lab: { x, y: y + rh[j], w: w2, h: lab } };
    y += rh[j] + lab + slack / 2;
  });
  return out;
}

/** Union of the frame rects (no labels): the one big frame the cold open splits into the four. */
export const unionOf = (tiles) => {
  const x0 = Math.min(...tiles.map((t) => t.r.x)), y0 = Math.min(...tiles.map((t) => t.r.y));
  const x1 = Math.max(...tiles.map((t) => t.r.x + t.r.w)), y1 = Math.max(...tiles.map((t) => t.r.y + t.r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
