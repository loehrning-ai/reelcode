// schema.js: dependency-free JSON-Schema subset validator + project resolution (brand presets, variants,
// cutdowns, per-format overrides). Runs in Node and the page.
// Supported: type, required, properties, additionalProperties(bool or schema), items, enum, const, pattern,
// minimum, maximum, minItems, maxItems, minLength, maxLength, default (not applied). No $ref/oneOf/anyOf.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeOk = (v, t) => {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
};
const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

/** validate(value, schema, path?) -> {ok, errors:[{path, msg}]} */
export function validate(value, schema, path = '') {
  const errors = [];
  walk(value, schema || {}, path, errors);
  return { ok: errors.length === 0, errors };
}

function walk(v, s, path, errors) {
  const err = (msg) => errors.push({ path: path || '(root)', msg });
  for (const k of ['$ref', 'oneOf', 'anyOf', 'allOf']) if (k in s) { err(`schema uses unsupported keyword ${k}`); return; }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeOk(v, t))) { err(`must be ${types.join(' or ')}`); return; }
  }
  if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const)) err(`must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) err(`must be one of ${s.enum.join(',')}`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) err(`must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) err(`must be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) err(`must match ${s.pattern}`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) err(`must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) err(`must be <= ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) err(`must have at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) err(`must have at most ${s.maxItems} items`);
    if (s.items) v.forEach((item, i) => walk(item, s.items, join(path, i), errors));
  }
  if (typeOf(v) === 'object') {
    for (const r of s.required || []) if (!(r in v)) errors.push({ path: join(path, r), msg: 'is required' });
    const props = s.properties || {};
    for (const [k, val] of Object.entries(v)) {
      if (props[k]) walk(val, props[k], join(path, k), errors);
      else if (s.additionalProperties === false) errors.push({ path: join(path, k), msg: 'is not allowed' });
      else if (isPlainObject(s.additionalProperties)) walk(val, s.additionalProperties, join(path, k), errors);
    }
  }
}

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge into a NEW object: objects merge recursively; arrays and scalars replace. */
export function deepMerge(...layers) {
  let out = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    const next = { ...out };
    for (const [k, v] of Object.entries(layer)) {
      next[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v)
        : isPlainObject(v) ? deepMerge(v) : Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;
    }
    out = next;
  }
  return out;
}

// Keys a per-format override may not touch: every format shares one timeline and one mix.
const NO_OVERRIDE = ['template', 'page', 'formats', 'audio', 'duration', 'bpm', 'loop', 'variants', 'cutdowns', 'exports', 'clips', 'prepare', 'transparent'];
const NO_OVERRIDE_WHY = {
  duration: 'every format shares one timeline and one mix; use cutdowns:[{id, duration, keep}] for a shorter edit',
  bpm: 'every format shares one beat grid and one mix',
  loop: 'every format shares one timeline and one mix',
};
const fmtErrors = (prefix, errs) => errs.map((e) => `${prefix}${e.path}: ${e.msg}`);
const BRAND_REF = /^@([a-z0-9][a-z0-9-]{0,40})$/;
const PRESET_META = ['$schema', 'id', 'description'];

/** Synthetic template for a bespoke-page project (project.page): no defaults, no content schema, no requirements. */
export const PAGE_TEMPLATE = Object.freeze({ id: null, page: true, requires: [], defaults: {} });

// ---------- brand presets ----------
const refId = (v) => { const m = typeof v === 'string' && BRAND_REF.exec(v); return m ? m[1] : null; };
const brandLayerRefs = (b) => [refId(b), isPlainObject(b) ? refId(b.extends) : null].filter(Boolean);

/**
 * brandIds(project, template?, have = {}) -> preset ids referenced (directly or through loaded presets) but not in `have`.
 * Loaders call it in a loop: load each id into have, call again until it returns [] (presets may extend presets).
 */
export function brandIds(project, template, have = {}) {
  const layers = [template && template.defaults && template.defaults.brand, project && project.brand,
    ...((project && Array.isArray(project.variants) ? project.variants : []).map((v) => v && v.overrides && v.overrides.brand))];
  const seen = new Set(), out = [];
  const visit = (b, depth) => {
    for (const id of brandLayerRefs(b)) {
      if (seen.has(id) || depth > 8) continue;
      seen.add(id);
      if (have[id] === undefined) out.push(id); else visit(have[id], depth + 1);
    }
  };
  for (const b of layers) visit(b, 0);
  return out;
}

