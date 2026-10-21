// shots.js: the compare shot (two edge-to-edge trip tracks, numbers riding the bar heads) and the 24-hour clock
// shot for bars whose labels are hour ranges ("6–9"). Same builder contract as charts.js.
import { UI, smooth, numOpts, claimBlock, pill, pillBox } from './lib.js';
import { need, hiIndex } from './charts.js';
import { columns } from './columns.js';

/**
 * Compare, 4 beats. The carried pen dot stretches into the winner's track, which is already most of the way there and
 * still running; the other track races in beside it (beats 0-1), the winner turns accent on beat 1, the delta stamps
 * on beat 2, and beat 3 hands both tracks to the next shot. Tall frames (9:16, 4:5) run the tracks vertically from
 * the foot of the frame, the winner in the right column reaching the top, the giant numerals riding the track heads;
 * square and 16:9 run them edge to edge horizontally. The claim lands one beat in, after the morph.
 */
export function compare(api, pt, fmt, path) {
  const { F, ctx, theme, T, M, D } = api;
  const S = F.safe;
  const items = pt.items || [];
  need(items.length === 2 && items.every((d) => d.label !== undefined && typeof d.value === 'number'), path, 'compare needs items:[{label, value}, {label, value}]');
  const o = numOpts(pt), big = items[0].value >= items[1].value ? 0 : 1, max = Math.max(items[0].value, items[1].value) || 1;
  const kind = pt.delta || 'ratio', lo = items[1 - big].value;
  const deltaTxt = kind === 'none' ? '' : `${kind === 'ratio' ? fmt(lo ? max / lo : 0, { fmt: 'x', decimals: 1 }) : kind === 'pct' ? `+${fmt(lo ? (max / lo - 1) * 100 : 0, { fmt: 'pct' })}` : `+${fmt(max - lo, o)}`}${pt.deltaLabel ? ` ${pt.deltaLabel}` : ''}`;
  const tall = F.orient === 'v';
  const unit = (o.unit || '').trim(), uk = 0.4;
  const strs = items.map((d) => fmt(d.value, { ...o, unit: '' }));
  const capK = T.measure(ctx, theme, 'display', '0', 100).cap / 100;
  const w100 = (str) => T.measure(ctx, theme, 'display', str, 100).w / 100;
  const uw100 = unit ? T.measure(ctx, theme, 'display', unit, 100).w / 100 : 0;
  const totW = (i) => w100(strs[i]) + (unit ? 0.1 + uw100 * uk : 0);
  const labSize = T.readable(F, 1.2), pSize = T.readable(F, 1.25), gap = T.readable(F, 1.0);
  const winAt = 1, deltaAt = 2, beats = 4;
  const gOf = (f, i) => (i === big ? 0.8 + 0.2 * M.clamp(M.sp(f.since(0) + 0.1, smooth(1.0 * api.grid.spb)))
    : 0.2 + 0.8 * M.clamp(M.sp(f.since(0.25), smooth(1.4 * api.grid.spb))));
  const frac = (i) => items[i].value / max;
  const claim = claimBlock(api, pt, { x: S.x, y: S.y, w: S.w * F.pick({ v: 0.92, s: 0.8, h: 0.5 }), h: S.h * F.pick({ v: 0.13, s: 0.16, h: 0.16 }) },
    { scale: F.pick({ v: 2.0, s: 1.8, h: 2.0 }), valign: 't', at: 1 });
  let L;
  if (tall) {
    // columns: the winner on the right edge of the safe area, the other on the left edge; both numerals ride their
    // heads in the open middle (winner's hangs left of its head near the top, the other's right of its head lower down)
    const tw = S.w * 0.14, foot = S.y + S.h - labSize * 1.9, topY = claim.box.y + claim.box.h + gap * 1.4, len = foot - topY;
    const colX = [0, 0]; colX[big] = S.x + S.w - tw; colX[1 - big] = S.x;
    const mid = colX[big] - gap * 0.6 - (S.x + tw + gap * 0.6);
    const N = [0, 0];
    N[big] = Math.min(mid / totW(big), (len * (1 - frac(1 - big)) - gap) / (capK * 1.15));
    N[1 - big] = Math.min(mid / totW(1 - big), len * frac(1 - big) * 0.4 / capK);
    const rect = (i, g) => { const h = len * frac(i) * g; return { kind: 'rect', x: colX[i], y: foot - h, w: tw, h }; };
    L = { rect, N, right: (i) => i === big, numAt: (i, g) => { const r = rect(i, g); return { x: i === big ? r.x - gap * 0.6 : r.x + tw + gap * 0.6, y: Math.min(r.y + N[i] * capK, foot - gap * 0.2) }; },
      track: (i) => ({ x: colX[i], y: topY, w: tw, h: foot - topY }),
      label: (i) => ({ x: i === big ? colX[i] + tw - T.measure(ctx, theme, 'ui', String(items[i].label), labSize, 700).w : S.x, y: foot + labSize * 1.45, inside: false }),
      pBox: deltaTxt ? (() => { const r = rect(1 - big, 1); return pillBox(api, deltaTxt, pSize, S.x + tw + gap * 0.6, r.y + N[1 - big] * capK + gap * 0.9 + pSize * 1.05); })() : null };
  } else {
    const pw = deltaTxt ? pillBox(api, deltaTxt, pSize, 0, 0).w : 0;
    const inGap = !deltaTxt || S.x + S.w * frac(1 - big) + labSize + pw <= S.x + S.w;
    const pRow = inGap ? 0 : pSize * 2.1 + gap;
    const area = { x: S.x, y: claim.box.y + claim.box.h + gap, w: S.w, h: S.y + S.h - claim.box.y - claim.box.h - gap - pRow };
    const rowH = area.h / 2, barH = Math.max(labSize * 2.0, rowH * 0.2);
    const Nn = Math.min((rowH - barH - rowH * 0.1) / (capK * 1.1), (S.w * 0.92) / Math.max(totW(0), totW(1)));
    const barY = (i) => area.y + i * rowH + rowH - barH - rowH * 0.04;
    const rect = (i, g) => ({ kind: 'rect', x: F.full.x, y: barY(i), w: S.x + S.w * frac(i) * g - F.full.x, h: barH });
    L = { rect, N: [Nn, Nn], right: () => false, numAt: (i, g) => { const r = rect(i, g), w = totW(i) * Nn; return { x: Math.max(S.x, r.x + r.w - w), y: barY(i) - Nn * 0.16 }; },
      track: (i) => ({ x: F.full.x, y: barY(i), w: F.full.w, h: barH }),
      label: (i) => ({ x: S.x + labSize * 0.5, y: barY(i) + barH / 2 + labSize * 0.36, inside: true }),
      pBox: !deltaTxt ? null : inGap ? pillBox(api, deltaTxt, pSize, S.x + S.w * frac(1 - big) + labSize, barY(1 - big) + barH / 2) : pillBox(api, deltaTxt, pSize, S.x, S.y + S.h - pSize * 1.05) };
  }
  const events = [0.5, winAt, ...(L.pBox ? [deltaAt] : []), 3];
  const sfx = [{ at: 0, sfx: 'swish', gain_db: -11 }, { at: 0.25, sfx: 'tick', gain_db: -12 }, { at: winAt, sfx: 'thump', gain_db: -3 },
    ...(L.pBox ? [{ at: deltaAt, sfx: 'pop', gain_db: -5 }] : [])];
  const loCol = theme.mix('fg', 'muted', 0.55);
  // anticipation: in the last half beat both tracks swell across their axis (the bars themselves, no overlay), so
  // the cut never lands on a still; the swollen bars are what the clock takes
  const swellQ = (f) => M.easeInOutCubic(M.clamp((f.lb - (beats - 0.5)) / 0.5));
  const swell = (r, q) => (tall ? { ...r, x: r.x - (r.w * 0.35 * q) / 2, w: r.w * (1 + 0.35 * q) } : { ...r, y: r.y - (r.h * 0.35 * q) / 2, h: r.h * (1 + 0.35 * q) });
  return { beats, events, sfx,
    handOut: [{ ...swell(L.rect(big, 1), 1), color: 'accent' }, { ...swell(L.rect(1 - big, 1), 1), color: loCol }],
    handIn: (f) => ({ ...L.rect(big, gOf(f, big)), color: 'accent' }),
    draw(f, hp = 1) {
      claim.draw(f);
      const lp = M.clamp(M.sp(f.since(winAt), UI));
      items.forEach((d, i) => {
        const win = i === big, g = gOf(f, i);
        D.fillBox(ctx, L.track(i), 'surface');
        const col = win ? 'accent' : loCol;
        const b = swell(L.rect(i, g), swellQ(f));
        if (!(win && hp < 0.995) && b.w > 0.5 && b.h > 0.5) D.fillBox(ctx, b, col);
        const lb = L.label(i), lw = T.measure(ctx, theme, 'ui', String(d.label), labSize, 700).w;
        if (!lb.inside || (!(win && hp < 0.995) && b.x + b.w - S.x >= lw + labSize * 1.2)) T.drawText(ctx, theme, String(d.label), lb.x, lb.y, { role: 'ui', size: labSize, weight: 700, color: lb.inside ? 'bg' : 'fg' });
        if (win && hp < 0.995) return; // the number rides the head once the carried dot has become the track
        const N = L.N[i], s2 = fmt(d.value * g, { ...o, unit: '' }), sw = w100(s2) * N;
        const at = L.numAt(i, g), ncol = win ? theme.mix('fg', 'accent', lp) : 'fg';
        const x = L.right(i) ? at.x - (sw + (unit ? (0.1 + uw100 * uk) * N : 0)) : at.x;
        T.drawText(ctx, theme, s2, x, at.y, { role: 'display', size: N, color: ncol });
        if (unit) T.drawText(ctx, theme, unit, x + sw + N * 0.1, at.y, { role: 'display', size: N * uk, color: ncol });
      });
      if (L.pBox) pill(api, f, L.pBox, deltaTxt, pSize, deltaAt);
    } };
}

