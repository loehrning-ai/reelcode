// _smoke-ui: proves the UI blocks on captured screens (statement, uiShot, step, logo end card).
export default {
  id: '_smoke-ui',
  build(api) {
    const { data, B } = api;
    const st = B.statementBlock(api, { id: 'statement', text: data.statement.text, sub: data.statement.sub, beats: 4, layout: 'bleed' });
    const cursor = [{ at: 4.5, to: [0.62, 0.95] }, { at: 5.25, to: data.shot.click }, { at: 6, click: true }];
    const shot = B.uiShotBlock(api, { id: 'shot', screen: data.shot.screen, beats: 8, assemble: data.shot.pieces, zoom: data.shot.zoom, cursor,
      transition: { type: 'push', beats: 1, dir: 'u' } });
    const detail = B.uiShotBlock(api, { id: 'detail', screen: data.detail.screen, beats: 4, zoom: data.detail.zoom, label: data.detail.label,
      transition: { type: 'wipe', beats: 0.5, dir: 'l' } });
    const step = B.stepBlock(api, { id: 'step', n: 3, total: 3, title: data.step.title, body: data.step.body, beats: 4, transition: { type: 'slats', beats: 1 } });
    const cta = B.logoCtaBlock(api, { id: 'cta', beats: 'fill', name: data.cta.name, wordmark: !api.assets.logo, cta: data.cta.text, url: data.cta.url, transition: { type: 'iris', beats: 1 } });
    return { scenes: [st, shot, detail, step, cta] };
  },
};
