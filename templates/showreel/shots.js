// shots.js: the showreel techniques built around a second move on their back half (a hand-off into the next shot)
// and a real composition per orientation: kinetic, grid, list, formats, end. Each technique gets E (the build
// environment from scene.js) and C (the shot's colour field from ink.js fieldInk). No technique ever just holds.

/** A fit's words/lines leaving up through their masks: pOut(index) in [0, 1]; drawn unlogged (in flight). */
export function maskUnit(E, u, ft, pIn, pOut, color, logRest = true) {
  const { ctx, theme, T } = E;
  if (pIn <= 0 || pOut >= 0.999) return;
  ctx.save(); ctx.beginPath();
  ctx.rect(u.x - ft.size, u.y - ft.cap - ft.size * 0.3, u.w + ft.size * 2, ft.cap + ft.size * 0.62); ctx.clip();
  const y = u.y + (1 - pIn) * ft.size * 1.05 - pOut * ft.size * 1.05;
  const o = { role: ft.role, size: ft.size, color, weight: ft.weight };
  T.drawText(ctx, theme, u.s, u.x, y, pOut > 0 || !logRest ? { ...o, log: false } : { ...o, rest: [u.x, u.y] });
  ctx.restore();
}

export function moreTech(E) {
  const { api, F, S, T, M, L, D, B, ctx, theme, spb, R, dotR, period, room, fitD, dsec, need, norm, q, TYPE, UI } = E;
  const pos = (v) => Math.max(0, v);
  const after = (lb, at, s = TYPE) => pos(M.sp(dsec(lb, at), s));
  /** Scale (x, y, r) about a centre and move the centre: the transform used for a growing hand-off unit. */
  const about = (pt, c, k, dx = 0, dy = 0) => [c[0] + dx + (pt[0] - c[0]) * k, c[1] + dy + (pt[1] - c[1]) * k, pt[2] * k];
  return {
    // Words mask up on 1/16 notes (one word per row in portrait, filling the safe height); the accent word lights
    // with a thump; on the back half every other word leaves up through its mask while the accent grows toward
    // the centre and hands off into the next shot.
    kinetic(s, i, nb, C) {
      const raw = need(s, i, 'lines'), words = raw.join(' ').split(/\s+/).filter(Boolean);
      const lines = F.orient !== 'h' && words.length > raw.length && words.length <= 6 ? words : raw;
      const fits = B.justifyFits(api, lines, L.inset(S, { t: S.h * 0.02, b: S.h * 0.02, l: S.w * 0.025, r: room })); // l: room for the 4 % accent punch
      const units = fits.flatMap((ft) => T.kineticUnits(ctx, theme, ft, 'word').map((u) => ({ ...u, ft })));
      const a0 = s.accent ? units.findIndex((u) => norm(u.s) === norm(s.accent)) : -1, ai = a0 >= 0 ? a0 : units.length - 1;
      const st = 0.25, accAt = q(Math.min(nb - 1.5, (units.length - 1) * st + 0.5)), exAt = Math.max(accAt + 0.5, nb - 0.75);
      const A = units[ai], aft = A.ft, ac = [A.x + A.w / 2, A.y - aft.cap / 2];
      const kMax = Math.min(1.3, (F.w * 0.92) / A.w), others = units.map((_, k) => k).filter((k) => k !== ai);
      const xf = (lb) => { const g = after(lb, exAt); return { k: 1 + (kMax - 1) * g, dx: (F.cx - ac[0]) * g * 0.6, dy: (S.y + S.h / 2 - ac[1]) * g * 0.6, g }; };
      return {
        events: [0, accAt, exAt],
        sfx: [...units.map((_, k) => ({ at: q(k * st), sfx: 'pop', gain_db: -8 })), { at: accAt, sfx: 'thump', gain_db: -4 }, { at: q(exAt), sfx: 'swish', gain_db: -10 }],
        draw(f) {
          others.forEach((k, o) => {
            const u = units[k], dt = f.since(k * st);
            if (dt > 0) maskUnit(E, u, u.ft, M.sp(dt, TYPE), after(f.lb, exAt + o * 0.0625), C.ink);
          });
          const dt = f.since(ai * st);
          if (dt <= 0) return;
          const { k, dx, dy, g } = xf(f.lb), punch = 1 + f.hit(accAt, 0.12) * 0.04;
          ctx.save(); ctx.translate(ac[0] + dx, ac[1] + dy); ctx.scale(k * punch, k * punch); ctx.translate(-ac[0], -ac[1]);
          maskUnit(E, A, aft, M.sp(dt, TYPE), 0, f.lb >= accAt ? C.hot : C.ink, g === 0);
          ctx.restore();
        },
        dot: (lb) => { const r = dotR(aft.size), { k, dx, dy } = xf(lb); return about([A.x + A.w + r * 1.5, A.y - r, r], ac, k, dx, dy); },
      };
    },
    // Letters on tiles that fill the safe area in two rows (reading order survives every aspect). One tile takes
    // the accent with a thump, the others flip shut in sequence, and the frame zooms through the accent tile.
    grid(s, i, nb, C) {
      const chars = [...need(s, i, 'text').replace(/\s+/g, '')].slice(0, 12), n = chars.length;
      const rowsN = n > 4 ? 2 : 1, cells = L.grid(S, n, { cols: Math.ceil(n / rowsN), gap: 16 * F.u });
      const fits = cells.map((c, k) => fitD(chars[k], L.inset(c, Math.min(c.w, c.h) * 0.16), { align: 'c', valign: 'c' }));
      const a0 = s.accent ? chars.findIndex((c) => norm(c) === norm(s.accent[0])) : -1, hi = a0 >= 0 ? a0 : Math.floor(n / 2);
      const PRE = 0.75, hiAt = 1, flipAt = Math.min(nb - 1.25, 1.75), zoomAt = flipAt + 0.5, endAt = nb + PRE;
      const order = cells.map((_, k) => k).filter((k) => k !== hi), r0 = Math.min(cells[hi].w, cells[hi].h) * 0.05;
      const zoom = (lb) => M.clamp(after(lb, zoomAt, UI));
      return {
        pre: PRE, // enters on a transition with most tiles already up
        events: [0, hiAt, flipAt, zoomAt],
        sfx: [...cells.map((_, k) => ({ at: q(k * 0.125), sfx: 'tick', gain_db: -14 })), { at: hiAt, sfx: 'thump', gain_db: -4 },
          { at: flipAt, sfx: 'tick', gain_db: -10 }, { at: zoomAt, sfx: 'swish', gain_db: -8 }],
        draw(f) {
          const lit = f.lb >= hiAt;
          order.forEach((k, o) => {
            const c = cells[k], p = M.sp(f.since(k * 0.125), UI), fl = after(f.lb, flipAt + o * 0.0625);
            if (p <= 0 || fl >= 0.999) return;
            const b = L.lerpBox(L.place(c, { w: 0, h: 0 }, 'c'), c, p), w = b.w * (1 - fl);
            D.fillBox(ctx, { x: b.x + (b.w - w) / 2, y: b.y, w, h: b.h }, C.tile, theme.radius * 0.6 * M.clamp(p) * (1 - fl));
            const ft = fits[k], l = ft.lines[0], col = lit ? C.dim : C.ink;
            if (fl <= 0) T.kinetic(f, ft, { by: 'line', at: k * 0.125 + 0.125, from: 'mask', spring: TYPE, color: col });
            else T.drawText(ctx, theme, l.s, l.x + l.w / 2, l.y, { role: ft.role, size: ft.size, align: 'c', sx: 1 - fl, color: col, log: false });
          });
          const c = cells[hi], p = M.sp(f.since(hi * 0.125), UI), z = zoom(f.lb);
          if (p <= 0) return;
          const base = L.lerpBox(L.place(c, { w: 0, h: 0 }, 'c'), c, p * (1 + (lit ? f.hit(hiAt, 0.1, UI) * 0.06 : 0)));
          D.fillBox(ctx, L.lerpBox(base, F.full, z), lit ? C.hot : C.tile, theme.radius * 0.6 * M.clamp(p) * (1 - z));
          const ft = fits[hi], l = ft.lines[0];
          if (z <= 0) { T.kinetic(f, ft, { by: 'line', at: hi * 0.125 + 0.125, from: 'mask', spring: TYPE, color: lit ? C.onHot : C.ink }); return; }
          // zoom through the letter: it grows about its own centre while the centre travels to the frame centre
          const kL = 1 + 11 * M.easeInOutCubic((f.lb - zoomAt) / (endAt - zoomAt)), lc = [l.x + l.w / 2, l.y - ft.cap / 2];
          ctx.save(); ctx.translate(M.lerp(lc[0], F.cx, z), M.lerp(lc[1], F.cy, z)); ctx.scale(kL, kL);
          T.drawText(ctx, theme, l.s, 0, ft.cap / 2, { role: ft.role, size: ft.size, align: 'c', color: C.onHot, log: false });
          ctx.restore();
        },
        dot: (lb) => { const c = cells[hi]; return [c.x + c.w - r0 * 2.4, c.y + r0 * 2.4, r0 * (1 - zoom(lb)), lb >= hiAt ? C.onHot : C.dot]; },
      };
    },
    // A full-height column of capabilities: every row has the same small size, the active row grows to the full
    // safe width as it masks in, and on the back half the rest leave up through their masks.
    list(s, i, nb, C) {
      const items = need(s, i, 'lines'), n = items.length, indent = R(2), pitch = S.h / n;
      const step = Math.max(0.25, Math.min(1, Math.floor(((nb - 1) / n) * 4) / 4)), exAt = Math.max((n - 1) * step + 0.75, nb - 0.75);
      const baseOf = (k) => S.y + (k + 1) * pitch - pitch * 0.14; // descender room under every row
      const boxOf = (k, h) => ({ x: S.x + indent, y: baseOf(k) - h, w: S.w - indent, h });
      const size = Math.min(...items.map((t, k) => fitD(t, boxOf(k, pitch * 0.4)).size));
      const big = items.map((t, k) => fitD(t, boxOf(k, pitch * 0.74), { max: S.h }).size / size);
      const fits = items.map((t, k) => fitD(t, boxOf(k, pitch * 0.4), { max: size }));
      const act = (lb, k) => after(lb, k * step) - (k < n - 1 ? after(lb, (k + 1) * step) : 0);
      const kOf = (lb, k) => 1 + (big[k] - 1) * act(lb, k), r0 = Math.min(indent * 0.22, dotR(size) * 1.4);
      const cyOf = (lb, k) => baseOf(k) - (fits[k].cap * kOf(lb, k)) / 2;
      return {
        events: [...items.map((_, k) => k * step), exAt].filter((b) => b < nb),
        sfx: [...items.map((_, k) => ({ at: q(k * step), sfx: 'pop', gain_db: -8 })), { at: q(exAt), sfx: 'swish', gain_db: -12 }].filter((m) => m.at < nb),
        draw(f) {
          const cur = Math.min(n - 1, Math.floor(f.lb / step));
          fits.forEach((ft, k) => {
            const dt = f.since(k * step), out = k === cur ? 0 : after(f.lb, exAt + Math.abs(k - cur) * 0.0625), l = ft.lines[0], kk = kOf(f.lb, k);
            if (dt <= 0) return;
            ctx.save(); ctx.translate(l.x, l.y); ctx.scale(kk, kk); ctx.translate(-l.x, -l.y);
            maskUnit(E, l, ft, M.sp(dt, TYPE), out, k === cur ? C.ink : C.dim);
            ctx.restore();
          });
        },
        dot: (lb) => { const cur = Math.min(n - 1, Math.max(0, Math.floor(lb / step))); return [S.x + r0, M.lerp(cyOf(lb, Math.max(0, cur - 1)), cyOf(lb, cur), cur ? after(lb, cur * step, UI) : 1), r0]; },
      };
    },
  };
}