const HOURS = /^(\d{1,2})\s*[–-]\s*(\d{1,2})$/;
/** Hour ranges of every label, or null when the labels are not all "a–b" with 0 <= a < b <= 24. */
const hoursOf = (data) => {
  const hs = data.map((d) => HOURS.exec(String(d.label)));
  return hs.every((m) => m && +m[1] < +m[2] && +m[2] <= 24) ? hs.map((m) => [+m[1], +m[2]]) : null;
};

/**
 * Bars as a 24-hour clock: each hour range is a wedge whose length is its value, growing out from the hub on the
 * beat; the value and range sit on a ring outside the clock. The highlight wedge turns accent and the hub rolls from
 * "24 h" to the highlight range. Labels that are not hour ranges fall back to the bar shot (columns.js).
 */
export function bars(api, pt, fmt, path) {
  const data = pt.data || [];
  need(data.length >= 2 && data.length <= 8 && data.every((d) => d.label !== undefined && typeof d.value === 'number'), path, 'bars needs data:[{label, value}] (2-8 items)');
  const hrs = hoursOf(data);
  if (!hrs) return columns(api, pt, fmt, path);
  const { F, ctx, theme, T, M, D } = api;
  const S = F.safe, o = numOpts(pt), n = data.length, hi = hiIndex(data.map((d) => String(d.label)), pt.highlight === undefined ? undefined : String(pt.highlight));
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const side = F.orient === 'h';
  const cBox = side ? { x: S.x, y: S.y, w: S.w * 0.36, h: S.h } : { x: S.x, y: S.y, w: S.w, h: S.h * F.pick({ v: 0.2, s: 0.22 }) };
  const claim = claimBlock(api, pt, cBox, { scale: F.pick({ v: 2.3, s: 2.1, h: 2.5 }), valign: side ? 'c' : 't', at: 1 });
  const gap = T.readable(F, 1.0);
  const box = side ? { x: S.x + S.w * 0.4, y: S.y, w: S.w * 0.6, h: S.h } : { x: S.x, y: claim.box.y + claim.box.h + gap, w: S.w, h: S.y + S.h - claim.box.y - claim.box.h - gap };
  const valSize = T.readable(F, 1.1), labSize = T.readable(F, 1.0);
  const vCap = T.measure(ctx, theme, 'ui', '0', valSize, 700).cap, lCap = T.measure(ctx, theme, 'ui', '0', labSize).cap;
  const blockH = vCap + labSize * 0.55 + lCap;
  const blockW = Math.max(...data.map((d) => Math.max(T.measure(ctx, theme, 'ui', fmt(d.value, o), valSize, 700).w, T.measure(ctx, theme, 'ui', String(d.label), labSize).w)));
  const ring = valSize * 0.5;
  const R = Math.min((box.w - 2 * (blockW + ring)) / 2, (box.h - 2 * (blockH + ring)) / 2);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, r0 = R * 0.3;
  const ang = (h) => -Math.PI / 2 + (h / 24) * Math.PI * 2, gapA = 0.025;
  // the highlight wedge and the next one are the two carried tracks (already full on the cut); the rest grow from
  // the hub on the half beat after them
  const hk = hi === undefined ? 0 : hi, carried = [hk, (hk + 1) % n];
  const rest = data.map((_, i) => i).filter((i) => !carried.includes(i));
  const at0 = 0.5, stg = 0.5, done = at0 + stg * Math.max(0, rest.length - 1), hiAt = Math.ceil(done + 0.5), beats = hiAt + 2;
  const grow = smooth(0.55);
  const gOf = (f, i) => (carried.includes(i) ? 1 : M.clamp(M.sp(f.since(at0 + rest.indexOf(i) * stg) + 0.12, grow), 0, 1.02));
  const radius = (i, g) => r0 + (R - r0) * (data[i].value / max) * g;
  const mid = (i) => (ang(hrs[i][0]) + ang(hrs[i][1])) / 2;
  const events = [at0, done, ...(hi !== undefined ? [hiAt] : []), hiAt + 1];
  const sfx = [...rest.map((_, k) => ({ at: at0 + k * stg, sfx: 'tick', gain_db: -12 })), ...(hi !== undefined ? [{ at: hiAt, sfx: 'thump', gain_db: -3 }] : [])];
  const sector = (a0, a1, rIn, rOut, color) => {
    ctx.fillStyle = T.paint(theme, color); ctx.beginPath();
    ctx.arc(cx, cy, rOut, a0, a1); ctx.arc(cx, cy, rIn, a1, a0, true); ctx.closePath(); ctx.fill();
  };
  const wedge = (i, g, color) => ({ kind: 'sector', cx, cy, r0, r1: radius(i, g), a0: ang(hrs[i][0]) + gapA, a1: ang(hrs[i][1]) - gapA, color });
  const colOf = (i, hp) => (i === hi ? 'accent' : hi !== undefined ? theme.mix('fg', 'muted', hp * 0.6) : 'fg');
  const hub0 = '24 h', hub1 = hi === undefined ? hub0 : String(data[hi].label);
  const hubSize = Math.min(r0 * 0.75, (r0 * 1.5) / (Math.max(T.measure(ctx, theme, 'display', hub1, 100).w, T.measure(ctx, theme, 'display', hub0, 100).w) / 100));
  const hubCap = T.measure(ctx, theme, 'display', '0', hubSize).cap;
  // anticipation: the highlight slice pops out along its bisector in the last half beat (then flattens into the
  // lockup underline in the end shot)
  const popQ = (f) => M.easeInOutCubic(M.clamp((f.lb - (beats - 0.5)) / 0.5));
  const popD = R * 0.12, popOf = (i, q) => ({ dx: Math.cos(mid(i)) * popD * q, dy: Math.sin(mid(i)) * popD * q });
  const outWedge = (() => { const w = wedge(hk, 1, 'accent'), d = popOf(hk, 1); return { ...w, cx: w.cx + d.dx, cy: w.cy + d.dy }; })();
  return { beats, events, sfx, handOut: outWedge,
    handIn: () => carried.map((i, k) => wedge(i, 1, k === 0 ? (hi !== undefined ? 'accent' : 'fg') : theme.mix('fg', 'muted', 0.55))),
    draw(f, mp = 1) {
      claim.draw(f);
      const hp = hi !== undefined ? M.clamp(M.sp(f.since(hiAt), UI)) : 0;
      for (let h = 0; h < 24; h++) {
        const a = ang(h), l = h % 6 === 0 ? 0.22 : 0.1;
        D.line(ctx, [[cx + Math.cos(a) * r0 * (0.95 - l), cy + Math.sin(a) * r0 * (0.95 - l)], [cx + Math.cos(a) * r0 * 0.95, cy + Math.sin(a) * r0 * 0.95]], { color: 'muted', width: 3 * F.u, cap: 'butt' });
      }
      data.forEach((d, i) => {
        const a0 = ang(hrs[i][0]) + gapA, a1 = ang(hrs[i][1]) - gapA, g = gOf(f, i);
        sector(a0, a1, r0, R, 'surface');
        const col = i === carried[1] && hi !== undefined ? theme.mix('fg', 'muted', 0.55 + hp * 0.2) : colOf(i, hp);
        if (carried.includes(i) && mp < 0.995) return;
        const pq = i === hk && hi !== undefined ? popOf(i, popQ(f)) : null;
        if (pq) { ctx.save(); ctx.translate(pq.dx, pq.dy); }
        if (g > 0) sector(a0, a1, r0, radius(i, g), col);
        if (pq) ctx.restore();
        if (g <= 0.3) return; // labels land once the wedge has visibly grown (no '0' on an unborn wedge)
        // the value and the range on the ring outside the clock, anchored by angle so the block never crosses it
        const a = mid(i), rl = R + ring, x = cx + Math.cos(a) * rl, y = cy + Math.sin(a) * rl;
        const vTxt = fmt(d.value * M.clamp(g), o), vw = T.measure(ctx, theme, 'ui', fmt(d.value, o), valSize, 700).w, lw = T.measure(ctx, theme, 'ui', String(d.label), labSize).w;
        const top = y - blockH * (0.5 - 0.5 * Math.sin(a)), kx = 0.5 - 0.5 * Math.cos(a);
        T.drawText(ctx, theme, vTxt, x - vw * kx, top + vCap, { role: 'ui', size: valSize, weight: 700, color: i === hi ? theme.mix('fg', 'accent', hp) : 'fg' });
        T.drawText(ctx, theme, String(d.label), x - lw * kx, top + blockH, { role: 'ui', size: labSize, color: 'muted' });
      });
      // hub: "24 h" rolls up to the highlight range on the highlight beat (one line tall mask)
      if (mp < 0.995) return; // the hub label lands after the carried tracks have become wedges
      const by = cy + hubCap / 2;
      D.withClip(ctx, (c) => c.rect(cx - r0, by - hubCap - hubSize * 0.06, r0 * 2, hubCap + hubSize * 0.12), () => {
        const off = hubCap * 1.3;
        if (hp < 0.999) T.drawText(ctx, theme, hub0, cx, by - hp * off, { role: 'display', size: hubSize, align: 'c', color: 'muted' });
        if (hp > 0) T.drawText(ctx, theme, hub1, cx, by + (1 - hp) * off, { role: 'display', size: hubSize, align: 'c', color: 'accent', rest: [cx, by] });
      });
    } };
}
