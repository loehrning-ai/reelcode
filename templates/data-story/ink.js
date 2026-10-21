// ink.js: readable text colours. The helpers live in the engine (engine/text.js readableOn / plateOn); this file keeps
// the template's (api, ...) signatures. A theme key whose WCAG contrast against its background is below AA for its
// size (4.5, or 3 for >= 48 px) is mixed toward the theme's darkest/lightest key just far enough to pass, plus a margin
// for anti-aliasing (lint's text QA measures the real pixels). Colours stay theme-derived: no hex literals.
export const inkOn = (api, key, bgKey, size, margin = 0.3) => api.T.readableOn(api.theme, key, bgKey, size, { u: api.F.u, margin });

/** A filled plate (pill, chip) with text on it: the text takes fg or bg, whichever reads better on the fill; when
 *  neither passes AA at this size, the fill (not the text) moves away from the text colour until it does. */
export const plateOn = (api, fillKey, size) => api.T.plateOn(api.theme, fillKey, size, { u: api.F.u });
