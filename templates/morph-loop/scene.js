// morph-loop: one container that never cuts. It morphs size, radius and fill through 3-12 UI states
// (content.states), a cursor drives each change, and the film is exactly periodic: every spring is summed over the
// previous cycle too, so frame T equals frame 0 with position AND velocity matched (container, cursor, captions).
//
// Per-format composition: 9:16 / 4:5 / 1:1 put the caption in a band under the container (the container is the
// hero, near full width); 16:9 sets the caption as a 1-3 line column that alternates sides with every caption,
// and the container takes the other ~58% of the width, so the morph travels across the frame.
// Change mechanics (`via`): push (outgoing content slides out as the next slides in), lift (the container closes
// on the selected row, which then becomes the next state), dot (collapse to a dot, then grow), cut (the container
// morph alone carries the change) and blur (a short downsampled blur swap). A `full` kind (logo) blooms past the
// frame edges as the lockup, then snaps back into state 0.
import { KINDS, UI, TYPE } from './kinds.js';
import { inkOn } from './ink.js';

const CURSOR = [0.26, 0.98];
/** Width target per kind, as a fraction of the stage width (the height cap still applies). */
const FIT = { button: 0.8, field: 1, loader: 0.5, success: 0.54, card: 1, chart: 1, tooltip: 1, menu: 1, notification: 1, logo: 1 };
/** Kinds whose content is one line that must read in full (toast title, typed value): never boosted. */
const NOBOOST = new Set(['notification', 'field']);
/** Minimum rest height of the thin states, as a fraction of the frame height. */
const MINH = { v: { button: 0.15, field: 0.2, notification: 0.11 }, s: { button: 0.2, field: 0.26, notification: 0.17 }, h: { button: 0.25, field: 0.3, notification: 0.22 } };
/** Default change mechanic, by the kind being entered. A `lift` from a state without a lift rect falls back to push. */
const VIA = { card: 'push', chart: 'push', tooltip: 'cut', menu: 'lift', notification: 'lift', button: 'lift', field: 'push', loader: 'cut', success: 'cut', logo: 'cut' };
const LEAD = 1;     // t=0 sits LEAD beats into state 0: crisp, mid-motion, never on a swap
const PRE = 0.5;    // beats: lift/dot close in this long before the change beat (the click lands here)
const SWAP = 0.05;  // s: content swap after the change (blur / cut / dot)

/** Balanced k-line break (no orphan): the word split that minimises the widest line. */
function balance(T, ctx, theme, str, k) {
  const w = String(str).split(/\s+/).filter(Boolean), K = Math.min(k, w.length);
  if (K < 2) return w.join(' ');
  const width = (a, b) => T.measure(ctx, theme, 'display', w.slice(a, b).join(' '), 100).w;
  let best = null;
  const rec = (start, left, cuts) => {
    if (left === 1) {
      const all = [...cuts, w.length], m = Math.max(...all.map((e, i) => width(i ? all[i - 1] : 0, e)));
      if (!best || m < best[0]) best = [m, all];
      return;
    }
    for (let c = start + 1; c <= w.length - left + 1; c++) rec(c, left - 1, [...cuts, c]);
  };
  rec(0, K, []);
  return best[1].map((e, i) => w.slice(i ? best[1][i - 1] : 0, e).join(' ')).join('\n');
}

/** Largest-remainder rounding of weights to integer beats summing to total, each >= 2. */
function quantize(weights, total) {
  const W = weights.reduce((a, b) => a + b, 0), ideal = weights.map((w) => Math.max(2, (w * total) / W));
  const q = ideal.map(Math.floor);
  let left = total - q.reduce((a, b) => a + b, 0);
  const order = ideal.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) q[order[k % order.length][1]]++;
  for (let k = order.length - 1; left < 0; k--) { const i = order[(k + order.length) % order.length][1]; if (q[i] > 2) { q[i]--; left++; } }
  return q;
}

