// ink.js: readable text colours. The helpers live in the engine (engine/text.js readableOn / plateOn); this file keeps
// the template's (api, ...) signatures. A theme key whose WCAG contrast against its background is below AA for its
// size (4.5, or 3 for >= 48 px) is mixed toward the theme's darkest/lightest key just far enough to pass, plus a margin
// for anti-aliasing (lint's text QA measures the real pixels). Colours stay theme-derived: no hex literals.
export const inkOn = (api, key, bgKey, size, margin = 0.3) => api.T.readableOn(api.theme, key, bgKey, size, { u: api.F.u, margin });

/** A filled plate (pill, chip) with text on it: the text takes fg or bg, whichever reads better on the fill; when
 *  neither passes AA at this size, the fill (not the text) moves away from the text colour until it does. */
export const plateOn = (api, fillKey, size) => api.T.plateOn(api.theme, fillKey, size, { u: api.F.u });

/** The colour roles of a shot sitting on a colour field ('bg' default, 'accent' flood or 'fg' cream inversion):
 *  ink (main type), dim (secondary type), hot/onHot (highlight fill and the type on it), tile (quiet fill), dot. */
export function fieldInk(api, field = 'bg') {
  const mix = api.theme.mix;
  if (field === 'accent') return { field, ink: 'bg', dim: mix('bg', 'accent', 0.3), hot: 'bg', onHot: 'accent', tile: mix('accent', 'bg', 0.14), dot: 'bg' };
  if (field === 'fg') return { field, ink: 'bg', dim: mix('bg', 'fg', 0.38), hot: 'accent', onHot: 'bg', tile: mix('fg', 'bg', 0.1), dot: 'bg' };
  return { field: 'bg', ink: 'fg', dim: 'muted', hot: 'accent', onHot: 'bg', tile: 'surface', dot: 'accent' };
}
