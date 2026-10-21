// logo-sting: a 2-5 s logo reveal / bumper with an audio logo, and an optional end card (CTA + URL).
// Sting: frame 0 is the hook, already moving: the whole frame is the accent and the name is set as a band that
// overscans it (16x9: one line, both ends cropped, panning left ~8% of the width per beat; tall and square: one word
// per line, drifting up). On L/4 the words split apart (a kinetic offset). From L/2 the crop window closes in two
// moves: first its vertical edges sweep in onto the mark's column while the words travel out through them (letters
// leave through the edge they move toward, never sliced through the x-height), then the empty column closes
// vertically onto the plate. Two frames of anticipation (tilt + dip), then the LOCK: the plate is square with the
// mark inside, the name is cut on, the mark pulses and a one-frame accent flood flashes it reversed out.
// ONE LOCKUP GEOMETRY: with an end card, the lock lands directly on the end card's hero lockup (heroGeom in the
// card's lockBox), at its final position and size, and nothing re-lays it out afterwards. After the lock: the
// tagline masks in (L+1), a copy of the plate drops out of the mark into the field's seat (2 beats before the
// card), the full stop drops (last sting beat) and the seat grows into the full field, reaching it exactly on the
// end card's first beat, where the CTA is cut out of it. End card: the URL types on, the CTA is pressed, and on the
// last beat the field floods the frame and leaves the lockup reversed out, on the loudest hit of the film.
// Everything comes from content + brand; one timeline per format.
import { geom, heroGeom, nameLines, plate, markInner, nameReveal, fullStop } from './lockup.js';

const TYPE = [0.36, 0.98];  // critically damped: type never overshoots
const UI = [0.28, 0.75];    // ~2 % overshoot: plate, field
const FLASH_S = 1 / 30;  // the lock flash lasts one 30 fps frame

const lerpBox = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p });
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const covers = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/**
 * The hook band: pieces of the name (wide: one line in two halves; else one balanced part per line), overscanning
 * the frame. Each piece has a resting left edge x, baseline y, width w and a direction (-1 exits left, +1 right).
 */
function hookGeom(api, Tg, wide) {
  const { F, ctx, theme, T } = api;
  const capR = T.measure(ctx, theme, 'display', 'H', 100).cap / 100, lead = 0.92;
  const opts = nameLines(api, api.data.name || (api.project.brand && api.project.brand.name) || api.project.title);
  const split = opts[opts.length - 1];          // the balanced split when the name has 2+ words
  const wOf = (s) => T.measure(ctx, theme, 'display', s, 100).w / 100;
  let pieces, size;
  if (wide) {
    const sp = wOf(' '), tot = split.wu.reduce((a, b) => a + b, 0) + sp * (split.ls.length - 1);
    size = Math.min((F.w * 1.12) / tot, (F.h * 0.62) / capR);
    let x = F.w / 2 - (tot * size) / 2;
    const y = F.h / 2 + (capR * size) / 2;
    pieces = split.ls.map((s, i) => { const p = { s, x, y, w: split.wu[i] * size }; x += (split.wu[i] + sp) * size; return p; });
  } else {
    size = Math.min((F.w * 1.06) / Math.max(...split.wu), (F.h * 0.86) / (capR + (split.ls.length - 1) * lead));
    const blockH = (capR + (split.ls.length - 1) * lead) * size, top = F.h / 2 - blockH / 2;
    pieces = split.ls.map((s, i) => ({ s, x: F.w / 2 - (split.wu[i] * size) / 2, y: top + capR * size + i * lead * size, w: split.wu[i] * size }));
  }
  const n = pieces.length;
  pieces = pieces.map((p, i) => {
    let dir = n === 1 ? 0 : i < n / 2 ? -1 : 1;
    if (n === 1) dir = (p.x + p.w - Tg.x) < (Tg.x + Tg.w - p.x) ? -1 : 1;   // a single word exits the nearer side
    if (n > 1 && n % 2 === 1 && i === (n - 1) / 2) dir = 1;
    return { ...p, dir };
  });
  return { pieces, size, cap: capR * size };
}

