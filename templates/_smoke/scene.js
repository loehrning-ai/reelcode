// _smoke: proves the runtime end to end. Layout, text fit, springs, a cursor, a chart, a counter, transitions.
export default {
  id: '_smoke',
  build(api) {
    const { F, data, theme, ctx, L, T, D, K, M, B } = api;

    const hook = B.kineticBlock(api, { id: 'hook', lines: data.hook.lines, beats: 4, by: 'word', from: 'mask', accentWord: data.hook.accent });

    // A custom scene: a prompt line and a button laid out from F.safe; the cursor clicks it on beat 2.
    const [top, mid] = L.split(F.safe, [0.42, 0.58], { axis: 'y', gap: 40 * F.u });
    const prompt = T.fitText(ctx, theme, data.button.prompt, { role: 'display', box: top, lines: 'auto', leading: 0.95, valign: 'b', min: T.readable(F, 1.4) });
    const labelSize = T.readable(F, 1.6);
    const btnW = T.measure(ctx, theme, 'ui', data.button.label, labelSize, 700).w + labelSize * 2.4;
    const btn = L.place(mid, { w: btnW, h: labelSize * 2.6 }, 'nw', { t: 24 * F.u, l: 0, r: 0, b: 0 });
    const plan = [{ at: 0.25, to: [btn.x + btn.w * 1.6, btn.y + btn.h * 3] }, { at: 1, to: 'btn' }, { at: 2, click: true }];
    const resolve = (to) => (to === 'btn' ? L.center(btn) : to);
    const click = {
      id: 'click', beats: 4, transition: { type: 'wipe', beats: 1, dir: 'l' },
      events: [1, 2, 3], sfx: [...K.clicks(plan), { at: 3, sfx: 'pop', gain_db: -8 }],
      draw(f) {
        T.kinetic(f, prompt, { by: 'word', at: 0, stagger: 0.25, from: 'mask' });
        const press = f.hit(2, 0.1);
        const on = f.on(2, 'stiff');
        const grow = M.sp(f.since(0.5), 'snap');
        const b = L.lerpBox(L.place(btn, { w: 0, h: btn.h }, 'w'), btn, M.clamp(grow, 0, 1.05));
        const pb = L.inset(b, b.h * 0.06 * press);
        D.fillBox(ctx, pb, on > 0.5 ? 'accent' : 'surface', pb.h / 2);
        D.withClip(ctx, (c) => c.rect(pb.x, pb.y, pb.w, pb.h), () =>
          T.drawText(ctx, theme, data.button.label, btn.x + labelSize * 1.2, btn.y + btn.h / 2 + labelSize * 0.36,
            { role: 'ui', size: labelSize, weight: 700, color: on > 0.5 ? 'bg' : 'fg' }));
        const done = f.on(3, 'med');
        if (done > 0) T.drawText(ctx, theme, '✓ 3 files', btn.x, btn.y + btn.h + labelSize * 1.8 + (1 - M.clamp(done)) * labelSize,
          { role: 'ui', size: labelSize * 0.8, color: 'muted' });
        K.drawCursor(ctx, theme, K.cursorAt(plan, f, resolve), F.u * 1.2);
      },
    };

    const chart = B.chartBlock(api, {
      id: 'chart', beats: 6, claim: data.chart.claim, transition: { type: 'iris', beats: 1, origin: [0.5, 0.6] },
      chart: { type: 'bars', data: data.chart.data, highlight: data.chart.highlight, unit: data.chart.unit },
    });
    const metric = B.metricBlock(api, { id: 'metric', beats: 4, ...data.metric, transition: { type: 'push', beats: 1, dir: 'l' } });
    const cta = B.logoCtaBlock(api, { id: 'cta', beats: 'fill', logo: null, name: data.cta.name, cta: data.cta.text, url: data.cta.url,
      transition: { type: 'slats', beats: 1 } });

    return { scenes: [hook, click, chart, metric, cta], persistent: [] };
  },
};
