// _media: proves the media blocks end to end: photos (cover crop, Ken Burns, mask reveals, duotone), a pre-extracted
// video clip (trim + speed), lower thirds (in-scene and persistent) and an end card.
export default {
  id: '_media',
  build(api) {
    const { data, media, B } = api;
    const scenes = data.shots.map((s, i) => {
      const common = { id: s.id || `shot${i + 1}`, beats: s.beats, fit: s.fit, focus: s.focus, move: s.move, amount: s.amount,
        reveal: s.reveal, dir: s.dir, duotone: s.duotone, caption: s.caption, lower: s.lower, transition: s.transition };
      return s.clip ? media.clipBlock(api, { ...common, clip: s.clip, from: s.from, to: s.to, rate: s.rate, loop: s.loop })
        : media.imageBlock(api, { ...common, image: s.image });
    });
    scenes.push(B.logoCtaBlock(api, { id: 'end', beats: 'fill', logo: null, name: data.end.name, cta: data.end.cta, url: data.end.url,
      transition: { type: 'slats', beats: 1 } }));
    const persistent = data.overlay ? [media.lowerThird(api, { id: 'overlay', ...data.overlay })] : [];
    return { scenes, persistent };
  },
};