const luma = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export default {
  id: 'morph-loop',
  build(api) {
    const { F, data, theme, grid, ctx, M, L, T, D, K, project } = api;
    const brandName = (project.brand && project.brand.name) || project.title;
    const H = F.orient === 'h';
    const U = T.readable(F), S0 = U * F.pick({ v: 2.0, s: 1.7, h: 1.9 });
    const onOf = (key) => (Math.abs(luma(theme.colors[key]) - luma(theme.colors.fg)) > Math.abs(luma(theme.colors[key]) - luma(theme.colors.bg)) ? 'fg' : 'bg');

    // ---- states: validate per kind, inherit chart data into tooltips ----
    let lastChart = null;
    const states = data.states.map((s0, i) => {
      const kd = KINDS[s0.kind];
      const s = kd.inherit === 'chart' && !s0.data && lastChart ? { ...lastChart, ...s0, data: lastChart.data, kind: s0.kind } : s0;
      if (s.kind === 'chart') lastChart = s;
      for (const k of kd.need) if (s[k] === undefined) throw new Error(`content.states[${i}].${k}: required for kind "${s.kind}"`);
      if (s.data && s.data.length < 2) throw new Error(`content.states[${i}].data: needs at least 2 points`);
      return s;
    });
    const n = states.length, prv = (i) => (i + n - 1) % n;
    const full = states.map((s) => !!KINDS[s.kind].full);
    if (full.every(Boolean)) throw new Error('content.states: at least one state must not be a full-bleed logo');

    // ---- captions: a full-bleed state hides the caption (its own caption becomes the lockup tagline) ----
    const capFrom = states.map((_, i) => {
      if (full[i]) return -1;
      for (let k = 0; k < n; k++) { const j = (i - k + n) % n; if (!full[j] && states[j].caption) return j; }
      return -1;
    });
    const capOf = capFrom.map((j) => (j < 0 ? '' : states[j].caption));
    const setters = [...new Set(capFrom.filter((j) => j >= 0))].sort((a, b) => a - b);
    const BAND = !H && F.aspect > 0.7;   // 4:5 and 1:1 (9:16 keeps one subtitle band at the bottom)
    const ALT = H || BAND;   // 16:9: caption column L (0) / R (1); 4:5 / 1:1: caption band bottom (0) / top (1)
    const sideOf = capFrom.map((j) => (ALT && j >= 0 ? setters.indexOf(j) % 2 : 0));

    // ---- layout per orientation ----
    const hasCap = setters.length > 0;
    let stages, capBoxes;
    if (!hasCap) { stages = [F.safe, F.safe]; capBoxes = [null, null]; }
    else if (H) {
      const gx = 0.04 * F.safe.w, cw = 0.38 * F.safe.w, sw = F.safe.w - cw - gx, s = F.safe;
      capBoxes = [{ x: s.x, y: s.y, w: cw, h: s.h, align: 'c' }, { x: s.x + s.w - cw, y: s.y, w: cw, h: s.h, align: 'c' }];
      stages = [{ x: s.x + cw + gx, y: s.y, w: sw, h: s.h }, { x: s.x, y: s.y, w: sw, h: s.h }];
    } else if (!BAND) {
      // 9:16: the caption is a subtitle block sitting on the bottom of the safe area; the container centres above it
      const [st, cb] = L.split(F.safe, [0.76, 0.24], { axis: 'y', gap: 0.03 * F.safe.h });
      stages = [st, st]; capBoxes = [{ ...cb, align: 'b' }, { ...cb, align: 'b' }];
    } else {
      // 4:5 / 1:1: the caption band alternates bottom / top with every caption, so the frame rebalances on each morph
      const g = { axis: 'y', gap: 0.03 * F.safe.h }, [st, cb] = L.split(F.safe, F.pick({ v: [0.73, 0.27], s: [0.71, 0.29] }), g), [cb2, st2] = L.split(F.safe, F.pick({ v: [0.27, 0.73], s: [0.29, 0.71] }), g);
      stages = [st, st2]; capBoxes = [{ ...cb, align: 'b' }, { ...cb2, align: 't' }];
    }
    const stageOf = (i) => stages[sideOf[i]];

    // Every state is fitted to its stage on its own UI scale S_i. Width target = FIT[kind] of the stage, height capped.
    const mkG = (S, maxW, md, stage) => ({ F, U: Math.max(U, S * 0.78), S, T, ctx, theme, stage, brandName, maxW, minD: md });
    const minH = MINH[F.orient] || {};
    const fitS = (s, stage) => {
      const fillW = stage.w * F.pick({ v: 1, s: 0.96, h: 0.98 }), capH = stage.h * F.pick({ v: 0.86, s: 0.84, h: 0.8 });
      const minD = Math.min(capH / 1.08, F.pick({ v: 0.56 * F.w, s: 0.6 * stage.h, h: 0.62 * stage.h }));
      const tw = Math.min(stage.w * (FIT[s.kind] || 0.86), fillW), G = (S, mw, md = minD) => mkG(S, mw, md, stage);
      let Sx = S0;
      for (let k = 0; k < 6; k++) { const g = KINDS[s.kind].geom(G(Sx, Infinity, 0), s); Sx = M.clamp(Sx * Math.min(tw / g.w, capH / g.h), S0, S0 * 4); }
      const Sb = NOBOOST.has(s.kind) ? S0 : S0 * F.pick({ v: 1.3, s: 1.15, h: 1.25 }), gb = KINDS[s.kind].geom(G(Sb, tw), s);
      let Si = Math.max(Sx, gb.h <= capH ? Sb : Math.max(S0, Sb * capH / gb.h));
      const mh = Math.min(capH, (minH[s.kind] || 0) * F.h);
      for (let k = 0; k < 3 && mh; k++) { const g = KINDS[s.kind].geom(G(Si, tw), s); if (g.h >= mh - 0.5) break; Si *= mh / g.h; }
      return { S: Si, tw, fillW, minD, stage };
    };
    // chart -> tooltip share one box: a tooltip reuses the chart's fit
    const fits = [];
    states.forEach((s, i) => {
      if (full[i]) fits.push({ S: S0, tw: F.w, fillW: Infinity, minD: 0, stage: F.full });
      else fits.push(KINDS[s.kind].inherit && i && states[i - 1].kind === KINDS[s.kind].inherit && sideOf[i] === sideOf[i - 1] ? fits[i - 1] : fitS(s, stageOf(i)));
    });
    /** Centred in its stage; an explicit anchor moves it (16:9 uses only the horizontal part). */
    const placeBox = (s, stage, w, h, dock) => {
      if (!s.anchor && dock === 'n' && !H) return { x: stage.x + (stage.w - w) / 2, y: F.safe.y, w, h };   // docked: top of the safe area
      const a = s.anchor || 'c', base = L.place(stage, { w, h }, a.replace(/[ns]/, '') || 'c');
      if (H || !/[ns]/.test(a)) return { ...base, y: stage.y + (stage.h - h) / 2 };
      return { ...base, y: M.clamp(L.place(stage, { w, h }, a).y, stage.y, stage.y + stage.h - h) };
    };
    const rest = states.map((s, i) => {
      const f = fits[i], Gi = mkG(f.S, f.tw, f.minD, f.stage);
      const g = KINDS[s.kind].geom(Gi, s), fill = s.fill || g.fill;
      const w = full[i] ? g.w : Math.min(g.w, f.fillW), h = full[i] ? g.h : Math.min(g.h, f.stage.h);
      const box = full[i] ? { x: (F.w - w) / 2, y: (F.h - h) / 2, w, h } : placeBox(s, f.stage, w, h, g.dock);
      return { ...g, w, h, box, fill, S: f.S, UT: Gi.U, G: Gi, r: Math.min(g.r, w / 2, h / 2), rgb: rgbOf(theme.colors[fill]) };
    });

    // ---- change mechanics ----
    const via = states.map((s, i) => {
      const p = prv(i), v = s.via || (KINDS[s.kind].inherit && states[p].kind === KINDS[s.kind].inherit ? 'cut' : VIA[s.kind] || 'blur');
      const canLift = !!KINDS[states[p].kind].lift && !!KINDS[states[p].kind].lift(rest[p].box, states[p], rest[p].G);
      if (v === 'lift') return canLift ? 'lift' : 'push';
      if (full[p] && v !== 'cut' && v !== 'blur') return 'push';           // the lockup snaps back: content pushes through
      return v;
    });
    const pre = via.map((v) => (v === 'lift' || v === 'dot' ? PRE : 0));   // beats the close-in starts before the change

    // ---- timeline: integer beats per state; t=0 is LEAD beats into state 0 ----
    const total = grid.totalBeats;
    if (total < 2 * n + 1) throw new Error(`timeline: ${n} states need at least ${2 * n + 1} beats; the project has ${total} (raise duration)`);
    const q = quantize(states.map((s) => s.beats || KINDS[s.kind].beats || 4), total);
    const startB = q.reduce((a, v, i) => (i ? a.concat(a[i - 1] + q[i - 1]) : a), [0]);
    const lead = Math.min(LEAD, q[0] - 1), at = (b) => M.mod(b, total);
    const chB = startB.map((b) => at(b - lead));
    const sec = (b) => grid.beat(at(b)), Tdur = grid.beat(total), ch = chB.map(sec), spb = grid.spb;
    const byT = (a, b) => a[0] - b[0];
    const near = (t, c) => c + M.mod(t - c + Tdur / 2, Tdur) - Tdur / 2;   // t moved to the copy nearest c
    const vecOf = (b, r, rgb) => [b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, r, ...rgb];
    const PUNCH = { x: -0.07 * F.w, y: -0.07 * F.h, w: 1.14 * F.w, h: 1.14 * F.h };
    /** Punch progress of state i for a container width w: 0 at rest, 1 full-bleed. */
    const zpOf = (i, w) => (KINDS[states[i].kind].punch ? M.clamp((w - rest[i].w) / (PUNCH.w - rest[i].w), 0, 1) : 0);
    const boxKeys = [];
    states.forEach((s, i) => {
      const r = rest[i], p = prv(i), rp = rest[p];
      if (via[i] === 'lift') {   // close on the selected row of the previous state (keeps its fill), then become state i
        const lb = KINDS[states[p].kind].lift(rp.box, states[p], rp.G);
        const lf = lb.fill === 'on' ? onOf(rp.fill) : lb.fill;
        boxKeys.push([sec(chB[i] - pre[i]), vecOf(lb, lb.r, lf ? rgbOf(theme.colors[lf]) : rp.rgb)]);
      } else if (via[i] === 'dot') {   // collapse to a dot in the next fill, then grow into state i
        const d = Math.max(0.9 * rp.S, 0.05 * Math.min(F.w, F.h)), [cx, cy] = L.center(rp.box);
        boxKeys.push([sec(chB[i] - pre[i]), vecOf({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, d / 2, r.rgb)]);
      }
      boxKeys.push([ch[i], vecOf(r.box, r.r, r.rgb)]);
      const pu = KINDS[s.kind].punch;   // the punch-in: a full-bleed bloom of the state's own fill
      if (pu && pu.at < q[i] - 0.5) boxKeys.push([sec(chB[i] + pu.at), vecOf(PUNCH, 0, r.rgb)]);
    });
    boxKeys.sort(byT);

    // ---- cursor: park clear of the content, tap in-state actions, arrive at the hotspot before leaving ----
    const cur = 64 * F.u * 1.15;
    const lim = (p) => [M.clamp(p[0], F.safe.x, F.safe.x + F.safe.w - 1.2 * cur), M.clamp(p[1], F.safe.y, F.safe.y + F.safe.h - 1.2 * cur)];
    const hot = states.map((s, i) => KINDS[s.kind].hot(rest[i].box, s, rest[i].G));
    const trig = states.map((s) => { const t = KINDS[s.kind].trigger; return s.trigger || (typeof t === 'function' ? t(s) : t); });
    const parkOf = states.map((s, i) => {
      const b = rest[i].box, kd = KINDS[s.kind], S = rest[i].S;
      if (kd.park) return lim(kd.park(b, s, rest[i].G, cur, 0));
      // hover just off the hotspot: the cursor is always lined up on what it is about to change
      return lim([hot[i][0] + 0.9 * cur, hot[i][1] + 0.7 * cur]);
    });
    const tapsOf = states.map((s, i) => (KINDS[s.kind].taps ? KINDS[s.kind].taps(s, q[i]) : []).filter((tb) => tb >= 0.9 && tb <= q[i] - 0.9));
    const curKeys = [], clicks = [];
    states.forEach((s, i) => {
      const b0 = chB[i], nb = q[i], out = nb - pre[(i + 1) % n];   // the click that leaves lands `pre` before the next change
      const leave = trig[i] !== 'auto' ? Math.max(0.35, out - 0.9) : Infinity, key = (lb, p) => curKeys.push([sec(b0 + lb), p]);
      if (KINDS[s.kind].glide && !tapsOf[i].length && leave < Infinity) {
        const ph = hot[prv(i)], mix = (u, dy) => lim([ph[0] + (hot[i][0] - ph[0]) * u, ph[1] + (hot[i][1] - ph[1]) * u + dy]);
        key(0.3, mix(0.4, 0.5 * cur)); key((0.3 + leave) / 2, mix(0.85, 0.25 * cur));
      } else if (!tapsOf[i].length && KINDS[s.kind].parkSteps) {
        const G = rest[i].G;
        KINDS[s.kind].parkSteps(s).forEach((sb, k) => key(sb, lim(KINDS[s.kind].park(rest[i].box, s, G, cur, k))));
      } else if (!tapsOf[i].length) key(0.4, parkOf[i]);
      else {
        key(0.4, tapsOf[i][0] - 0.45 > 0.5 ? parkOf[i] : hot[i]);
        tapsOf[i].forEach((tb, k) => {
          key(tb - 0.45, hot[i]); clicks.push(sec(b0 + tb));
          // `exit`: after the last tap the cursor leaves the frame (down-right) until the next state needs it
          if (KINDS[s.kind].exit && k === tapsOf[i].length - 1) key(tb + 0.7, [F.w + 2 * cur, Math.min(F.h + 2 * cur, hot[i][1] + 0.35 * F.h)]);
          else if (tb + 0.5 < Math.min(leave, nb) - 0.3) key(tb + 0.5, parkOf[i]);
        });
      }
      if (leave < Infinity) key(leave, hot[i]);
      if (trig[i] === 'click') clicks.push(sec(b0 + out));
    });
    curKeys.sort(byT);

    // ---- events and sfx (beats, content-derived: identical in every format) ----
    const events = [], sfx = [];
    states.forEach((s, i) => {
      const kd = KINDS[s.kind], b0 = chB[i], p = prv(i), nb = q[i];
      events.push(b0, ...(kd.events ? kd.events(s, nb) : []).filter((e) => e < nb).map((e) => at(b0 + e)));
      if (pre[i]) events.push(at(b0 - pre[i]));
      const hit = at(b0 - pre[i]);
      if (trig[p] === 'click') sfx.push({ at: hit, sfx: 'click', gain_db: -6 });
      if (trig[p] === 'hover') sfx.push({ at: b0, sfx: 'tick', gain_db: -10 });
      if (full[p]) sfx.push({ at: b0, sfx: 'thump', gain_db: -4 });                     // the snap back from the lockup
      if (kd.big && via[i] !== 'cut') sfx.push({ at: b0, sfx: 'swish', gain_db: -14 });
      for (const tb of tapsOf[i]) { events.push(at(b0 + tb)); sfx.push({ at: at(b0 + tb), sfx: 'click', gain_db: -6 }); }
      for (const m of kd.sfx ? kd.sfx(s, nb) : []) if (m.at < nb) sfx.push({ ...m, at: at(b0 + m.at) });
    });
    events.sort((a, b) => a - b);
    sfx.sort((a, b) => a.at - b.at);

    // ---- captions: one shared size per format; 2 balanced lines (v/s), up to 3 in the 16:9 column ----
    let capFit = null;
    if (hasCap) {
      const caps = [...new Set(setters.map((j) => states[j].caption))];
      const text = Object.fromEntries(caps.map((c) => [c, balance(T, ctx, theme, c, H ? 3 : 2)]));
      const boxOfCap = (c) => capBoxes[sideOf[capFrom.findIndex((j) => j >= 0 && states[j].caption === c)]];
      const fitCap = (c, box, max, min) => T.fitText(ctx, theme, text[c], { role: 'display', box, lines: 1, max, min, leading: 0.96, valign: 't' });
      const size = Math.min(...caps.map((c) => fitCap(c, boxOfCap(c), F.pick({ v: U * 2.6, s: U * 2.4, h: U * 3.6 }), T.readable(F, 1.1)).size));
      capFit = {};
      for (const c of caps) {
        const box = boxOfCap(c), bh = fitCap(c, box, size, size).box.h + 1;
        const slot = { x: box.x, w: box.w, h: bh, y: box.align === 'c' ? box.y + (box.h - bh) / 2 : box.align === 'b' ? box.y + box.h - bh : box.y };
        capFit[c] = fitCap(c, slot, size, size);
      }
    }

    const stateAt = (t, shift = 0) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = M.mod(t - ch[i] - shift, Tdur); if (d < bd) { bd = d; bi = i; } }
      return [bi, M.mod(t - ch[bi], Tdur)];
    };

    // secondary text: as far toward the fill as WCAG AA allows (with an anti-aliasing margin), never past 45%
    const muteOf = (on, fill, size) => {
      // muted copy also appears at body size (labels, placeholders), so it always clears the 4.5:1 body-text bar
      const bg = T.paint(theme, fill), need = Math.max(T.contrastNeed(size, F.u), 4.5) + 0.3;
      for (let p = 0.45; p > 0; p -= 0.05) { const c = theme.mix(on, fill, p); if (T.contrastRatio(c, bg) >= need) return c; }
      return on;
    };
    function content(target, i, lt, cx, cy, log, zp = 0) {
      const s = states[i], r = rest[i], on = onOf(r.fill), mark = r.fill === 'accent' ? on : 'accent';
      const b = { x: cx - r.w / 2, y: cy - r.h / 2, w: r.w, h: r.h };
      KINDS[s.kind].draw({ ctx: target, cur, theme, F, U: r.UT, S: r.S, M, T, D, s, b, g: r, lt, spb, nb: q[i], on, mark, onOf, log, brandName, zp,
        mute: muteOf(on, r.fill, r.UT), faint: theme.mix(on, r.fill, 0.86), ink: (key, bgKey, size) => inkOn(api, key, bgKey, size) });
    }

    function drawCaption(t) {
      const [i, lt] = stateAt(t), cNow = capOf[i], cPrev = capOf[prv(i)], same = cPrev === cNow;
      const clipOf = (fit) => {
        const top = fit.lines[0].y - fit.cap - fit.size * 0.3, bot = fit.lines[fit.lines.length - 1].y + fit.size * 0.3;
        return { x: fit.box.x - fit.size * 0.2, y: top, w: fit.box.w + fit.size * 0.4, h: bot - top };
      };
      const roll = (fit, dy, log) => {
        const c = clipOf(fit);
        D.withClip(ctx, (x) => x.rect(c.x, c.y, c.w, c.h), () => fit.lines.forEach((l, k) => {
          const d = typeof dy === 'function' ? dy(k, c.h) : dy;
          T.drawText(ctx, theme, l.s, l.x, l.y + d, { role: 'display', size: fit.size, color: 'fg', log: false });
          if (log) T.logText(ctx, l.s, { x: l.x, y: l.y - fit.cap, w: l.w, h: fit.cap }, fit.size, 'display');
        }));
      };
      const p = same ? 1 : M.clamp(M.sp(lt, TYPE), 0, 1);
      if (!same && p < 1 && capFit[cPrev]) roll(capFit[cPrev], -clipOf(capFit[cPrev]).h * p, false);
      if (capFit[cNow]) roll(capFit[cNow], same ? 0 : (k, h) => h * (1 - M.clamp(M.sp(lt - k * 0.06, TYPE), 0, 1)), true);
    }

    const morph = {
      id: 'morph', beats: total, events, sfx,
      draw(f) {
        const t = f.t;
        if (capFit) drawCaption(t);   // under the container: the lockup bloom covers it
        const [cx, cy, w, h, r, R, Gc, B] = M.loopSeqv(t, Tdur, boxKeys, UI);
        let press = 0;
        for (const c of clicks) press = Math.max(press, M.pulse(near(t, c), c, 0.1, 'snap'));
        press = M.clamp(press, 0, 1);
        const k = 1 - 0.06 * press, box = { x: cx - (w * k) / 2, y: cy - (h * k) / 2, w: w * k, h: h * k };
        const rr = Math.max(0, Math.min(r * k, box.w / 2, box.h / 2));
        const fill = `rgb(${[R, Gc, B].map((v) => Math.round(M.clamp(v, 0, 255))).join(',')})`;
        D.fillBox(ctx, box, fill, rr);

        const [ci, lc] = stateAt(t), pi = prv(ci);
        const clip = (fn) => D.withClip(ctx, (c) => { D.rrect(c, box, rr); }, fn);
        // the next change's close-in (lift / dot): the outgoing content stays, a dot hides it
        const ni = (ci + 1) % n, tc = near(t, ch[ni]) - pre[ni] * spb;
        if (pre[ni] > 0 && via[ni] === 'dot' && t > tc && t < tc + pre[ni] * spb && box.w < 0.45 * rest[ci].w) return drawCursorAt(t, press);
        if (via[ci] === 'push' && lc < 0.6) {
          const e = M.clamp(M.sp(lc, TYPE), 0, 1), dist = full[pi] ? F.h : box.h * 1.02, lp = M.mod(t - ch[pi], Tdur);
          clip(() => { content(ctx, pi, lp, cx, cy - dist * e, false, zpOf(pi, w)); content(ctx, ci, lc, cx, cy + dist * (1 - e), e > 0.999); });
        } else if (via[ci] === 'blur' && lc < 0.4) {
          const blur = M.clamp(M.pulse(lc, -0.06, 0.16, 'snap'), 0, 1), [si, lt] = stateAt(t, SWAP);
          clip(() => D.blurred(ctx, F, blur < 0.03 ? 0 : (blur * 11) / 15, (c) => content(c, si, lt, cx, cy, c === ctx)));
        } else if (via[ci] === 'dot' && lc < SWAP) {
          // still a dot: nothing inside yet
        } else {
          const [si, lt] = stateAt(t, via[ci] === 'push' ? 0 : SWAP);
          // lift close-in: the outgoing content stays put while the container closes on the selected row
          const nx = (si + 1) % n, tl = near(t, ch[nx]);
          const lifting = via[nx] === 'lift' && t > tl - pre[nx] * spb && t < tl + SWAP + 1e-6;
          const [ax, ay] = lifting ? L.center(rest[si].box) : [cx, cy];
          clip(() => content(ctx, si, lt, ax, ay, !lifting, zpOf(si, w)));
        }
        drawCursorAt(t, press);
      },
    };
    function drawCursorAt(t, press) {
      const [x, y] = M.loopSeqv(t, Tdur, curKeys, CURSOR);
      K.drawCursor(ctx, theme, { x, y, press, visible: true, enter: 1 }, cur / 64);
    }
    // poster: the first hero moment (a punch-in at full bleed, else the lockup's wordmark), never a loader or a change
    const hero = states.findIndex((s, i) => KINDS[s.kind].punch && KINDS[s.kind].punch.at < q[i] - 0.5);
    const lk = full.indexOf(true);
    const poster = hero >= 0 ? at(chB[hero] + KINDS[states[hero].kind].punch.at + Math.min(0.8, (q[hero] - KINDS[states[hero].kind].punch.at) / 2))
      : lk >= 0 ? at(chB[lk] + Math.min(1.6, q[lk] - 0.4)) : at(chB[0] + Math.min(1.5, q[0] - 0.4));
    {
      const [pi2, pl] = stateAt(grid.beat(poster)), dl = pl / spb, nxt = q[pi2] - dl;
      if (['loader', 'success'].includes(states[pi2].kind) || dl < 0.6 || nxt < 0.6) api.warn(`morph-loop: poster at beat ${poster} lands on a ${states[pi2].kind} / change, not a hero frame`);
    }
    return { scenes: [morph], persistent: [], loop: true, poster };
  },
};
