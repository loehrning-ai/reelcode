// explainer: a numbered how-it-works film built around one object that travels through every step.
// Cold open (the finished film playing in all four aspect frames, scrubbed and rewound into the question title) ->
// 3-5 steps, each a hero shot that shows the thing itself (scrub / paint / filmstrip / blend, or the flow diagram)
// with the diagram as a one-row caption strip -> a recap whose stage nodes fire on consecutive beats and converge
// into the four aspect frames and the brand lockup. Cuts between steps carry the hero object (no blank wipes).
import { checkDiagram } from './diagram.js';
import { inkOn } from './ink.js';
import { makeOutro } from './outro.js';
import { makeHeroes } from './heroes.js';
import { chipsWidth, planChips, drawChips } from './strip.js';
import { arrangeFormats, drawFilm, parts, unionOf } from './film.js';
import { planCode, drawCode } from './code.js';
import { makeRecap } from './recap.js';
import { makeLayout } from './stage.js';

const INTRO = 8, TAIL = 0.6, VL = 1 / 16, pad2 = (k) => String(k).padStart(2, '0');

export default {
  id: 'explainer',
  build(api) {
    const { F, data, theme, ctx, grid, L, T, D, M } = api;
    const u = F.u, R = T.readable(F), steps = data.steps, n = steps.length;
    const short = (s) => s.short || s.title.split(/\s+/)[0].slice(0, 10);
    const kindOf = (s) => (s.hero && s.hero.kind) || 'diagram';
    steps.forEach((s, i) => checkDiagram(s.diagram, `content.steps[${i}].diagram`));
    const ink = (key, size, bg = 'bg') => inkOn(api, key, bg, size);
    // visual lead: picture hits land 1/16 beat (~40 ms) before their sound, as cut-on-the-frame-before practice does,
    // so a state change is already readable on the beat frame instead of starting on it
    const lead = (f) => ({ ...f, lb: f.lb + VL, since: (a) => f.since(a - VL), hit: (a, ...r) => f.hit(a - VL, ...r) });

    // ---------- timing (content-only, identical across formats) ----------
    const maxNodes = Math.max(...steps.map((s) => s.diagram.nodes.length));
    const minStep = Math.max(6, maxNodes + 2), recapMin = n + 6;
    const stepBeats = data.stepBeats ?? M.clamp(Math.floor((grid.totalBeats - INTRO - recapMin) / n), minStep, 16);
    const recapBeats = grid.totalBeats - INTRO - n * stepBeats;
    if (stepBeats < minStep) throw new Error(`explainer: stepBeats ${stepBeats} is too short for ${maxNodes} diagram nodes (needs >= ${minStep})`);
    if (recapBeats < recapMin) {
      const need = INTRO + n * stepBeats + recapMin;
      throw new Error(`explainer: ${n} steps x ${stepBeats} beats need ${need} beats (${(need * 60 / grid.bpm).toFixed(1)} s at ${grid.bpm} bpm); raise duration or lower stepBeats`);
    }
    const S = stepBeats, stepStart = (k) => INTRO + k * S;

    // ---------- layout: per-aspect stage (title band, hero, caption strip; 16:9 = 40/60 columns) ----------
    const chipFits = (w) => steps.every((s) => kindOf(s) === 'diagram' || chipsWidth(api, s.diagram.nodes, R) <= w);
    const lay = makeLayout(api, { R, n, chipFits });
    const { SB, rail, railH, C } = lay;
    const geos = steps.map((s, k) => lay.stepGeo(k, kindOf(s) !== 'diagram'));
    const heroes = makeHeroes(api, { R, S, ink });

    // ---------- cold open: real code full bleed; the highlighted line evaluates and the ball drops out of it into
    // the frame (so "This is code." becomes true); the frame splits into the four aspect frames; mine grows into step 1
    const PRE = -4, DROP = 2, SPLIT = 3, GROW = 4;
    const hookTxt = data.hook || 'This is code.';
    const hookFit = T.fitText(ctx, theme, hookTxt, { role: 'display', box: lay.hookHead, lines: 1, max: R * 2.6, min: R * 1.2, valign: 'b' });
    const tiles = arrangeFormats(lay.hookTiles, { gap: R * 0.6, lab: R * 1.7, orient: F.orient });
    const big = unionOf(tiles), bigP = parts(api, big);
    const tileLab = tiles.map((t) => T.fitText(ctx, theme, t.label, { role: 'ui', box: { ...t.lab, y: t.lab.y + R * 0.25, h: R * 1.3 }, lines: 1, max: R, min: R, align: 'c', valign: 't' }));
    const mine = Math.max(0, tiles.findIndex((t) => t.label === F.fmt.replace('x', ':')));
    const code = planCode(api, L.inset(lay.hookTiles, { l: R * 0.2, r: R * 0.2 }), { max: R * 2, min: R });
    const titleFit = lay.fitBal(data.title, { role: 'display', box: lay.introTitle, lines: 'auto', leading: 1.0, max: R * F.pick({ v: 2, s: 2, h: 2.2 }), min: R, valign: 't' });
    const kickTxt = data.kicker || `${n} steps`;
    const kickB = { ...geos[0].band, y: geos[0].band.y + R * 0.3, h: R * 1.4 };
    const kickFit = T.fitText(ctx, theme, kickTxt, { role: 'ui', box: { ...kickB, w: Math.max(kickB.w, (F.orient === 'h' ? geos[0].hero.x + geos[0].hero.w : C.x + C.w) - kickB.x) }, lines: 1, max: R * 1.1, min: R, valign: 't' });
    const hookInk = { dark: ink('bg', hookFit.size, 'fg'), light: 'fg' };
    // text that crosses the shrinking dark panel: cream inside it, ink outside it (two clips, one logged)
    const split2 = (pr, logDark, draw) => {
      const inside = (c) => c.rect(pr.x, pr.y, pr.w, pr.h);
      const outside = (c) => { c.rect(0, 0, F.w, pr.y); c.rect(0, pr.y + pr.h, F.w, F.h); c.rect(0, pr.y, pr.x, pr.h); c.rect(pr.x + pr.w, pr.y, F.w, pr.h); };
      D.withClip(ctx, inside, () => (logDark ? draw(hookInk.dark) : T.quiet(() => draw(hookInk.dark))));
      D.withClip(ctx, outside, () => (logDark ? T.quiet(() => draw(hookInk.light)) : draw(hookInk.light)));
    };
    const intro = {
      id: 'intro', beats: INTRO,
      events: [1, 1.5, DROP, SPLIT, SPLIT + 0.5, GROW, 4.5, 5.5, 6],
      sfx: [{ at: 0, sfx: 'thump', gain_db: -3 }, { at: 1, sfx: 'tick', gain_db: -6 }, { at: 1.5, sfx: 'swish', gain_db: -12 }, { at: DROP, sfx: 'thump', gain_db: -3 },
        { at: SPLIT, sfx: 'whoosh', gain_db: -8 }, { at: SPLIT + 0.5, sfx: 'pop', gain_db: -12 }, { at: GROW, sfx: 'whoosh', gain_db: -6 },
        { at: 4.5, sfx: 'pop', gain_db: -10 }, { at: 5.5, sfx: 'pop', gain_db: -12 }],
      draw(f0) {
        const f = lead(f0);
        const shrink = M.clamp(M.sp(f.since(DROP), 'stiff')), go = M.clamp(M.sp(f.since(GROW), 'stiff'));
        const sp3 = M.clamp(M.sp(f.since(SPLIT), 'stiff'));
        const ft = f.lb;
        // the dark panel: full bleed until the drop, then it shrinks into the one big frame
        if (f.lb < SPLIT + 0.2) D.fillBox(ctx, L.lerpBox(F.full, big, shrink), 'fg', theme.radius * 0.7 * shrink);
        const pr = f.lb < DROP ? F.full : f.lb < SPLIT ? L.lerpBox(F.full, big, shrink) : { x: 0, y: 0, w: 0, h: 0 };
        // the hook line: set at frame 0, pushed up out of its band on the grow
        D.withClip(ctx, (c) => c.rect(F.full.x, lay.hookHead.y - R, F.w, lay.hookHead.h + R * 1.6), () => {
          ctx.save(); ctx.translate(0, -go * (lay.hookHead.h + R * 2));
          const line = (color) => T.kinetic(f, hookFit, { by: 'word', at: PRE, stagger: 0.05, from: 'mask', spring: 'stiff', color });
          if (go > 0.001) T.quiet(() => line(hookInk.light));
          else split2(pr, f.lb < DROP + 0.3, line);
          ctx.restore();
        });
        // the code: on screen at frame 0; it slides up out of the panel on the drop
        if (f.lb < DROP + 0.6) {
          const out = M.clamp(M.sp(f.since(DROP), 'stiff'));
          const cy0 = Math.max(pr.y, lay.hookTiles.y - R * 0.3);   // exits under the hook line, never over it
          D.withClip(ctx, (c) => c.rect(pr.x, cy0, pr.w, pr.y + pr.h - cy0), () => {
            ctx.save(); ctx.translate(0, -out * lay.hookTiles.h);
            drawCode(f, api, code, { at: PRE, hiAt: PRE, quiet: out > 0.001 });
            ctx.restore();
          });
        }
        // the ball: pops at the end of the highlighted line on b1, falls on b1.5, lands in the frame on the drop
        if (f.lb >= 1 && f.lb < DROP) {
          const land = bigP.ballAt(DROP), [x0, y0] = code.end;
          const s = M.clamp((f.lb - 1.5) / (DROP - 1.5)), x = x0 + (land.x - x0) * s, y = y0 + (land.y - y0) * s * s;
          D.disc(ctx, x, y, bigP.br * M.clamp(M.sp(f.since(1), 'snap'), 0, 1.1), 'accent');
        }
        if (f.lb >= DROP && f.lb < SPLIT) {
          const wp = M.clamp(M.sp(f.since(DROP), 'stiff'));
          drawFilm(api, big, ft, { layers: [1, wp, wp, 1, 1] });
        }
        if (f.lb < SPLIT) return;
        tiles.forEach((t, k) => {
          if (k === mine) return;
          const drop = M.clamp(M.sp(f.since(GROW + 0.08 * k), 'stiff'));
          ctx.save(); ctx.translate(0, drop * (F.h - t.r.y + R));
          drawFilm(api, L.lerpBox(big, t.r, sp3), ft);
          const lab = () => T.kinetic(f, tileLab[k], { by: 'line', at: SPLIT + 0.5, from: 'mask', spring: 'stiff', color: ink('muted', R) });
          if (drop > 0.001) T.quiet(lab); else lab();
          ctx.restore();
        });
        // my own format's frame grows into the step-1 frame: the object the whole film follows
        const g0 = geos[0].film, r = L.lerpBox(L.lerpBox(big, tiles[mine].r, sp3), g0, M.clamp(M.sp(f.since(GROW + 0.1), 'stiff')));
        drawFilm(api, r, ft);
        if (go < 0.02) T.kinetic(f, tileLab[mine], { by: 'line', at: SPLIT + 0.5, from: 'mask', spring: 'stiff', color: ink('muted', R) });
        T.kinetic(f, titleFit, { by: 'word', at: 4.5, stagger: 0.12, from: 'mask', spring: 'stiff' });
        T.kinetic(f, kickFit, { by: 'char', at: 5.5, stagger: 0.03, from: 'mask', spring: 'stiff', color: ink('accent', kickFit.size) });
      },
    };

    // ---------- steps: compact numeral + title, hero shot, caption strip ----------
    const titleIn = (k) => [{ by: 'word', stagger: 0.06 }, { by: 'line', stagger: 0.1 }, { by: 'char', stagger: 0.012 }][k % 3];
    const roll = (f, tl, from, to, dir, at) => {
      if (f.since(at) <= 0) return;   // nothing over the hero while it slides through the text column
      const { numFit, numB } = tl, { x, y } = numFit.lines[0], h = numFit.size, p = M.sp(f.since(at), 'stiff');
      D.withClip(ctx, (c) => c.rect(numB.x, y - numFit.cap - h * 0.1, numB.w, numFit.cap + h * 0.1 + 8 * u), () => {
        T.drawText(ctx, theme, from, x, y - dir * p * h * 1.05, { role: 'display', size: h, color: ink('muted', h), log: false });
        T.drawText(ctx, theme, to, x, y + dir * (1 - p) * h * 1.05, { role: 'display', size: h, color: ink('accent', h), log: false });
      });
      T.logText(ctx, to, { x, y: y - numFit.cap, w: T.measure(ctx, theme, 'display', to, h).w, h: numFit.cap }, h, 'display');
    };
    const stepScene = (s, k) => {
      const g = geos[k], kind = kindOf(s), hero = heroes[kind];
      const pl = kind === 'diagram' ? hero.plan(s, g) : null;
      const prev = k > 0 ? { hero: heroes[kindOf(steps[k - 1])], g: geos[k - 1] } : null;
      const tl = g.text, tFit = lay.fitBal(s.title, { role: 'display', box: tl.titleB, lines: 'auto', leading: 1.02, max: lay.titleMax, min: R, valign: 't' });
      const chips = g.strip && kind !== 'diagram' ? planChips(api, s.diagram, g.strip, R, F.orient === 'h' ? 'l' : 'c') : null;
      // 16:9 swaps columns: the type waits until the hero has slid out of its column
      const typeAt = F.orient === 'h' && k > 0 ? 0.45 : -0.35;
      const chipAt = (j) => 1 + j, litAt = Math.min(S - 1, s.diagram.nodes.length + 1);
      return {
        id: `step${k + 1}`, beats: S, transition: { type: 'cut', beats: 0 },
        events: [...hero.events(S, pl), ...(chips ? [litAt] : [])].filter((b) => b > 0 && b < S),
        sfx: [{ at: 0, sfx: 'pop', gain_db: -8 }, ...hero.sfx(S, pl)].filter((m) => m.at < S),
        draw(f0) {
          const f = lead(f0);
          const q = 1 - M.clamp(M.sp(f.since(0.05), 'stiff'));
          // the seam is a camera move on the hero object: alternating close-up / wide framings that settle in
          const cam = prev && F.orient !== 'h' ? 1 - M.clamp(M.sp(f.since(0), 'stiff')) : 0, [hx, hy] = L.center(g.film);
          if (cam > 0.001) {
            ctx.save(); ctx.beginPath(); ctx.rect(0, g.hero.y - R * 0.4, F.w, F.h); ctx.clip();   // never over the title band
            const z = 1 + (k % 2 ? 0.24 : -0.18) * cam;
            ctx.save(); ctx.translate(hx + (k % 2 ? -1 : 1) * F.w * 0.1 * cam, hy); ctx.scale(z, z); ctx.translate(-hx, -hy);
          }
          if (prev && f.lb < TAIL && kind !== 'diagram') {
            const pg = { ...prev.g, film: L.lerpBox(prev.g.film, g.film, 1 - q), band: L.lerpBox(prev.g.band, g.band, 1 - q), hero: L.lerpBox(prev.g.hero, g.hero, 1 - q) };
            T.quiet(() => prev.hero.tail(f, pg, q));
          } else if (cam > 0.001) T.quiet(() => hero.draw(f, g, s, pl));
          else hero.draw(f, g, s, pl);
          if (cam > 0.001) { ctx.restore(); ctx.restore(); }
          roll(f, tl, pad2(k), pad2(k + 1), k % 2 ? -1 : 1, typeAt);
          T.kinetic(f, tFit, { ...titleIn(k), at: typeAt, from: 'mask', spring: 'stiff' });
          if (chips) drawChips(f, api, chips, chipAt, litAt);
        },
      };
    };

    // ---------- recap: stage nodes fire on consecutive beats, then converge into the lockup ----------
    const convAt = n + 1, lastAt = recapBeats - 1, panelAt = Math.max(convAt + 2, lastAt - 2);
    const [rHead, rBody] = L.split(C, F.pick({ v: [0.2, 0.8], s: [0.22, 0.78], h: [0.22, 0.78] }), { axis: 'y', gap: R * 0.8 });
    const lastG = geos[n - 1], lastFilm = kindOf(steps[n - 1]) === 'diagram' ? lastG.hero : lastG.film;
    const objR = L.aspectFit(L.inset(rBody, { t: R * 0.4, b: R * 2.2, l: R, r: R }), M.clamp(lastFilm.w / lastFilm.h, 0.72, 1.78), 'c');
    const outro = makeOutro(api, { C, body: rBody, objR, text: data.recap.end || api.project.brand.name || data.title, sub: data.recap.sub, convAt, panelAt, lastAt, fitBal: lay.fitBal, lead });
    const [ox, oy] = L.center(lastFilm);
    const recap = makeRecap(api, { lead, R, rHead, objR, n, steps, kindOf, recapBeats, convAt, outro, fitBal: lay.fitBal, origin: [ox / F.w, oy / F.h] });

    // ---------- persistent progress rail (grows in at the end of the cold open) ----------
    const segs = L.grid(rail, n, { cols: n, gap: 14 * u });
    const segLabel = segs.map((sg, k) => {
      const long = `${pad2(k + 1)}  ${short(steps[k])}`;
      return T.measure(ctx, theme, 'ui', long, R).w <= sg.w ? long : pad2(k + 1);
    });
    const railAt = (k) => INTRO - 2 + k * 0.12, railInk = { on: ink('accent', R), off: ink('muted', R) };
    const progress = {
      id: 'progress',
      draw(f) {
        if (outro.top(f) <= rail.y + railH) return;
        const merge = M.clamp(M.sp(f.since(stepStart(n) + convAt), 'snap'), 0, 1);
        if (merge > 0) D.fillBox(ctx, { x: rail.x, y: rail.y, w: rail.w * merge, h: railH }, 'accent', railH / 2);
        segs.forEach((sg, k) => {
          const grow = M.clamp(M.sp(f.since(railAt(k)), 'snap'), 0, 1.03);
          if (grow <= 0) return;
          const s0 = stepStart(k), fill = M.clamp((f.lb - s0) / S);
          if (merge < 1) {
            D.fillBox(ctx, { x: sg.x, y: rail.y, w: sg.w * grow, h: railH }, 'surface', railH / 2);
            if (fill > 0) D.fillBox(ctx, { x: sg.x, y: rail.y, w: sg.w * fill, h: railH }, 'accent', railH / 2);
          }
          const active = f.lb >= s0 && f.lb < s0 + S, done = f.lb >= s0 + S;
          const rise = M.sp(f.since(railAt(k)), 'stiff'), lift = active ? M.sp(f.since(s0), 'stiff') * R * 0.18 : 0;
          D.withClip(ctx, (c) => c.rect(sg.x - 2, rail.y - R * 1.9, sg.w + 4, R * 1.7), () =>
            T.drawText(ctx, theme, active ? segLabel[k] : pad2(k + 1), sg.x, rail.y - R * 0.62 - lift + (1 - rise) * R * 1.2,
              { role: 'ui', size: R, color: active ? railInk.on : done ? 'fg' : railInk.off, weight: active ? 700 : undefined, rest: [sg.x, rail.y - R * 0.62 - lift] }));
        });
      },
    };

    return { scenes: [intro, ...steps.map(stepScene), recap], persistent: [progress, outro.layer] };
  },
};