/** End-card layout (one per aspect): field (bottom band, every aspect), lockBox, hero lockup, CTA and URL fits. */
function cardLayout(api, data, ec) {
  const { F, ctx, theme, T } = api;
  const S = F.safe, R = (k) => T.readable(F, k), gap = 48 * F.u;
  const fam = F.aspect > 1.2 ? 'wide' : F.aspect < 0.7 ? 'tall' : 'square';
  const capUI = T.measure(ctx, theme, 'ui', 'H', 100, 700).cap / 100;
  const floor = (k) => (k * F.h) / capUI;                       // font size whose cap height is k of the frame height
  const ctaW100 = T.measure(ctx, theme, 'ui', ec.cta, 100, 700).w / 100, arrowK = 0.9;
  const urlW100 = ec.url ? T.measure(ctx, theme, 'ui', ec.url, 100).w / 100 : 0;
  let ctaS, urlS, top, blockH;
  if (fam === 'wide') {
    // a full-width bottom band (28% of the height): CTA on one line at hero UI size, URL on the same baseline, right
    urlS = Math.max(R(1.15), floor(0.026));
    ctaS = Math.max(floor(0.03), Math.min(R(2.4), (S.w - urlW100 * urlS - gap * 2) / (ctaW100 + arrowK)));
    top = Math.round(F.h * 0.72);
    blockH = ctaS * capUI;
  } else {
    urlS = Math.max(R(1.15), floor(0.022));
    ctaS = Math.max(R(1.2), floor(0.025), Math.min(R(fam === 'tall' ? 2.6 : 2.2), S.w / (ctaW100 + arrowK)));
    blockH = ctaS * capUI + ctaS * 0.9 + (ec.url ? urlS * 1.2 : 0);
    top = Math.min(F.h * (fam === 'tall' ? 0.62 : 0.7), S.y + S.h - blockH - ctaS * 1.2);
  }
  const field = { x: 0, y: top, w: F.w, h: F.h - top };
  const lockBox = { x: S.x, y: S.y, w: fam === 'wide' ? S.w * 0.7 : S.w, h: top - gap - S.y };
  const hg = heroGeom(api, data, lockBox, { valign: 't', tagCapK: 0.022 });
  const ctaBase = field.y + (S.y + S.h - field.y - blockH) / 2 + ctaS * capUI;
  const ctaFit = T.fitText(ctx, theme, ec.cta, { role: 'ui', weight: 700, box: { x: S.x, y: ctaBase - ctaS * capUI, w: S.w - (fam === 'wide' ? urlW100 * urlS + gap * 2 : 0), h: ctaS * 1.3 }, max: ctaS, min: R(1), lines: 1, align: 'l' });
  const urlBox = fam === 'wide'
    ? { x: S.x + S.w - urlW100 * urlS - 2, y: ctaBase - urlS * capUI, w: urlW100 * urlS + 2, h: urlS * 1.3 }
    : { x: S.x, y: ctaBase + ctaS * 0.55 + urlS * 1.2 - urlS * capUI, w: S.w, h: urlS * 1.3 };
  const urlFit = ec.url ? T.fitText(ctx, theme, ec.url, { role: 'ui', box: urlBox, max: urlS, min: R(1), lines: 1, align: fam === 'wide' ? 'r' : 'l' }) : null;
  return { fam, field, lockBox, hg, ctaFit, urlFit, capUI };
}

