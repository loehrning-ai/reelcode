// recap.js: the climax as a chain reaction of the step hero objects themselves, one link per beat, each pushed by its
// own stage sound. b0: the code block irises in out of the last hero. Then, per step on consecutive beats, the object
// changes form the way that step changed it: scrub = the code fires into the frame and leaves an onion skin; paint =
// the frame repaints layer by layer with accent flashes; filmstrip = it stamps into a running strip; blend = the strip
// collapses into the play tile. On convAt the outro splits the play tile into the four aspect frames. No box row.
import { drawFilm, drawStreak, drawWave, layerBox, LAYERS } from './film.js';
import { planCode, drawCode } from './code.js';

const STAGE_SFX = { scrub: 'tick', paint: 'swish', filmstrip: 'click', blend: 'thump', diagram: 'pop' };
const RECAP_CODE = ['ball.x = cross(t);', 'ball.y = bounce(t);'];

export function makeRecap(api, { lead, R, rHead, objR, n, steps, kindOf, recapBeats, convAt, outro, fitBal, origin }) {
  const { F, L, M, D, T, theme } = api, u = F.u, ctx = api.ctx;
  const vert = F.orient === 'v';
  const fireAt = (j) => 1 + j;
  const rFit = fitBal(api.data.recap.text, { role: 'display', box: rHead, lines: 'auto', leading: 1.02, max: R * 2.4, min: R, valign: 'b' });
  const code = planCode(api, L.inset(objR, { l: R, r: R }), { max: R * 1.5, min: R, lines: RECAP_CODE, hi: 1 });
  const rad = Math.min(theme.radius * 0.7, objR.h * 0.08);
  const kinds = steps.map(kindOf);
  const firstFire = 1;
  // which link is live at local beat lb (-1 before the first fire); blend persists until the split
  const live = (lb) => { let j = -1; kinds.forEach((_, i) => { if (lb >= fireAt(i)) j = i; }); return j; };

  const stripLink = (f, ft, at) => {          // the frame becomes the gate cell of a running filmstrip
    const grow = M.clamp(M.sp(f.since(at), 'snap'), 0, 1), pitch = (vert ? objR.h : objR.w) * 1.12;
    const off = pitch * Math.max(0, f.lb - at) * 1.6, thick = (vert ? objR.w : objR.h) * 1.3;
    const [cx, cy] = L.center(objR);
    const band = vert ? { x: cx - thick / 2, y: cy - (F.h * grow) / 2, w: thick, h: F.h * grow } : { x: cx - (F.w * grow) / 2, y: cy - thick / 2, w: F.w * grow, h: thick };
    drawFilm(api, objR, ft);
    D.withClip(ctx, (c) => c.rect(band.x, Math.max(band.y, rHead.y + rHead.h + R * 0.6), band.w, band.h), () => {
      D.fillBox(ctx, band, 'muted');
      for (let i = -3; i <= 3; i++) {
        const a = i * pitch + (vert ? 1 : -1) * M.mod(off, pitch);
        drawFilm(api, vert ? { ...objR, y: objR.y + a } : { ...objR, x: objR.x + a }, ft - i * 0.5);
      }
    });
    D.strokeBox(ctx, L.inset(objR, -R * 0.3), 'accent', 8 * u, rad);
  };
  const tileLink = (f, ft, at) => {          // the strip collapses into the play tile: frame + waveform + play button
    const lock = M.clamp(M.sp(f.since(at), 'snap'), 0, 1.03), wh = objR.h * 0.16;
    const tile = { x: objR.x - R * 0.5, y: objR.y - R * 0.5, w: objR.w + R, h: objR.h + wh + R * 1.4 };
    D.fillBox(ctx, L.lerpBox(objR, tile, lock), 'fg', rad);
    drawFilm(api, objR, ft, { ball: false });
    drawStreak(api, objR, ft, ft + 0.5, 1);
    drawWave(api, { x: objR.x, y: objR.y + objR.h + R * 0.45, w: objR.w, h: wh }, Math.min(1, lock), 'bg');
    const [cx, cy] = L.center(objR), rr = Math.min(objR.w, objR.h) * 0.14 * lock;
    if (rr > 0) { D.disc(ctx, cx, cy, rr, 'bg'); D.fillPoly(ctx, [[cx - rr * 0.32, cy - rr * 0.45], [cx + rr * 0.5, cy], [cx - rr * 0.32, cy + rr * 0.45]], 'accent'); }
  };

  return {
    id: 'recap', beats: recapBeats, transition: { type: 'iris', beats: 1, origin },
    events: [0, ...steps.map((_, j) => fireAt(j)), ...outro.events].filter((b) => b < recapBeats),
    sfx: [{ at: 0, sfx: 'whoosh', gain_db: -8 },
      ...steps.map((s, j) => ({ at: fireAt(j), sfx: STAGE_SFX[kindOf(s)] || 'pop', gain_db: j === n - 1 ? -4 : -6 })),
      ...outro.sfx].filter((m) => m.at < recapBeats && m.at >= 0),
    draw(f0) {
      const f = lead(f0);
      if (outro.covered(f0)) return;
      T.kinetic(f, rFit, { by: 'word', at: 0, stagger: 0.1, from: 'mask', spring: 'stiff' });
      if (f.lb >= convAt) return;   // the outro owns the object from the split on
      const j = live(f.lb), ft = 8 + Math.max(0, f.lb - firstFire);
      const hit = j >= 0 ? f.hit(fireAt(j), 0.15, 'snap') : 0;
      const [cx, cy] = L.center(objR), sc = 1 + 0.06 * hit;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      if (j < 0 || f.lb < firstFire + 0.5) {        // the code block; on the first fire it slides up out of the frame
        const out = M.clamp(M.sp(f.since(firstFire), 'stiff'));
        D.fillBox(ctx, objR, 'fg', rad);
        if (j >= 0) drawFilm(api, objR, ft, { layers: [1, M.clamp(M.sp(f.since(firstFire), 'stiff')), 1, 1, 1] });
        D.withClip(ctx, (c) => c.rect(objR.x, objR.y, objR.w, objR.h), () => {
          ctx.save(); ctx.translate(0, -out * objR.h);
          drawCode(f, api, code, { at: 0, hiAt: 0.3, quiet: out > 0.001 });
          ctx.restore();
        });
      } else {
        const k = kinds[j], at = fireAt(j);
        if (k === 'filmstrip') stripLink(f, ft, at);
        else if (k === 'blend') tileLink(f, ft, at);
        else if (k === 'paint') {
          const layers = Array.from({ length: LAYERS }, (_, i) => M.clamp(M.sp(f.since(at + i * 0.14), 'stiff')));
          D.fillBox(ctx, objR, 'bg', rad);
          drawFilm(api, objR, ft, { layers });
          const i = Math.min(LAYERS - 1, Math.floor((f.lb - at) / 0.14));
          D.strokeBox(ctx, L.inset(layerBox(api, objR, i, ft), -6 * u), 'accent', 6 * u, R * 0.2);
        } else drawFilm(api, objR, ft, { ghosts: k === 'scrub' ? [ft - 0.75, ft - 0.5, ft - 0.25] : [] });
      }
      ctx.restore();
    },
  };
}
