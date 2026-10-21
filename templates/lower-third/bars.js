// bars.js: the two strap graphics. Each builder runs once per format and returns {events, sfx, draw(f)} in local
// beats; E is the local beat where the exit starts (undefined = the graphic holds to the end of the film).
import { TYPE, fitAt, shift, inkH, life, resting, plate, words, chipLayout, cue, inScene } from './kit.js';

const A0 = -0.25;   // pre-roll: the accent bar is already rising on a scene's first frame

/**
 * name: a two-tier name strap. An accent bar rises at the inner edge, the name plate snaps out of it, the role tier
 * drops in under it and an optional tag chip pops above on beat 2. Exit: tag, role, name, bar, 1/8 beat apart.
 */
export function nameStrap(G, it, nb, E) {
  const { F, M, U, pad } = G;
  const side = it.side === 'r' ? 'r' : 'l';
  const maxW = (G.right - G.left) * F.pick({ v: 1, s: 0.84, h: 0.52 }) - G.bar - pad * 2;
  const name = fitAt(G, it.name, { size: U * F.pick({ v: 1.6, s: 1.55, h: 1.7 }), width: maxW, lines: 2 });
  const role = it.role ? fitAt(G, it.role, { role: 'ui', size: U, width: maxW, lines: 2, leading: 1.25 }) : null;
  const nameW = Math.ceil(name.box.w + pad * 2), nameH = Math.ceil(inkH(name) + pad * 1.7);
  const roleW = role ? Math.ceil(role.box.w + pad * 2) : 0, roleH = role ? Math.ceil(inkH(role) + pad * 1.1) : 0;
  const y2 = G.floor - roleH, y1 = y2 - nameH;
  const px = (w) => (side === 'l' ? G.left + G.bar : G.right - G.bar - w);
  const nameBox = { x: px(nameW), y: y1, w: nameW, h: nameH };
  const roleBox = role ? { x: px(roleW), y: y2, w: roleW, h: roleH } : null;
  const barBox = { x: side === 'l' ? G.left : G.right - G.bar, y: y1, w: G.bar, h: nameH + roleH };
  const nameFt = shift(name, nameBox.x + pad, y1 + pad * 0.85);
  const roleFt = role ? shift(role, roleBox.x + pad, y2 + pad * 0.55) : null;
  const tagAt = nb >= 4 ? 2 : 1;
  let tag = null;
  if (it.tag) {
    const probe = chipLayout(G, it.tag, 0, 0);
    tag = chipLayout(G, it.tag, side === 'l' ? G.left + G.bar : G.right - G.bar, y1 - G.gap - probe.box.h, { align: side });
  }
  const open = side === 'l' ? 'l' : 'r';
  const T0 = { bar: A0, name: A0 + 0.125, nameTx: A0 + 0.375, role: A0 + 0.375, roleTx: A0 + 0.625, tag: tagAt, tagTx: tagAt + 0.125 };
  const X = E === undefined ? {} : { tag: E, role: E, name: E + 0.125, bar: E + 0.25 };
  const events = [0, ...(tag ? [tagAt] : []), ...(E !== undefined ? [E] : [])].filter(inScene(nb));
  const sfx = [cue(G, 0, 'swish', -12), cue(G, 0.125, 'pop', -10), ...(role ? [cue(G, 0.375, 'tick', -14)] : []),
    ...(tag ? [cue(G, tagAt, 'pop', -8)] : []), ...(E !== undefined ? [cue(G, E, 'swish', -14)] : [])].filter(inScene(nb));
  return {
    events, sfx, layout: { nameBox, roleBox, barBox, tag: tag && tag.box },
    draw(f) {
      const nameP = life(G, f, T0.name, X.name), roleP = role ? life(G, f, T0.role, X.role) : 0;
      const n = plate(G, nameBox, nameP, open, G.ink.plate);
      const r = role ? plate(G, roleBox, roleP, open, G.tier) : null;
      plate(G, barBox, life(G, f, T0.bar, X.bar), 'b', 'accent');
      if (f.since(T0.nameTx) > 0) words(G, f, nameFt, n, { at: T0.nameTx, out: X.name, color: G.ink.ink });
      if (r && f.since(T0.roleTx) > 0) words(G, f, roleFt, r, { at: T0.roleTx, out: X.role, color: G.ink.ink, by: 'line' });
      if (tag) {
        const t = plate(G, tag.box, life(G, f, T0.tag, X.tag), 'b', G.chip.plate);
        if (t && f.since(T0.tagTx) > 0) words(G, f, tag.ft, t, { at: T0.tagTx, out: X.tag, color: G.chip.ink, by: 'line' });
      }
    },
  };
}