/** Expand one brand layer: "@id" -> preset; {extends:"@id", ...partial} -> preset <- partial. Throws on missing/cyclic presets. */
export function expandBrand(b, brands = {}, chain = []) {
  if (b === undefined || b === null) return b;
  const id = refId(b) || (isPlainObject(b) ? refId(b.extends) : null);
  if (typeof b === 'string' && !id) throw new Error(`brand "${b}" must be "@<preset id>" or an object`);
  if (!id) return deepMerge(b);
  if (chain.includes(id)) throw new Error(`brand preset cycle: ${[...chain, id].map((x) => '@' + x).join(' -> ')}`);
  const preset = brands[id];
  if (!isPlainObject(preset)) throw new Error(`brand preset "@${id}" not found (brands/${id}.json)`);
  const clean = Object.fromEntries(Object.entries(preset).filter(([k]) => !PRESET_META.includes(k)));
  const basePreset = expandBrand(clean, brands, [...chain, id]);
  if (typeof b === 'string') return basePreset;
  const { extends: _x, ...partial } = b;
  return deepMerge(basePreset, partial);
}

/** Brand of the merged layers: a "@id"/extends layer replaces what came before; a plain partial deep-merges onto it. */
function layeredBrand(layers, brands) {
  let cur;
  for (const b of layers) {
    if (b === undefined) continue;
    const ref = typeof b === 'string' || (isPlainObject(b) && b.extends !== undefined);
    cur = ref || !isPlainObject(cur) ? expandBrand(b, brands) : deepMerge(cur, b);
  }
  return cur;
}

// ---------- renditions (variant x cutdown) ----------
const list = (v) => (Array.isArray(v) ? v : []);
/** A project with no variants and no cutdowns keeps the v1 paths (out/<fmt>/, audio/). */
export const isLegacyLayout = (project) => !list(project && project.variants).length && !list(project && project.cutdowns).length;

/**
 * renditionDirs(project, variant='main', cutdown='full') -> {legacy, variant, cutdown, out, audio} (project-relative).
 * legacy: out='out', audio='audio'. Otherwise out='out/<variant>/<cutdown>', audio='audio' for main/full and
 * 'audio/<variant>/<cutdown>' for every other rendition (each has its own music length, cues and mix).
 */
export function renditionDirs(project, variant = 'main', cutdown = 'full') {
  const v = variant || 'main', c = cutdown || 'full';
  if (isLegacyLayout(project) && v === 'main' && c === 'full') return { legacy: true, variant: v, cutdown: c, out: 'out', audio: 'audio' };
  return { legacy: false, variant: v, cutdown: c, out: `out/${v}/${c}`, audio: v === 'main' && c === 'full' ? 'audio' : `audio/${v}/${c}` };
}

/** Every rendition of a project: main + variants, each x full + cutdowns. */
export function renditions(project) {
  const vs = ['main', ...list(project && project.variants).map((v) => v && v.id).filter(Boolean)];
  const cs = ['full', ...list(project && project.cutdowns).map((c) => c && c.id).filter(Boolean)];
  return vs.flatMap((variant) => cs.map((cutdown) => ({ variant, cutdown })));
}

function renditionChecks(project, errors) {
  const ids = (arr, reserved, what) => {
    const seen = new Set();
    list(arr).forEach((x, i) => {
      if (!x || typeof x.id !== 'string') return;
      if (x.id === reserved) errors.push(`project.${what}[${i}].id: "${reserved}" is reserved`);
      if (seen.has(x.id)) errors.push(`project.${what}[${i}].id: duplicate id "${x.id}"`);
      seen.add(x.id);
    });
  };
  ids(project.variants, 'main', 'variants');
  ids(project.cutdowns, 'full', 'cutdowns');
  list(project.cutdowns).forEach((c, i) => {
    if (c && Array.isArray(c.keep) && !c.keep.length) errors.push(`project.cutdowns[${i}].keep: must name at least one scene`);
  });
}

/**
 * resolveProject(project, template, format?, {variant, cutdown, brands}?) -> {base, resolved, errors[], cutdown, fullDuration, dirs}
 *
 * Layers, in order: template.defaults <- project <- variants[variant].overrides <- cutdown {duration, poster}
 * (= base, validated against PROJECT_SCHEMA after brand presets are expanded) <- overrides[format] (= resolved).
 * `brands` maps preset id -> brands/<id>.json contents (load the ids from brandIds() first).
 * `template` may be PAGE_TEMPLATE (or null) for a bespoke-page project.
 * cutdown: the selected cutdown spec {id, duration, keep, poster} or null; fullDuration: the uncut duration.
 */
