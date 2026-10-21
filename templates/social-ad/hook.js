// social-ad window hook: one continuous camera pass through the window frame (used when content.frame is set).
// Frame 0: the first world (hook.image, a wide plate) streams past inside the window with an optional parallax layer
// in front (hook.near), and the first lines are already set large at the top. On turnAt the carriage whips sideways
// through the pillar between two windows (a short motion smear) and lands on the second world (hook.then) as the
// remaining lines slam in at the bottom with the accent word lit on that downbeat: night/day as opposite halves of
// the frame (in 16:9 also opposite corners). The last 2 beats push through the glass into the next shot.
import { q, cues, stage, justify } from './parts.js';
import { slideWorld, nearLayer } from './window.js';

const SLIDE = 0.75;
const SLAM = [0.25, 0.48]; // a hair of overshoot: the second line lands like a hit

export function windowHook(api, o) {
  const { F, ctx, theme, T, L, M, D } = api;
  const { id, beats, hook, win } = o;
  const st = stage(api);
  const n = hook.lines.length;
  const second = hook.then && hook.then.image ? hook.then : null;
  const turn = second && n > 1 ? M.clamp(hook.turn ?? Math.ceil(n / 2), 1, n - 1) : n;
  const turnAt = second ? q(hook.turnAt ?? 3.25) : beats;
  const land = q(turnAt + SLIDE);
  const pushAt = beats - 2;
  const top = F.pick({
    v: { x: st.x, y: st.y, w: st.w, h: st.h * 0.3 },
    s: { x: st.x, y: st.y, w: st.w, h: st.h * 0.36 },
    h: { x: st.x, y: st.y, w: st.w * 0.6, h: st.h * 0.44 },
  });
  const bottom = F.pick({
    v: { x: st.x, y: st.y + st.h * 0.7, w: st.w, h: st.h * 0.3 },
    s: { x: st.x, y: st.y + st.h * 0.64, w: st.w, h: st.h * 0.36 },
    h: { x: st.x + st.w * 0.4, y: st.y + st.h * 0.56, w: st.w * 0.6, h: st.h * 0.44 },
  });
  const pad = (b) => L.inset(b, { l: b.w * 0.03, r: b.w * 0.03, t: b.h * 0.04, b: b.h * 0.04 });
  const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const accIdx = (ft) => (hook.accent ? T.kineticUnits(ctx, theme, ft, 'word').map((u, k) => (norm(u.s) === norm(hook.accent) ? k : -1)).filter((k) => k >= 0) : []);
  const A = justify(api, hook.lines.slice(0, turn), pad(top)).map((ft) => ({ ft, acc: accIdx(ft) }));
  const B = second ? justify(api, hook.lines.slice(turn), pad(bottom)).map((ft) => ({ ft, acc: accIdx(ft) })) : [];
  const worldA = slideWorld(api, hook, { drift: hook.drift ?? 1.1 });
  const near = nearLayer(api, hook.near, hook.nearSpeed ?? 0.9);
  const worldB = second ? slideWorld(api, second, { drift: second.drift ?? 0.3 }) : null;
  const c = cues(beats, [0, 1, 2, ...(second ? [turnAt, land] : []), pushAt],
    [{ at: 0, sfx: 'thump', gain_db: -6 }, { at: 1, sfx: 'tick', gain_db: -14 }, { at: 2, sfx: 'tick', gain_db: -14 },
      ...(second ? [{ at: turnAt, sfx: 'whoosh', gain_db: -5 }, { at: land, sfx: 'thump', gain_db: -2 }] : []),
      { at: pushAt, sfx: 'swish', gain_db: -9 }]);
  const typeA = (f) => { for (const g of A) T.kinetic(f, g.ft, { by: 'line', at: -8, from: 'mask', spring: 'stiff', accent: second ? [] : g.acc }); };
  const typeB = (f) => {
    // the whole second half slams in on the landing downbeat, the accent word already lit
    B.forEach((g, i) => T.kinetic(f, g.ft, { by: 'word', at: land - 0.125 + i * 0.0625, stagger: 0.0625, from: 'scale', spring: SLAM, accent: g.acc }));
  };
  return {
    id, beats, ...c, cut: 'keep',
    draw(f) {
      const pA = M.clamp(f.lt / ((turnAt + SLIDE) * f.grid.spb));
      const pB = M.clamp((f.lt - (turnAt) * f.grid.spb) / ((beats - turnAt) * f.grid.spb));
      const p = second ? M.easeInOutCubic(f.since(turnAt) / (SLIDE * f.grid.spb)) : 0;
      const k = M.easeInOutCubic(f.since(pushAt) / (2 * f.grid.spb));
      const smear = Math.sin(Math.PI * p) * 0.55;
      const layer = (c2, dx, world, pp, withNear, kk) => {
        c2.save(); c2.translate(dx, 0);
        win.draw(f, kk, (box, cx) => { world(f, box, pp, cx); if (withNear && near) near(f, box, cx); }, c2);
        c2.restore();
      };
      if (p < 1) {
        if (p > 0) D.blurred(ctx, F, smear, (c2) => layer(c2, -p * F.w, worldA, pA, true, 0));
        else layer(ctx, 0, worldA, pA, true, 0);
        ctx.save(); ctx.translate(-p * F.w, 0);
        if (p > 0) T.quiet(() => typeA(f)); else typeA(f);
        ctx.restore();
      }
      if (second && p > 0) {
        if (p < 1) D.blurred(ctx, F, smear, (c2) => layer(c2, (1 - p) * F.w, worldB, pB, false, 0));
        else layer(ctx, 0, worldB, pB, false, k);
        if (p >= 1) {
          // a feathered bg band under the second half (it lands over the bright dawn), pushed off with the camera
          const sb = F.pick({ v: { x: 0, y: bottom.y - st.h * 0.12, w: F.w, h: F.h - bottom.y + st.h * 0.12 }, s: { x: 0, y: bottom.y - st.h * 0.1, w: F.w, h: F.h - bottom.y + st.h * 0.1 },
            h: { x: bottom.x - st.w * 0.1, y: 0, w: F.w - bottom.x + st.w * 0.1, h: F.h } });
          D.feather(ctx, sb, F.orient === 'h' ? 'r' : 'b', 'bg', { at: 0.5, alpha: 0.85 });
          typeB(f);
        }
      }
    },
  };
}