/**
 * topic: a full-width topic bar: an accent label chip and a headline band whose headline flips through `texts`
 * (old line rides up and out, the next masks in) with an accent timing rule along the band's foot.
 * 16:9 / 1:1 keep the chip inline at the left of the band; portrait stacks it on top of the band.
 */
export function topicBar(G, it, nb, E) {
  const { F, M, T, U, pad, ctx, theme } = G;
  const inline = F.orient !== 'v';
  const W = G.right - G.left;
  const probe = chipLayout(G, it.label, 0, 0);
  const headW = (inline ? W - probe.box.w : W) - pad * 2;
  const max = U * F.pick({ v: 1.3, s: 1.25, h: 1.35 });
  // One shared size for every headline: a single line when all of them fit on one at >= U*1.05, else two lines.
  const sizeAt = (lines) => Math.min(...it.texts.map((s) => T.tryFit(ctx, theme, s, { role: 'display', box: { x: 0, y: 0, w: headW, h: max * (1 + (lines - 1) * 1.03) + 0.5 },
    max, min: U, lines: lines > 1 ? 'auto' : 1, leading: 1.03 })).map((t) => (t.overflow ? 0 : t.size)));
  const one = sizeAt(1), nl = one >= U * 1.05 ? 1 : 2, size = nl === 1 ? one : Math.max(U, sizeAt(2));
  const raw = it.texts.map((s) => fitAt(G, s, { size, width: headW, lines: nl, leading: 1.03, min: size, balance: false }));
  const bandH = Math.ceil(Math.max(...raw.map(inkH)) + pad * 1.6);
  const top = it.position === 'top';
  const chipH = inline ? bandH : probe.box.h;
  const bandY = top ? G.top + (inline ? 0 : chipH) : G.floor - bandH;
  const band = { x: G.left + (inline ? probe.box.w : 0), y: bandY, w: W - (inline ? probe.box.w : 0), h: bandH };
  const chipY = inline ? bandY : (top ? G.top : bandY - chipH);
  const chip0 = chipLayout(G, it.label, G.left, chipY);
  const chip = inline ? { box: { ...chip0.box, h: bandH }, ft: shift(chip0.ft, 0, (bandH - chip0.box.h) / 2) } : chip0;
  const fits = raw.map((ft) => shift(ft, band.x + pad, band.y + (bandH - inkH(ft)) / 2));
  const n = fits.length, first = A0 + 0.5, span = (E ?? nb) - first;
  const flips = Array.from({ length: n - 1 }, (_, k) => M.quant(first + ((k + 1) * span) / n));
  const starts = [first, ...flips.map((x) => x + 0.125)], ends = [...flips, E];
  const rule = Math.max(3, Math.round(5 * F.u));
  const X = E === undefined ? {} : { band: E, chip: E + 0.125 };
  const events = [0, ...flips, ...(E !== undefined ? [E] : [])].filter(inScene(nb));
  const sfx = [cue(G, 0, 'swish', -12), cue(G, 0.125, 'pop', -10), ...flips.map((x) => cue(G, x, 'tick', -10)),
    ...(E !== undefined ? [cue(G, E, 'swish', -14)] : [])].filter(inScene(nb));
  return {
    events, sfx, layout: { band, chip: chip.box },
    draw(f) {
      const b = plate(G, band, life(G, f, A0, X.band), 'l', G.ink.plate);
      const c = plate(G, chip.box, life(G, f, A0 + 0.125, X.chip), 'b', G.chip.plate);
      if (c && f.since(A0 + 0.375) > 0) words(G, f, chip.ft, c, { at: A0 + 0.375, out: X.chip, color: G.chip.ink, by: 'line' });
      if (!b) return;
      for (let k = 0; k < n; k++) {
        if (f.since(starts[k]) <= 0) continue;
        const out = ends[k];
        if (k === n - 1 || resting(f, out)) { words(G, f, fits[k], b, { at: starts[k], out: k === n - 1 ? X.band : out, color: G.ink.ink, stagger: 0.0625 }); continue; }
        const up = M.clamp(M.sp(f.since(out), TYPE));
        if (up >= 1) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip(); ctx.translate(0, -up * bandH);
        for (const l of fits[k].lines) T.drawText(ctx, theme, l.s, l.x, l.y, { role: 'display', size: fits[k].size, color: G.ink.ink, log: false });
        ctx.restore();
      }
      // timing rule: how far the current headline is through its slot
      const k = Math.max(0, starts.filter((s) => f.since(s) > 0).length - 1);
      const slot = ((ends[k] ?? nb) - starts[k]) * f.grid.spb;
      const prog = M.clamp(f.since(starts[k]) / Math.max(0.1, slot));
      if (prog > 0) G.D.fillBox(ctx, { x: b.x, y: b.y + b.h - rule, w: b.w * prog, h: rule }, 'accent');
    },
  };
}
