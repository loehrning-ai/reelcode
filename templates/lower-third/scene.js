// lower-third: broadcast graphics for use over footage. A sequence of overlays (name strap, topic bar, quote card,
// title overlay) on a transparent canvas: every pixel the template paints is an opaque plate, so the ProRes 4444
// export (`exports: ["prores-alpha"]`, template `transparent: true`) keys straight over an edit. With `content.demo`
// the same graphics are drawn over a pre-extracted clip (media.clipBlock) for a review mp4.
import { makeKit, slate, alphaRender } from './kit.js';
import { nameStrap, topicBar } from './bars.js';
import { quoteCard, titleCard } from './cards.js';

const KINDS = {
  name: { need: ['name'], make: nameStrap },
  topic: { need: ['label', 'texts'], make: topicBar },
  quote: { need: ['quote', 'author'], make: quoteCard },
  title: { need: ['title'], make: titleCard },
};
const FIELDS = { name: ['name', 'role', 'tag', 'side'], topic: ['label', 'texts', 'position'], quote: ['quote', 'author', 'role', 'side'], title: ['kicker', 'title', 'sub'] };
const COMMON = ['kind', 'id', 'beats', 'exit'];

/** Validate kind-specific fields (the content schema is one flat item shape). */
function checkItem(it, i) {
  const k = KINDS[it.kind];
  for (const f of k.need) if (it[f] === undefined) throw new Error(`content.items[${i}].${f}: required for kind "${it.kind}"`);
  for (const f of Object.keys(it)) if (!COMMON.includes(f) && !FIELDS[it.kind].includes(f)) throw new Error(`content.items[${i}].${f}: not used by kind "${it.kind}" (use ${FIELDS[it.kind].join(', ')})`);
  if (it.kind === 'topic' && !(it.texts.length >= 1)) throw new Error(`content.items[${i}].texts: at least one headline`);
}

/** Resolve beats: exactly one item may be "fill" (it takes what the others leave). */
function planBeats(items, total) {
  const fills = items.filter((it) => it.beats === 'fill').length;
  if (fills > 1) throw new Error('content.items: only one item may have beats "fill"');
  const fixed = items.reduce((a, it) => a + (it.beats === 'fill' ? 0 : it.beats), 0);
  return items.map((it) => (it.beats === 'fill' ? total - fixed : it.beats));
}

/**
 * The demo background: one clipBlock scene spanning the whole film, drawn under each graphic with the film clock,
 * so the footage runs continuously through the cuts between graphics.
 */
function demoLayer(api, demo) {
  if (!demo) return null;
  const sc = api.media.clipBlock(api, { id: 'demo-bg', beats: api.grid.totalBeats, clip: demo.clip, from: demo.from, rate: demo.rate ?? 1,
    loop: demo.loop ?? false, move: demo.move || 'push-in', amount: demo.amount ?? 0.06, focus: demo.focus, reveal: 'none' });
  return (f) => sc.draw({ ctx: f.ctx, theme: f.theme, grid: f.grid, F: f.F, lt: f.t, t: f.t,
    scene: { id: 'demo-bg', index: 0, beats: f.grid.totalBeats }, since: (b) => f.t - f.grid.beat(Number(b) || 0) });
}

export default {
  id: 'lower-third',
  build(api) {
    const { data, grid, M } = api;
    data.items.forEach(checkItem);
    const G = makeKit(api);
    const beats = planBeats(data.items, grid.totalBeats);
    const bg = demoLayer(api, data.demo) || (alphaRender() ? null : (f) => slate(G, f));
    const last = data.items.length - 1;
    const scenes = data.items.map((it, i) => {
      const nb = beats[i];
      if (!(nb >= 3)) throw new Error(`content.items[${i}].beats: ${nb} (each graphic needs at least 3 beats; the exit takes the last one)`);
      const exit = it.exit ?? i !== last;
      const E = exit ? M.quant(nb - 1) : undefined;
      const card = KINDS[it.kind].make(G, it, nb, E);
      return {
        id: it.id || `${it.kind}${i + 1}`, beats: it.beats, events: card.events, sfx: card.sfx, layout: card.layout,
        draw(f) { if (bg) bg(f); card.draw(f); },
      };
    });
    // poster: the first graphic fully at rest
    return { scenes, poster: Math.min(beats[0] - 1.5, 3) };
  },
};