export default {
  id: 'logo-sting',
  build(api) {
    const { F, data, theme, grid, project, ctx, M, T, D } = api;
    if (project.loop) throw new Error('logo-sting: loop:true is not supported (the sting ends on its lockup); set "loop": false');
    const total = grid.totalBeats, spb = grid.spb, ec = data.endCard || null, eb = ec ? ec.beats ?? 4 : 0;
    const sb = total - eb, lock = data.lock ?? 4, q = (b) => M.quant(b);
    if (sb < lock + 2) throw new Error(`logo-sting: the sting has ${sb} beats but needs content.lock (${lock}) + 2${ec ? ` (endCard takes ${eb})` : ''}; set duration to at least ${((lock + 2 + eb) * spb).toFixed(2)} s or lower content.lock`);
    if (sb * spb > 5.05 || sb * spb < 1.95) api.warn(`logo-sting: the sting runs ${(sb * spb).toFixed(2)} s (designed for 2-5 s)`);
    const card = ec ? cardLayout(api, data, ec) : null;
    const g = card ? card.hg : geom(api, data);          // ONE lockup geometry from the lock to the end
    const Tg = g.target, onA = g.onAccent || T.bestOn(theme, theme.colors.accent);
    const a1 = q(lock * 0.25), a2 = q(lock * 0.5), tagAt = lock + 1, last = sb - 1;
    const antic = lock - Math.min(0.125, 2 * FLASH_S / spb); // two frames of anticipation
    const x1 = a2 + (antic - a2) * 0.62;                     // end of the sweep (words gone), start of the vertical close
    const dotAt = g.dot && g.type !== 'none' && last > tagAt ? last : null;
    const kickAt = dotAt === null && last > lock ? last : null;
    const seatAt = card && sb - 2 > tagAt ? sb - 2 : null;   // the plate copy drops into the field's seat
    const wide = F.aspect > 1.2;
    const hook = hookGeom(api, Tg, wide);
    const motif = data.audioLogo === 'motif';
    const NORMAL = { plate: 'accent', mono: onA, name: 'fg', tag: 'fg', dot: 'accent' };
    const REVERSED = { plate: onA, mono: 'accent', name: onA, tag: onA, dot: onA };
    const ON_FIELD = { ...REVERSED, plate: 'accent', mono: onA };   // the sting's field copy keeps the mark as is

    // ---- hook motion (all pure functions of the local beat) ----
    const panK = wide ? 0.08 * F.w : 0.05 * F.h;               // per beat: pan (wide) or upward drift (tall/square)
    const pan = (lb) => panK * (0.5 - lb);           // frame 0 is mid-move: both ends of the band cropped
    const splitK = 0.07 * F.w;
    const splitAt = (s) => M.clamp(M.sp(s, UI), 0, 1.03) * splitK;
    // exit distance per piece so its inner edge clears the closed column by a margin at the end of the sweep
    const m = hook.cap * 0.15, panX1 = wide ? pan(x1) : 0;
    const need = hook.pieces.map((p) => {
      const at = p.x + panX1 + p.dir * splitK;
      return p.dir < 0 ? Math.max(0, at + p.w - Tg.x + m) : p.dir > 0 ? Math.max(0, Tg.x + Tg.w + m - at) : 0;
    });

    // ---- the audio logo (identical in every format: derived from content beats only) ----
    const stingSfx = [
      ...(motif
        ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75].map((b, i) => ({ at: q((b * (lock - 0.5)) / 4), sfx: 'tick', gain_db: -16 + i }))
        // the riser is exposed and ends half a beat before the lock: the gap is the inhale before the hit
        : [{ at: lock - 0.5, sfx: 'riser', gain_db: -6, dur: Math.min(2, lock - 0.5) }, { at: a1, sfx: 'swish', gain_db: -12 }]),
      { at: 0, sfx: 'pop', gain_db: -9 },
      { at: a2, sfx: 'swish', gain_db: -10 },
      { at: lock, sfx: 'thump', gain_db: -6 },
      ...(g.tag ? [{ at: tagAt, sfx: 'pop', gain_db: -13 }] : []),
      ...(seatAt !== null ? [{ at: seatAt, sfx: 'pop', gain_db: -9 }] : []),
      ...(dotAt !== null ? [{ at: dotAt, sfx: 'pop', gain_db: -7 }] : []),
      ...(kickAt !== null ? [{ at: kickAt, sfx: 'click', gain_db: -6 }] : []),
    ];
    const uniq = (xs, n = sb) => [...new Set(xs)].filter((b) => b >= 0 && b < n).sort((a, b) => a - b);

    /** A settled lockup in a colour set; sc pulses the mark (plate + its content) only, the name never scales. */
    const drawLockup = (f, gg, { cl = NORMAL, sc = 1, tag = null, stopAt = null, stopDone = false, lk = -64 } = {}) => {
      if (gg.type === 'none') {
        const t = gg.target;
        plate(api, t.x + t.w / 2, t.y + t.h / 2, t.w, t.h, { r: t.w / 2, sc, color: cl.plate });
      } else {
        const mk = gg.mark, shrink = gg.type === 'logo' ? 1 - M.clamp(M.sp(f.since(lk + 0.5), TYPE)) : 1;
        plate(api, mk.x + mk.w / 2, mk.y + mk.h / 2, mk.w, mk.h, { r: gg.radius, sc: sc * shrink, color: cl.plate });
        markInner(api, gg, { iris: 1, rise: 1, sc, color: cl.mono });
      }
      nameReveal(api, gg, 1, cl.name);
      if (gg.tag && tag !== null) T.kinetic(f, gg.tag, { by: 'word', at: tag, stagger: 0.125, from: 'mask', spring: TYPE, color: cl.tag });
      if (stopDone) fullStop(api, gg, { p: 1, sq: 0 }, cl.dot);
      else if (stopAt !== null) fullStop(api, gg, M.drop(f.since(stopAt), 'soft'), cl.dot);
    };

    /** The lockup with an accent box over part of it: normal outside the box, `inside` colours inside it. */
    const drawSplit = (f, box, inside, o) => {
      const grp = g.group;
      if (!covers(box, grp)) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, F.w, F.h); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip('evenodd');
        drawLockup(f, g, { ...o, cl: NORMAL });
        ctx.restore();
      }
      if (hits(box, grp)) D.withClip(ctx, (c) => c.rect(box.x, box.y, box.w, box.h), () => drawLockup(f, g, { ...o, cl: inside }));
    };

    /** The hook band and the two-move crop window that closes onto the plate (pre-lock). */
    const drawHook = (f) => {
      const lb = f.lb;
      const u1 = M.clamp((lb - a2) / Math.max(1e-6, x1 - a2)), e1 = u1 * u1;          // sweep: x edges + words out
      const u2 = M.clamp((lb - x1) / Math.max(1e-6, antic - x1)), e2 = u2 * u2;       // close: y edges onto the plate
      const win = { x: Tg.x * e1, y: Tg.y * e2, w: F.w + (Tg.w - F.w) * e1, h: F.h + (Tg.h - F.h) * e2 };
      const pA = M.sp(f.since(antic), 'snap'), ang = -0.14 * pA, sc = 1 - 0.1 * pA;
      const wc = [win.x + win.w / 2, win.y + win.h / 2];
      ctx.save();
      ctx.translate(wc[0], wc[1]); ctx.rotate(ang); ctx.scale(sc, sc); ctx.translate(-wc[0], -wc[1]);
      D.fillBox(ctx, win, 'accent', g.radius * e2);
      if (u1 < 1) {
        const pn = pan(lb), spl = splitAt(f.since(a1));
        D.withClip(ctx, (cx) => cx.rect(win.x, win.y, win.w, win.h), () => {
          hook.pieces.forEach((p, i) => {
            const x = p.x + (wide ? pn : 0) + p.dir * (spl + need[i] * e1), y = p.y - (wide ? 0 : F.h * 0.025 - pn);
            // overscanned and deliberately cropped by the frame / window edges: logged where drawn, as bleed
            T.drawText(ctx, theme, p.s, x, y, { role: 'display', size: hook.size, color: onA, align: 'l', bleed: true });
          });
        });
      }
      ctx.restore();
    };

    /** The field copy: drops out of the mark into its seat on seatAt, grows into the full field over the last half beat. */
    const fieldBox = (f) => {
      if (!card || f.lb < (seatAt ?? sb - 0.5)) return null;
      const mk = g.target, fd = card.field;
      const seat = { x: mk.x, y: fd.y + (fd.h - mk.h) / 2, w: mk.w, h: mk.h };
      let box = seatAt !== null ? lerpBox(mk, seat, M.clamp(M.sp(f.since(seatAt), UI), 0, 1.04)) : mk;
      const c = M.clamp((f.lb - (sb - 0.5)) / 0.5);
      if (c > 0) box = lerpBox(seatAt !== null ? seat : mk, fd, c * c);
      return box;
    };

    const sting = {
      id: 'sting', beats: sb, cut: 'keep',
      events: uniq([0, a1, a2, lock, ...(g.tag ? [tagAt] : []), ...(seatAt !== null ? [seatAt] : []), last]),
      sfx: stingSfx,
      draw(f) {
        if (f.lb < lock) { drawHook(f); return; }
        const s = f.since(lock), flash = s < FLASH_S;
        const kick = kickAt !== null ? f.hit(kickAt, 0.12) * 0.05 : 0;
        const o = { sc: 1 + 0.09 * Math.exp(-Math.max(0, s) / 0.09) + kick, tag: tagAt, stopAt: dotAt, lk: lock };
        if (flash) { D.fillBox(ctx, F.full, 'accent'); drawLockup(f, g, { ...o, cl: REVERSED }); return; }
        const box = fieldBox(f);
        if (!box) { drawLockup(f, g, { ...o, cl: NORMAL }); return; }
        D.fillBox(ctx, box, 'accent', g.radius * M.clamp(1 - (box.w - g.target.w) / Math.max(1, F.w * 0.2)));
        drawSplit(f, box, ON_FIELD, o);
      },
    };
    const scenes = [sting];
    if (ec) scenes.push(endCard(api, { ec, eb, card, onA, REVERSED, drawSplit, uniq, lerpBox }));
    return { scenes, persistent: [], ...(ec ? {} : { poster: q(lock + 1.5) }) };
  },
};

