// social-ad: a 6-20 s social ad for photos, product renders or footage. Hook (big type over a full-bleed photo on
// frame 0, optionally sliding to a second photo like a train window) -> 2-3 shots, each entering as a transition OVER
// the outgoing shot (never over bare bg): a full-bleed photo/clip with a benefit plate, a photo/clip seen through the
// window frame with a pull-back reveal (shots[].frame), or a split-flap board (shots[].flap) -> the offer laid out per
// aspect straight on its photo, clearing in stages -> optional proof shot -> the CTA lockup as its own composition.
// With content.frame (an RGBA overlay with a window hole, one per aspect via overrides) the window is the spine: the
// hook is one camera pass through it and the end card snaps back out through it on the last beat.
// Captions sit in their own lane (api.captionTop); when they are on, shot plates are dropped (one line per moment).
// Cutdowns: stable ids (hook, <shot ids>, offer, cta) and cut hints (hook keep, offer 5, shots before the offer 3..,
// shots after it -1), so keep:"auto" and explicit keep lists both work. All copy, prices and media come from content.
import { hookScene, q } from './parts.js';
import { offerScene } from './offer.js';
import { ctaScene } from './cta.js';
import { windowFrame, frameShot, flapShot } from './window.js';
import { windowHook } from './hook.js';

// Default seams, by shot index: a train-window push, a horizontal wipe, slats. shots[].reveal overrides the type.
const SEAMS = [{ type: 'push', dir: 'l', beats: 0.75 }, { type: 'wipe', dir: 'l', beats: 1 }, { type: 'slats', beats: 1 }];
const MOVES = ['pan-l', 'push-in', 'pull-out'];

/** Shot ids: content id, else the media id; duplicates get -2, -3. */
function shotIds(shots) {
  const seen = {};
  return shots.map((s) => {
    const base = s.id || s.image || s.clip || (s.flap ? 'board' : 'shot');
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? `${base}-${seen[base]}` : base;
  });
}

/** Beats per section; shots without beats share what is left after hook, offer and an 8-beat CTA. */
export function planBeats(total, data) {
  const t = data.timing || {};
  const hook = t.hook ?? 8, offer = t.offer ?? 8, ctaMin = t.cta ?? 8;
  const fixed = data.shots.reduce((a, s) => a + (s.beats || 0), 0);
  const free = data.shots.filter((s) => !s.beats).length;
  const each = free ? Math.max(4, Math.floor(((total - hook - offer - ctaMin - fixed) / free) * 2) / 2) : 0;
  const shots = data.shots.map((s) => s.beats || each);
  const used = hook + offer + shots.reduce((a, b) => a + b, 0);
  if (total - used < 4) {
    throw new Error(`social-ad: hook ${hook} + shots ${shots.join('+')} + offer ${offer} leave ${total - used} beats for the CTA (need >= 4 of ${total}); lengthen the film or shorten timing/shots[].beats`);
  }
  return { hook, offer, shots, cta: total - used };
}

export default {
  id: 'social-ad',
  build(api) {
    const { data } = api;
    const total = api.grid.totalBeats;
    const plan = planBeats(total, data);
    const ids = shotIds(data.shots);
    if (['hook', 'offer', 'cta'].some((x) => ids.includes(x))) throw new Error('social-ad: shot ids may not be hook, offer or cta');
    const capsOn = Number.isFinite(api.captionTop);
    const win = windowFrame(api, data.frame);
    const before = [], after = [];
    data.shots.forEach((s, i) => {
      const k = i % 3;
      const seam = s.reveal === 'none' ? { type: 'cut' } : s.reveal ? { type: s.reveal, dir: s.dir || 'l', beats: 1 } : { ...SEAMS[k], ...(s.dir ? { dir: s.dir } : {}) };
      const cut = s.after ? -1 : 3 - i * 0.1;
      if (!s.flap && !s.image && !s.clip) throw new Error(`social-ad: shot "${ids[i]}" needs image, clip or flap`);
      if (s.frame && !win) throw new Error(`social-ad: shot "${ids[i]}" has frame:true but content.frame is not set`);
      const shot = s.flap ? flapShot(api, { id: ids[i], beats: plan.shots[i], shot: s, transition: seam, cut })
        : s.frame ? frameShot(api, { id: ids[i], beats: plan.shots[i], shot: { ...s, line: capsOn ? undefined : s.line }, win, transition: seam, cut })
        : api.media[s.clip ? 'clipBlock' : 'imageBlock'](api, {
        id: ids[i], beats: plan.shots[i], image: s.image, clip: s.clip, from: s.from, to: s.to, rate: s.rate, loop: s.loop,
        focus: s.focus, move: s.move || MOVES[k], amount: s.amount, reveal: 'none', transition: seam,
        duotone: s.duotone, caption: capsOn ? undefined : s.line, captionAt: 0.5, captionSide: s.side, lower: capsOn ? undefined : s.lower,
        cut: s.after ? -1 : 3 - i * 0.1,
      });
      (s.after ? after : before).push(shot);
    });
    const scenes = [
      win ? windowHook(api, { id: 'hook', beats: plan.hook, hook: data.hook, win }) : hookScene(api, { id: 'hook', beats: plan.hook, hook: data.hook }),
      ...before,
      { ...offerScene(api, { id: 'offer', beats: plan.offer, offer: data.offer }), transition: { type: 'wipe', dir: 'u', beats: 1 } },
      ...after,
      ctaScene(api, { id: 'cta', beats: 'fill', cta: data.cta, offer: data.cta.showPrice === false ? null : data.offer, offerData: data.offer, win: data.cta.frame === false ? null : win }),
    ];
    const offerStart = plan.hook + before.reduce((a, s) => a + s.beats, 0);
    return { scenes, persistent: [], poster: q(offerStart + 4.5) };
  },
};