export function resolveProject(project, template, format, opts = {}) {
  const errors = [];
  if (!isPlainObject(project)) return { base: null, resolved: null, errors: ['project.json: must be an object'], cutdown: null, fullDuration: null, dirs: null };
  const { variant = 'main', cutdown = 'full', brands = {} } = opts;
  const page = typeof project.page === 'string';
  if (page && project.template !== undefined) errors.push('project: set either template or page, not both');
  if (!page && project.template === undefined) errors.push('project.template: is required (or set page for a bespoke page)');
  if (!page && project.content === undefined) errors.push('project.content: is required');
  if (template && project.template && template.id && template.id !== project.template)
    errors.push(`project.template "${project.template}" does not match template.json id "${template.id}"`);
  renditionChecks(project, errors);

  let vspec = null;
  if (variant && variant !== 'main') {
    vspec = list(project.variants).find((v) => v && v.id === variant) || null;
    if (!vspec) errors.push(`variant "${variant}" is not in project.variants (${['main', ...list(project.variants).map((v) => v && v.id)].join(', ')})`);
  }
  let cspec = null;
  if (cutdown && cutdown !== 'full') {
    cspec = list(project.cutdowns).find((c) => c && c.id === cutdown) || null;
    if (!cspec) errors.push(`cutdown "${cutdown}" is not in project.cutdowns (${['full', ...list(project.cutdowns).map((c) => c && c.id)].join(', ')})`);
  }
  const vo = (vspec && isPlainObject(vspec.overrides)) ? vspec.overrides : {};
  const defaults = (template && template.defaults) || {};
  const { brand: _vb, ...voRest } = vo;
  let base = deepMerge(defaults, project, voRest);
  try {
    const brand = layeredBrand([defaults.brand, project.brand, vo.brand], brands);
    if (brand !== undefined) base.brand = brand;
  } catch (e) { errors.push(`project.brand: ${e.message}`); }
  const fullDuration = base.duration;
  if (cspec) {
    if (typeof fullDuration === 'number' && typeof cspec.duration === 'number' && cspec.duration > fullDuration)
      errors.push(`project.cutdowns "${cspec.id}": duration ${cspec.duration}s is longer than the film (${fullDuration}s)`);
    base = { ...base, duration: cspec.duration };
    if (cspec.poster !== undefined) base.poster = cspec.poster; else delete base.poster;
  }
  errors.push(...fmtErrors('project.', validate(base, PROJECT_SCHEMA).errors).map((e) => e.replace('project.(root)', 'project')));
  let resolved = base;
  if (format) {
    if (Array.isArray(base.formats) && !base.formats.includes(format)) errors.push(`format ${format} is not listed in project.formats`);
    const ov = (base.overrides && base.overrides[format]) || {};
    for (const k of NO_OVERRIDE) if (k in ov) errors.push(`project.overrides.${format}.${k}: may not be overridden per format${NO_OVERRIDE_WHY[k] ? ` (${NO_OVERRIDE_WHY[k]})` : ''}`);
    const clean = Object.fromEntries(Object.entries(ov).filter(([k]) => !NO_OVERRIDE.includes(k)));
    const { brand: ob, ...obRest } = clean;
    resolved = deepMerge(base, obRest);
    if (ob !== undefined) {
      try { resolved.brand = layeredBrand([base.brand, ob], brands); } catch (e) { errors.push(`project.overrides.${format}.brand: ${e.message}`); }
    }
    delete resolved.overrides;
  }
  if (template && template.content_schema)
    errors.push(...fmtErrors('', validate(resolved.content, template.content_schema, 'content').errors));
  const cut = cspec ? Object.freeze({ id: cspec.id, duration: cspec.duration, keep: cspec.keep === undefined ? 'auto' : cspec.keep, poster: cspec.poster }) : null;
  return { base, resolved, errors, cutdown: cut, fullDuration, dirs: renditionDirs(project, variant, cutdown) };
}