/**
 * End card: a continuation of the sting, not a new layout. The hero lockup is already where the lock put it and the
 * field has just reached full size (rendered alone, frame 0 shows exactly that). Beat 0: the CTA is cut out of the
 * field; 1: the URL types on; 2: the CTA is pressed (8-beat card: again on 6); last: the field floods the frame.
 */
function endCard(api, { ec, eb, card, onA, REVERSED, drawSplit, uniq, lerpBox: lb }) {
  const { F, ctx, M, T, D } = api;
  const { field, ctaFit, urlFit, capUI } = card;
  const ctaLine = ctaFit.lines[ctaFit.lines.length - 1];
  const lastE = eb - 1, urlAt = 1, pressAt = Math.min(2, lastE - 1);
  const presses = [pressAt, ...(lastE - pressAt > 4 ? [pressAt + 4] : [])].filter((b) => b < lastE);
  return {
    id: 'endcard', beats: eb, cut: 1,
    events: uniq([0, ...(urlFit ? [urlAt] : []), ...presses, lastE], eb),
    sfx: [{ at: 0, sfx: 'pop', gain_db: -6 }, ...(urlFit ? [{ at: urlAt, sfx: 'tick', gain_db: -10 }] : []),
      ...presses.map((at) => ({ at, sfx: 'click', gain_db: -5 })),
      { at: lastE, sfx: 'riser', gain_db: -9, dur: Math.min(2, lastE) }, { at: lastE, sfx: 'thump', gain_db: 0 }, { at: lastE, sfx: 'pop', gain_db: -3 }],
    draw(f) {
      // the flood wipes over the quarter beat before the last beat (ease-in): the hit frame is the full flood
      const c = M.clamp((f.lb - (lastE - 0.25)) / 0.25), box = lb(field, F.full, c * c);
      D.fillBox(ctx, box, 'accent');
      const kick = 1 + 0.12 * (f.since(lastE) >= 0 ? Math.exp(-f.since(lastE) / 0.1) : 0);   // the mark re-hits
      drawSplit(f, box, REVERSED, { sc: kick, tag: -64, stopDone: true });
      D.withClip(ctx, (cc) => cc.rect(box.x, box.y, box.w, box.h), () => {
        const nudge = presses.reduce((acc, at) => acc + f.hit(at, 0.2), 0);
        const cs = ctaFit.size, a = cs * 0.3, ay = ctaLine.y - cs * capUI / 2;
        const ax = ctaLine.x + ctaLine.w + cs * 0.55 + a + nudge * cs * 0.5;
        // the press: a chip in the on-accent colour wipes in behind the CTA, which turns accent (a frame-size event)
        const pad = cs * 0.32, chipFull = { x: ctaLine.x - pad, y: ctaLine.y - cs * capUI - pad, w: ctaLine.w + cs * 1.45 + 2 * pad, h: cs * capUI + 2 * pad };
        const pc = presses.length ? M.clamp(M.sp(f.since(presses[0]), UI), 0, 1.02) : 0;
        const chip = { ...chipFull, w: chipFull.w * pc };
        if (pc > 0) D.fillBox(ctx, chip, onA, Math.min(chip.w, chip.h) * 0.22);
        const cta = (col, log) => {
          const draw = () => {
            T.kinetic(f, ctaFit, { by: 'word', at: 0, stagger: 0.0625, from: 'mask', spring: TYPE, color: col });
            D.line(ctx, [[ax - a, ay - a], [ax, ay], [ax - a, ay + a]], { color: col, width: Math.max(3, cs * 0.12), progress: M.clamp(M.sp(f.since(0.25), TYPE)) });
          };
          if (log) draw(); else T.quiet(draw);
        };
        if (pc < 0.999) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, F.w, F.h); ctx.rect(chip.x, chip.y, chip.w, chip.h); ctx.clip('evenodd');
          cta(onA, true); ctx.restore();
        }
        if (pc > 0) D.withClip(ctx, (cc) => cc.rect(chip.x, chip.y, chip.w, chip.h), () => cta('accent', pc >= 0.999));
        if (urlFit) T.kinetic(f, urlFit, { by: 'char', at: urlAt, stagger: 0.02, from: 'mask', spring: TYPE, color: onA });
      });
    },
  };
}
