// outro.js: the ending ends on one thing, not a reprise of the cold-open grid. On convAt the recap's play tile splits
// into the four aspect frames, which fly to their places (thump) and get their labels. On panelAt the 9:16 frame
// scales up out of its slot until the film frame IS the screen (whoosh): the shot itself becomes the end card. One beat
// later the card cuts to the lockup composed like the shot (the wordmark where CODE was, a cream ground rule), and on
// the last beat the accent ball drops onto the rule (thump) and the card punches: the final frame is a hit.
// Timing is read from f.scene (the recap's own clock), so cutdowns stay correct. This is the last persistent layer.
import { inkOn } from './ink.js';
import { arrangeFormats, drawFilm } from './film.js';

export function makeOutro(api, { C, body, objR, text, sub, convAt, panelAt, lastAt, fitBal, lead = (f) => f, sceneId = 'recap' }) {
  const { F, T, M, D, L, ctx, theme } = api;
  const R = T.readable(F), u = F.u;
  const tiles = arrangeFormats(body, { gap: R * 0.6, lab: R * 1.7, orient: F.orient });
  const labFits = tiles.map((t) => T.fitText(ctx, theme, t.label, { role: 'ui', box: { ...t.lab, y: t.lab.y + R * 0.25, h: R * 1.3 }, lines: 1, max: R, min: R, align: 'c', valign: 't' }));
  // the lockup, laid out like the film shot: wordmark top-left of the content box, the rule under it, sub below
  const headBox = { x: C.x, y: C.y + C.h * F.pick({ v: 0.2, s: 0.16, h: 0.14 }), w: C.w, h: C.h * F.pick({ v: 0.36, s: 0.42, h: 0.42 }) };
  const head = fitBal(text, { role: 'display', box: headBox, lines: 'auto', leading: 1.0, max: R * F.pick({ v: 3.4, s: 3.2, h: 3.8 }), min: R * 1.4, valign: 'b' });
  const last = head.lines[head.lines.length - 1];
  const br = head.size * 0.2, ruleY = last.y + head.size * 0.34, ruleH = Math.max(6, 14 * u);
  const ballX = Math.min(C.x + C.w - br, last.x + last.w + br * 1.8), ruleW = ballX + br * 2.4 - C.x;
  const subFit = sub ? T.tryFit(ctx, theme, sub, { role: 'ui', box: { x: C.x, y: ruleY + ruleH + R * 1.1, w: C.w, h: R * 1.6 }, lines: 1, max: R * 1.1, min: R, valign: 't' }) : null;
  const useSub = subFit && !subFit.overflow;
  const inkHead = inkOn(api, 'bg', 'fg', head.size), inkSub = useSub ? inkOn(api, 'surface', 'fg', subFit.size) : 'bg';
  const inkLab = (size) => inkOn(api, 'muted', 'bg', size);
  // the recap's clock (persistent layers get the scene clock, which has no hit(): build it from since())
  const local = (f) => {
    if (!f.scene || f.scene.id !== sceneId) return null;
    const c = lead(f.scene);
    return { ...c, hit: (at, len = 0.08, sp = 'snap') => M.pulse(c.since(at), 0, len, sp) };
  };
  const grow = (s) => M.clamp(M.sp(s.since(panelAt), 'stiff'), 0, 1);
  const cardAt = panelAt + 0.5;                     // the grown frame cuts to the card on the off-beat; sub on the next beat
  /** y of the panel's top edge (F.h while it has not started): the rail hides under it. */
  const top = (f) => { const s = local(f); return s && s.since(panelAt) > 0 ? L.lerpBox(tiles[0].r, F.full, grow(s)).y : F.h; };
  /** true once the card covers the whole frame (the recap scene stops drawing under it). */
  const covered = (f) => { const s = local(f); return !!s && s.lb >= cardAt; };

  const lockup = (fr, lb) => {
    const hit = fr.hit(lastAt, 0.2, 'snap'), drop = R * 0.35 * hit;   // the thump: the whole card kicks down
    D.fillBox(ctx, F.full, 'fg');
    ctx.save(); ctx.translate(0, drop);
    T.kinetic(fr, head, { by: 'word', at: cardAt - 0.0625, stagger: 0.12, from: 'mask', spring: 'stiff', color: inkHead });
    if (useSub) T.kinetic(fr, subFit, { by: 'line', at: panelAt + 1, from: 'mask', spring: 'stiff', color: inkSub });
    // the ground rule: a thin cream line that slams to full length as the ball lands on it
    const rk = M.clamp(M.sp(fr.since(lastAt - 0.0625), 'snap'), 0, 1.02);
    if (rk > 0) D.fillBox(ctx, { x: C.x, y: ruleY, w: ruleW * rk, h: ruleH }, 'bg', ruleH / 2);
    // the ball: falls from above the frame on the last half beat, lands on the rule on the last beat, settles
    const t0 = lastAt - 0.5, rest = ruleY - br;
    if (lb >= t0) {
      let y = rest, sx = 1, sy = 1;
      if (lb < lastAt) { const s = (lb - t0) / 0.5; y = -br + (rest + br) * s * s; }
      else {
        const d = lb - lastAt, sq = fr.hit(lastAt, 0.12, 'snap') * 0.35;
        y = rest - Math.abs(Math.sin(2 * Math.PI * d)) * br * 2.2 * Math.exp(-5 * d) + br * sq * 0.9;
        sx = 1 + sq; sy = 1 - sq * 0.9;
      }
      ctx.save(); ctx.translate(ballX, y); ctx.scale(sx, sy); D.disc(ctx, 0, 0, br, 'accent'); ctx.restore();
    }
    ctx.restore();
  };

  const layer = {
    id: 'outro',
    draw(f) {
      const s = local(f);
      if (!s || s.since(convAt) <= 0) return;
      const fr = { ...f, since: s.since, hit: s.hit }, lb = s.lb, ft = 8 + Math.max(0, lb - 1);
      if (lb >= cardAt) { lockup(fr, lb); return; }
      const g = s.since(panelAt) > 0 ? grow(s) : 0;
      tiles.forEach((t, k) => {
        if (k === 0 && g > 0) return;               // the 9:16 frame is the one that becomes the card
        const e = M.clamp(M.sp(s.since(convAt + k * 0.06), 'stiff'), 0, 1.04);
        drawFilm(api, L.lerpBox(objR, t.r, e), ft);
        if (g < 0.4) T.kinetic(fr, labFits[k], { by: 'line', at: convAt + 1 + k * 0.06, from: 'mask', spring: 'stiff', color: inkLab(labFits[k].size) });
        else T.quiet(() => T.kinetic(fr, labFits[k], { by: 'line', at: convAt + 1, from: 'mask', spring: 'stiff', color: inkLab(labFits[k].size) }));
      });
      if (g > 0) {
        const r = L.lerpBox(tiles[0].r, F.full, g);
        D.fillBox(ctx, r, 'fg', theme.radius * (1 - g));
        drawFilm(api, r, ft);
      }
    },
  };
  return {
    layer, top, covered, tiles,
    events: [convAt, convAt + 1, panelAt, cardAt, panelAt + 1, lastAt - 0.5, lastAt],
    sfx: [{ at: convAt, sfx: 'thump', gain_db: -2 }, { at: convAt + 1, sfx: 'pop', gain_db: -12 }, { at: panelAt, sfx: 'whoosh', gain_db: -6 },
      { at: cardAt, sfx: 'pop', gain_db: -9 }, { at: panelAt + 1, sfx: 'pop', gain_db: -13 }, { at: lastAt - 0.5, sfx: 'swish', gain_db: -12 }, { at: lastAt, sfx: 'thump', gain_db: -1 }],
  };
}