// Copy of docs/project.schema.json (a unit test asserts deep equality).
export const PROJECT_SCHEMA = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"reelcode/project.v1","title":"reelcode project.json","description":"Validated by engine/schema.js (subset: type, required, properties, additionalProperties(bool or schema), items, enum, const, pattern, minimum, maximum, minItems, maxItems, minLength, maxLength, default). Template defaults, brand presets (brands/<id>.json), the selected variant and cutdown are applied before validation; content is validated separately against templates/<template>/template.json content_schema. A project names exactly one of template or page (checked in code), and content is required with a template (checked in code).","type":"object","required":["title","formats","brand"],"additionalProperties":false,"properties":{"$schema":{"type":"string"},"template":{"type":"string","pattern":"^_?[a-z0-9][a-z0-9-]*$","description":"A folder in templates/. Exactly one of template or page."},"page":{"type":"string","pattern":"^(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\\.html$","description":"Bespoke page (relative to the project) for a one-off film: honours window.seek(t), canvas #c and ?project&format&w&h&mode&variant&cutdown. Exactly one of template or page."},"title":{"type":"string","minLength":1,"maxLength":120},"seed":{"type":"integer","minimum":0,"default":7},"duration":{"type":"number","minimum":2,"maximum":180,"description":"Seconds; snapped to whole bars: totalBeats = 4*round(duration*bpm/240). Shared by every format (no per-format duration; use cutdowns)."},"bpm":{"type":"number","minimum":60,"maximum":180},"loop":{"type":"boolean","default":false},"formats":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string","enum":["9x16","1x1","4x5","16x9"]}},"brand":{"type":["string","object"],"required":["colors","fonts"],"additionalProperties":false,"properties":{"extends":{"type":"string","pattern":"^@[a-z0-9][a-z0-9-]{0,40}$","description":"Brand preset to start from (brands/<id>.json); removed after expansion."},"name":{"type":"string"},"colors":{"type":"object","required":["bg","fg","accent"],"additionalProperties":false,"properties":{"bg":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"fg":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"muted":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"surface":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"},"accent2":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$","description":"Only honoured when brand.multiAccent is true."}}},"multiAccent":{"type":"boolean","default":false},"fonts":{"type":"object","required":["display","ui"],"additionalProperties":false,"properties":{"display":{"type":"object","required":["family"],"additionalProperties":false,"properties":{"family":{"type":"string","minLength":1},"weight":{"type":"integer","minimum":100,"maximum":900,"default":800},"tracking":{"type":"number","minimum":-0.1,"maximum":0.3,"default":-0.03}}},"ui":{"type":"object","required":["family"],"additionalProperties":false,"properties":{"family":{"type":"string","minLength":1},"weight":{"type":"integer","minimum":100,"maximum":900,"default":400},"tracking":{"type":"number","minimum":-0.1,"maximum":0.3,"default":0.02}}}}},"logo":{"type":"string","pattern":"^(assets/|brands/[a-z0-9][a-z0-9-]*/)[^.][^\\s]*\\.(png|svg|jpg|jpeg|webp)$","description":"Project-relative (assets/...) or a preset file (brands/<id>/...)."},"radius":{"type":"number","minimum":0,"maximum":200},"springs":{"type":"object","additionalProperties":false,"properties":{"soft":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"number","minimum":0.01,"maximum":10}},"med":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"number","minimum":0.01,"maximum":10}},"stiff":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"number","minimum":0.01,"maximum":10}},"snap":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"number","minimum":0.01,"maximum":10}}},"description":"Override the named spring presets. Each is [response, damping]: response = seconds for one swing of the undamped spring, damping = damping ratio (1 = no overshoot, < 1 overshoots)."}},"pattern":"^@[a-z0-9][a-z0-9-]{0,40}$","description":"\"@id\" (brands/<id>.json) or an object; {extends:\"@id\", ...partial} deep-merges the partial onto the preset. Validated after the presets are expanded."},"assets":{"type":"object","description":"id -> project-relative path under assets/.","additionalProperties":true},"clips":{"type":"object","description":"id -> local video clip, pre-extracted to a PNG sequence (assets/clips/<id>/) by engine/cli/lib/clips.mjs (deterministic seek). src must stay inside the project.","additionalProperties":{"type":"object","required":["src"],"additionalProperties":false,"properties":{"src":{"type":"string","minLength":1,"description":"Project-relative video file (not under assets/clips/)."},"from":{"type":"number","minimum":0,"description":"In-point, seconds (default 0)."},"to":{"type":"number","minimum":0,"description":"Out-point, seconds (default: clip end)."},"fps":{"type":"integer","minimum":1,"maximum":120,"description":"Extraction rate (default 30)."},"width":{"type":"integer","minimum":16,"maximum":3840,"description":"Extraction width in px (height keeps the aspect)."}}}},"prepare":{"type":"array","maxItems":16,"description":"Generator steps make runs before anything else, so a project ships as text and builds its own assets (procedural images, a sectioned score, UI captures). Each step has exactly one of run or capture.","items":{"type":"object","required":["creates"],"additionalProperties":false,"properties":{"run":{"type":"string","pattern":"^(?!.*\\.\\.)(\\./)?[A-Za-z0-9_][A-Za-z0-9_./-]*\\.py$","description":"Python script, relative to the repository root (or to the project when it starts with ./), run with the reelcode venv python (-I) from the repository root."},"capture":{"type":"string","minLength":1,"description":"capture source (fixture:<name>, http://localhost:PORT/..., http://127.0.0.1:PORT/... or a local .html file); runs reelcode capture into this project."},"args":{"type":"array","maxItems":32,"items":{"type":"string"},"description":"Arguments. {project} expands to the project folder, {plan} to the planning copy (see plan)."},"creates":{"type":"array","minItems":1,"maxItems":64,"items":{"type":"string","pattern":"^(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_./-]*$"},"description":"Project-relative files the step writes. The step runs only when one of them is missing (make --force reruns it)."},"plan":{"type":"object","additionalProperties":false,"properties":{"audio":{"type":"object"}},"description":"Run make --only audio on a temporary copy of the project with these settings first (for example {\"audio\": {\"music\": \"synth\"}}), so a score generator can read its out/timeline.json and audio/cues.json via {plan}."}}}},"content":{"type":"object","description":"Template-specific; validated by template.json content_schema."},"audio":{"type":"object","additionalProperties":false,"properties":{"music":{"type":"string","minLength":1,"description":"\"synth\", \"none\" (no music bed: sfx and voice-over only, on the nominal grid) or a project-relative path to a supplied track (e.g. audio/track.wav)."},"musicStart":{"type":"number","minimum":0,"default":0,"description":"Supplied track only: seconds cut from the start (exact sample); beats are measured after the cut. make warns when it is not on a downbeat."},"fit":{"type":"string","enum":["trim","loop","fade-bar"],"description":"Supplied track only (engine/audio/fit.py): trim = cut at the film end (refuses a short track); loop = repeat whole bars to fill; fade-bar = fade across the last bar (refused for loop:true films). Omitted: the track is used as is."},"style":{"type":"string","enum":["minimal-tech","punchy-pop","ambient-cinematic","lofi"]},"key":{"type":"string","pattern":"^[A-G](#|b)? (major|minor)$"},"sfx":{"type":"boolean","default":true},"sfxDensity":{"type":"string","enum":["sparse","normal","busy"],"default":"normal"},"lufs":{"type":"number","minimum":-24,"maximum":-9,"default":-14},"voiceover":{"type":"object","additionalProperties":false,"description":"Voice-over (engine/cli/lib/voiceover.mjs buildVoiceover). Ducks music+sfx under the voice.","properties":{"engine":{"type":"string","enum":["say","file","elevenlabs"],"description":"Required. file = your own recording inside the project (segments from <stem>.segments.json, else detected speech paired with lines); elevenlabs = remote TTS, only when the ELEVENLABS_API_KEY environment variable is set (never in project.json or a file); say = local macOS TTS, one synthesis per line (cached in audio/.voice-cache/). Apple licenses the macOS voices for personal, non-commercial use only: never publish say audio."},"voice":{"type":"string","minLength":1,"description":"Engine voice name (say: \"say -v ?\" lists local voices, default Samantha; an unknown say voice is an error)."},"file":{"type":"string","pattern":"^(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\\.(wav|aiff|aif|mp3|m4a)$","description":"engine:\"file\": project-relative recording."},"lines":{"type":"array","maxItems":64,"items":{"type":"object","required":["text"],"additionalProperties":false,"properties":{"text":{"type":"string","minLength":1,"maxLength":400},"at":{"type":["number","string","object"],"pattern":"^(b-?\\d+(\\.\\d+)?|bar\\d+(\\.\\d+)?|s-?\\d+(\\.\\d+)?)$","description":"Time ref (beats; \"b3.5\" | \"bar2\" | \"s1.25\") from the film start, or {scene, at} local to a scene, which follows the scene in every cutdown (a line whose scene a cutdown drops is dropped there). Default: after the previous line.","required":["scene"],"additionalProperties":false,"properties":{"scene":{"type":"string","minLength":1,"description":"Scene id (out/timeline.json)."},"at":{"type":["number","string"],"pattern":"^(b-?\\d+(\\.\\d+)?|bar\\d+(\\.\\d+)?|s-?\\d+(\\.\\d+)?)$","description":"Time ref local to the scene (default 0)."}}}}}},"duck_db":{"type":"number","minimum":-30,"maximum":0,"default":-9,"description":"Music+sfx gain under the voice."}},"required":["engine"]}}},"captions":{"type":"object","additionalProperties":false,"description":"Burned-in captions (engine/captions.js drawCaptions) and SRT/VTT sidecars (engine/cli/lib/captions.mjs writeSidecars).","properties":{"enabled":{"type":"boolean","default":false,"description":"Draw captions on the picture."},"style":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,31}$","default":"clean"},"source":{"type":"string","enum":["voiceover","manual"],"default":"voiceover"},"sidecars":{"type":"boolean","default":true,"description":"Write captions.srt and captions.vtt next to the videos."},"lines":{"type":"array","maxItems":128,"items":{"type":"object","required":["text","at"],"additionalProperties":false,"properties":{"text":{"type":"string","minLength":1,"maxLength":200},"at":{"type":["number","string"],"pattern":"^(b-?\\d+(\\.\\d+)?|bar\\d+(\\.\\d+)?|s-?\\d+(\\.\\d+)?)$"},"end":{"type":["number","string"],"pattern":"^(b-?\\d+(\\.\\d+)?|bar\\d+(\\.\\d+)?|s-?\\d+(\\.\\d+)?)$"}}}}}},"poster":{"type":["number","string"],"pattern":"^(b\\d+(\\.\\d+)?|bar\\d+|s\\d+(\\.\\d+)?)$","description":"Time ref: number = beats, or \"b3.5\" | \"bar2\" | \"s1.25\". The pattern applies to string values only."},"quality":{"type":"string","enum":["draft","final"],"default":"draft"},"variants":{"type":"array","maxItems":24,"description":"Alternate versions of the same film (language, audience, brand). make --variant <id>|all. Output: out/<variant>/<cutdown>/<fmt>/.","items":{"type":"object","required":["id"],"additionalProperties":false,"properties":{"id":{"type":"string","pattern":"^[a-z0-9][a-z0-9-]{0,31}$","description":"\"main\" is reserved for the project itself."},"title":{"type":"string","minLength":1,"maxLength":120},"overrides":{"type":"object","additionalProperties":false,"properties":{"content":{"type":"object"},"brand":{"type":["string","object"],"pattern":"^@[a-z0-9][a-z0-9-]{0,40}$"},"audio":{"type":"object"},"captions":{"type":"object"},"exports":{"type":"array","maxItems":9,"items":{"type":"string","enum":["720p","4k","webm","gif","prores-alpha","tiktok","reels","youtube","linkedin"]},"description":"Replaces project.exports for this variant (e.g. [] for a demo variant that needs no prores-alpha)."},"transparent":{"type":"boolean","description":"Replaces project.transparent for this variant (a demo over footage is opaque)."}}}}}},"cutdowns":{"type":"array","maxItems":12,"description":"Shorter edits rebuilt from the same scenes. make --cutdown <id>|all. keep: scene ids (in film order) or \"auto\".","items":{"type":"object","required":["id","duration"],"additionalProperties":false,"properties":{"id":{"type":"string","pattern":"^[a-z0-9][a-z0-9-]{0,31}$","description":"\"full\" is reserved for the uncut film."},"duration":{"type":"number","minimum":2,"maximum":180,"description":"Seconds, snapped to whole bars like project.duration."},"keep":{"type":["string","array"],"pattern":"^auto$","default":"auto","items":{"type":"string","minLength":1}},"poster":{"type":["number","string"],"pattern":"^(b\\d+(\\.\\d+)?|bar\\d+|s\\d+(\\.\\d+)?)$"}}}},"exports":{"type":"array","maxItems":9,"description":"Extra deliverables per format (engine/cli/lib/exporter.mjs exportPresets).","items":{"type":"string","enum":["720p","4k","webm","gif","prores-alpha","tiktok","reels","youtube","linkedin"]}},"transparent":{"type":"boolean","default":false,"description":"The film has no background (template.json may also set it); required by the prores-alpha export, which renders with ?alpha=1."},"overrides":{"type":"object","additionalProperties":false,"description":"Per-format deep-merge applied last. May not override template, page, formats, audio, duration, bpm, loop, variants, cutdowns, exports, clips or transparent (enforced in resolveProject); one timeline and one mix are shared by every format.","properties":{"9x16":{"type":"object"},"1x1":{"type":"object"},"4x5":{"type":"object"},"16x9":{"type":"object"}}}}};
