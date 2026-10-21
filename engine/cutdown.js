// cutdown.js: rebuild a timeline for a shorter edit (project.cutdowns[]). Pure; runs in Node and the page.
//
// build(api) always plans the FULL film (api.grid is the full grid), so scene ids match out/timeline.json of the
// main film. applyCutdown() then keeps a subset of those scenes and makes them sum to the cutdown's beats:
//   keep: [ids]  the named scenes, in film order (unknown ids are an error);
//   keep: 'auto' the first and last scenes, every scene marked cut:'keep', then the other scenes by priority
//                (scene.cut: number, higher first; default 0), ties in film order, while they fit.
// Scenes marked cut:'drop' are never kept by 'auto'. Leftover beats go to the kept 'fill' scene if there is one,
// otherwise the last kept scene is extended (its end state holds longer).
// A template that plans its own cutdown (it reads api.cutdown) returns {cutdownApplied: true} and is left alone.

const FILL_MIN = 2;
const beatsOf = (s) => (s.beats === 'fill' ? FILL_MIN : s.beats);
const sum = (scenes) => scenes.reduce((a, s) => a + beatsOf(s), 0);

/**
 * planCutdown(scenes, totalBeats, keep='auto') -> {kept: Scene[], dropped: string[], extend: {id, beats} | null}
 * Throws Error with a clear message when the kept scenes cannot fit totalBeats.
 */
export function planCutdown(scenes, totalBeats, keep = 'auto', id = 'cutdown') {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error(`cutdown "${id}": build() returned no scenes`);
  const ids = scenes.map((s) => s.id);
  let kept;
  if (Array.isArray(keep)) {
    const unknown = keep.filter((k) => !ids.includes(k));
    if (unknown.length) throw new Error(`cutdown "${id}": keep names unknown scene(s) ${unknown.map((u) => `"${u}"`).join(', ')} (scenes: ${ids.join(', ')})`);
    kept = scenes.filter((s) => keep.includes(s.id));
  } else if (keep === 'auto') {
    const last = scenes.length - 1;
    const must = new Set(scenes.map((s, i) => (i === 0 || i === last || s.cut === 'keep' ? i : -1)).filter((i) => i >= 0));
    let used = sum([...must].map((i) => scenes[i]));
    if (used > totalBeats + 1e-9) throw new Error(`cutdown "${id}": the first, last and cut:'keep' scenes need ${used} beats but the cutdown has ${totalBeats}; lengthen the cutdown or list keep:[...]`);
    const pri = (s) => (typeof s.cut === 'number' ? s.cut : 0);
    const cand = scenes.map((s, i) => i).filter((i) => !must.has(i) && scenes[i].cut !== 'drop')
      .sort((a, b) => pri(scenes[b]) - pri(scenes[a]) || a - b);
    for (const i of cand) { const b = beatsOf(scenes[i]); if (used + b <= totalBeats + 1e-9) { must.add(i); used += b; } }
    kept = scenes.filter((_, i) => must.has(i));
  } else throw new Error(`cutdown "${id}": keep must be "auto" or a list of scene ids`);
  const need = sum(kept);
  if (need > totalBeats + 1e-9) throw new Error(`cutdown "${id}": kept scenes need ${need} beats but the cutdown has ${totalBeats} (drop scenes or lengthen the cutdown)`);
  const hasFill = kept.some((s) => s.beats === 'fill');
  const rest = totalBeats - need;
  const tail = kept[kept.length - 1];
  const extend = !hasFill && rest > 1e-9 ? { id: tail.id, beats: tail.beats + rest } : null;
  const keptIds = new Set(kept.map((s) => s.id));
  return { kept, dropped: ids.filter((x) => !keptIds.has(x)), extend };
}

/**
 * applyCutdown(built, totalBeats, cutdown{id, keep}) -> new built {scenes, persistent, loop, cut:{id, kept, dropped, extended}}
 * The template's own build().poster refers to the full film and is dropped (compile() then uses the default
 * poster unless the cutdown sets one).
 */
export function applyCutdown(built, totalBeats, cutdown) {
  if (!cutdown) return built;
  if (built && built.cutdownApplied) return { ...built, poster: undefined, cut: { id: cutdown.id, kept: built.scenes.map((s) => s.id), dropped: [], extended: null, by: 'template' } };
  const { kept, dropped, extend } = planCutdown(built && built.scenes, totalBeats, cutdown.keep, cutdown.id);
  const scenes = kept.map((s) => (extend && s.id === extend.id ? { ...s, beats: extend.beats } : s));
  return { ...built, scenes, poster: undefined, cut: { id: cutdown.id, kept: scenes.map((s) => s.id), dropped, extended: extend, by: 'engine' } };
}
