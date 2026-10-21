// boundary.js: transitions CENTRED on the cut (template-level boundary contract).
// The engine runs a scene's transition from scene.start to start + beats, so its peak sits half a transition AFTER
// the cut while the whoosh hits ON the cut (the critic saw frozen frames under every whoosh). Here each non-cut
// transition is re-planned: it starts transition.beats/2 BEFORE the boundary, the outgoing scene keeps drawing
// through it, and the eased progress is exactly 0.5 on the boundary frame (wipe edge at mid-frame, push half way,
// slats half closed), so the motion peaks under the whoosh. The engine then sees a plain cut; the outgoing scene
// draws the composite in its last half transition and the incoming scene in its first, each one calling the other
// scene's raw draw with a frame re-based onto that scene's own clock. Pure functions of t, no state.

/** f re-based onto a scene that starts dBeats after f's scene (negative: before). Numeric or string time refs. */
function rebase(api, f, dBeats, beats, scene) {
  const g = f.grid, { M, G } = api;
  const start = g.at(f.t) - f.lb + dBeats;
  const t0 = g.beat(start), lt = f.t - t0, lb = g.at(f.t) - start;
  const secOf = (at) => g.beat(start + G.parseAt(at, g)) - t0;
  return Object.freeze({ ...f, lt, lb, p: M.clamp(lb / beats), scene,
    since: (at) => lt - secOf(at),
    hit: (at, len = 0.08, s = 'snap') => M.pulse(lt, secOf(at), len, s),
    on: (at, s = 'med') => M.sp(lt - secOf(at), s) });
}

/**
 * Paint the transition at eased progress e (0 = all outgoing, 1 = all incoming). Text drawn in a transition is
 * in flight, so it is not logged (T.quiet): the same exemption the engine gives its own transition frames.
 */
function composite(api, tr, e, drawOut, drawIn) { api.T.quiet(() => paint(api, tr, e, drawOut, drawIn)); }

function paint(api, tr, e, drawOut, drawIn) {
  const { ctx, F, D, theme } = api;
  const ground = () => { if (!api.alpha) { ctx.fillStyle = theme.colors.bg; ctx.fillRect(0, 0, F.w, F.h); } };
  if (tr.type === 'push') {
    const [dx, dy] = D.dirVec(tr.dir || 'l');
    ctx.save(); ctx.translate(dx * e * F.w, dy * e * F.h); ground(); drawOut(); ctx.restore();
    ctx.save(); ctx.translate(-dx * (1 - e) * F.w, -dy * (1 - e) * F.h); ground(); drawIn(); ctx.restore();
    return;
  }
  ctx.save(); drawOut(); ctx.restore();
  ctx.save(); ctx.beginPath(); D.mask(ctx, tr.type, e, F, tr); ctx.clip(); ground(); drawIn(); ctx.restore();
}

/**
 * centreTransitions(api, scenes) -> scenes: every scene whose transition is not a cut gets a centred transition
 * of transition.beats (default 1) and a whoosh ON its first beat; the engine is handed {type: 'cut'}.
 * Scenes must have numeric beats where a centred transition touches them (the 'fill' scene may only be last).
 */
export function centreTransitions(api, scenes) {
  const raw = scenes.map((s) => s.draw);
  const out = scenes.map((s) => ({ ...s }));
  scenes.forEach((s, i) => {
    const tr = s.transition;
    if (i === 0 || !tr || tr.type === 'cut') return;
    const T = { beats: 1, ...tr }, H = T.beats / 2;
    const prev = scenes[i - 1], pb = prev.beats;
    if (typeof pb !== 'number' || typeof s.beats !== 'number') throw new Error(`product-launch: centred transition into "${s.id}" needs numeric beats`);
    const prog = (lbOut) => api.M.easeInOutCubic((lbOut - (pb - H)) / T.beats);
    const sceneOf = (x, k) => ({ id: x.id, index: k, beats: x.beats });
    const outDraw = out[i - 1].draw, inDraw = out[i].draw;   // may already carry the previous boundary
    out[i - 1].draw = (f) => {
      if (f.lb < pb - H) return outDraw(f);
      composite(api, T, prog(f.lb), () => raw[i - 1](f), () => raw[i](rebase(api, f, pb, s.beats, sceneOf(s, i))));
    };
    out[i].draw = (f) => {
      if (f.lb >= H) return inDraw(f);
      const fo = rebase(api, f, -pb, pb, sceneOf(prev, i - 1));
      composite(api, T, prog(pb + f.lb), () => raw[i - 1](fo), () => raw[i](f));
    };
    out[i].transition = { type: 'cut' };
    out[i].centred = T;
    out[i].sfx = [{ at: 0, sfx: T.beats <= 0.5 ? 'swish' : 'whoosh', gain_db: -8 }, ...(out[i].sfx || [])];
  });
  return out;
}
