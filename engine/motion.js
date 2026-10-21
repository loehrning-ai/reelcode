// motion.js: motion as pure functions of time. Runs in Node and in the page. Nothing is remembered between frames;
// the only module state is the table of named spring presets, installed once per boot by setSprings().
//
// A spring is two numbers a designer can reason about, written [response, damping]:
//   response  seconds for one swing of the undamped spring (0.2 feels snappy, 0.6 feels heavy)
//   damping   damping ratio: 1 settles without overshoot, below 1 overshoots, above 1 creeps in
// The step response is solved in closed form, so any frame can be drawn without replaying the frames before it.

const TAU = 2 * Math.PI;

export const DEFAULT_SPRINGS = Object.freeze({
  soft: Object.freeze([0.53, 0.6]),   // heavy, visible bounce: big type landing, logos
  med: Object.freeze([0.36, 0.86]),   // the default: a hint of overshoot
  stiff: Object.freeze([0.26, 0.98]), // quick and flat: UI that must not wobble
  snap: Object.freeze([0.21, 0.66]),  // fast with a kick: toggles, pills, hits
});
let PRESETS = { ...DEFAULT_SPRINGS };
const settleCache = new Map();
const peakCache = new Map();

/** Check a [response, damping] pair; a clear message beats a silent mis-tuned film. */
function checkPair(s, where) {
  const [response, damping] = s;
  if (!(response > 0 && response <= 10) || !(damping > 0 && damping <= 5)) {
    throw new Error(`motion: ${where} spring must be [response seconds (0-10], damping ratio (0-5]], got [${s}]`);
  }
  return s;
}

export function setSprings(overrides = {}) {
  for (const [name, s] of Object.entries(overrides)) checkPair(s, `"${name}"`);
  PRESETS = { ...DEFAULT_SPRINGS, ...overrides };
  settleCache.clear(); peakCache.clear();
  return PRESETS;
}
export const springs = () => PRESETS;

/** A preset name or a [response, damping] pair -> [response, damping]. */
export function springOf(s = 'med') {
  if (Array.isArray(s) && s.length === 2) return checkPair(s, 'inline');
  const found = PRESETS[s];
  if (!found) throw new Error(`motion: unknown spring "${s}" (presets: ${Object.keys(PRESETS).join(', ')})`);
  return found;
}

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, p) => a + (b - a) * p;
export const mod = (a, n) => ((a % n) + n) % n;
export const easeInOutCubic = (p) => { p = clamp(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
export const easeOutCubic = (p) => 1 - Math.pow(1 - clamp(p), 3);
export const easeOutQuart = (p) => 1 - Math.pow(1 - clamp(p), 4);

/**
 * Step response of a damped spring released at t = 0 from rest at 0 toward 1, in closed form.
 * Three regimes of x'' + 2*zeta*w*x' + w^2*(x - 1) = 0 with x(0) = x'(0) = 0:
 *   under-damped   1 - e^(-zeta*w*t) * sin(wd*t + acos(zeta)) / sqrt(1 - zeta^2)
 *   critical       1 - e^(-w*t) * (1 + w*t)
 *   over-damped    1 + (r2*e^(r1*t) - r1*e^(r2*t)) / (r1 - r2), r1,2 = -w*(zeta -/+ sqrt(zeta^2 - 1))
 */
export function spring(t, response = 0.4, damping = 1) {
  if (!(t > 0)) return 0;
  const w = TAU / response, zeta = damping;
  if (Math.abs(zeta - 1) < 1e-4) return 1 - Math.exp(-w * t) * (1 + w * t);
  if (zeta < 1) {
    const root = Math.sqrt(1 - zeta * zeta);
    return 1 - (Math.exp(-zeta * w * t) / root) * Math.sin(w * root * t + Math.acos(zeta));
  }
  const spread = Math.sqrt(zeta * zeta - 1), r1 = -w * (zeta - spread), r2 = -w * (zeta + spread);
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** Spring by preset name or [response, damping]. */
export function sp(t, s = 'med') { const [response, damping] = springOf(s); return spring(t, response, damping); }

/**
 * Stacked springs: keys [[time, value, spring?], ...]. Each change of target starts its own spring at its own time,
 * and the deltas add up, so a value that is retargeted mid-flight stays continuous and is still a pure function of t.
 */
export function seq(t, keys, s = 'med') {
  return keys.reduce((acc, [at, value, own], i) => (i === 0 ? value : acc + (value - keys[i - 1][1]) * sp(t - at, own || s)), 0);
}

/** seq for vectors: keys [[time, [..values], spring?], ...] -> a new array. */
export function seqv(t, keys, s = 'med') {
  const out = keys[0][1].slice();
  keys.forEach(([at, target, own], i) => {
    if (i === 0) return;
    const p = sp(t - at, own || s), prev = keys[i - 1][1];
    target.forEach((v, j) => { out[j] += (v - prev[j]) * p; });
  });
  return out;
}

/** A 0 -> 1 -> 0 hit at time `at`, `len` seconds wide. */
export const pulse = (t, at, len = 0.08, s = 'snap') => sp(t - at, s) - sp(t - at - len, s);

/** Start offset of item i of n spread evenly over `span`. */
export const stagger = (i, n, span) => (n <= 1 ? 0 : (i * span) / (n - 1));

/** Seconds after which |sp(t, s) - 1| stays below eps (numeric scan, cached per spring). */
export function settle(s = 'med', eps = 0.002) {
  const [response, damping] = springOf(s);
  const key = `${response}|${damping}|${eps}`;
  if (settleCache.has(key)) return settleCache.get(key);
  const dt = 1 / 2000, horizon = Math.max(20, response * 40);
  let lastOut = 0;
  for (let t = dt; t < horizon; t += dt) if (Math.abs(spring(t, response, damping) - 1) >= eps) lastOut = t;
  const at = lastOut + dt;
  settleCache.set(key, at);
  return at;
}

/** First time the spring reaches its target (Infinity when it never overshoots). */
function firstArrival(s) {
  const [response, damping] = springOf(s);
  const key = `${response}|${damping}`;
  if (peakCache.has(key)) return peakCache.get(key);
  let at = Infinity;
  if (damping < 1) at = (response / Math.sqrt(1 - damping * damping)) * ((Math.PI - Math.acos(damping)) / TAU);
  peakCache.set(key, at);
  return at;
}

/** Land, then squash: p climbs to 1 and stays; whatever overshoot follows is reported as squash sq. */
export function drop(dt, s = 'soft') {
  if (dt <= 0) return { p: 0, sq: 0 };
  const v = sp(dt, s), landed = firstArrival(s);
  return dt < landed ? { p: Math.min(1, v), sq: 0 } : { p: 1, sq: Math.max(0, v - 1) };
}

/** Round a beat count to the 1/div-beat grid (div=4 -> 1/16 notes, what cues.py checks). Use on content-derived marker times. */
export const quant = (b, div = 4) => Math.round(b * div + 1e-9) / div;

/** How many periods of history a looping spring needs before its oldest copy has settled below eps. */
const loopDepth = (keys, T, s) => {
  const worst = keys.reduce((m, k) => Math.max(m, settle(k[2] || s, 1e-4)), 0);
  return Math.max(1, Math.ceil(worst / T));
};

/**
 * Periodic stacked springs for loops: keys [[time, [..values], spring?], ...] in cycle order (times taken mod T).
 * Before the first key the value is the last key's (the cycle wraps), so position AND velocity at t = T match
 * t = 0. t is taken mod T. -> new array
 */
export function loopSeqv(t, T, keys, s = 'med') {
  if (!(T > 0)) throw new Error('motion: loopSeqv needs a period T > 0');
  if (!keys.length) throw new Error('motion: loopSeqv needs at least one key');
  const n = keys.length, tm = mod(t, T), depth = loopDepth(keys, T, s), out = keys[n - 1][1].slice();
  keys.forEach(([at0, target, own], j) => {
    const prev = keys[(j + n - 1) % n][1], at = mod(at0, T);
    let weight = -depth;
    for (let m = 0; m <= depth; m++) weight += sp(tm - at + m * T, own || s);
    target.forEach((v, i) => { out[i] += (v - prev[i]) * weight; });
  });
  return out;
}

/** Scalar loopSeqv: keys [[time, value, spring?], ...]. */
export const loopSeq = (t, T, keys, s = 'med') => loopSeqv(t, T, keys.map(([a, v, k]) => [a, [v], k]), s)[0];

/** pulse() that repeats every T seconds (a hit near the end also shows at the start). */
export const loopPulse = (t, T, at, len = 0.08, s = 'snap') => {
  const tm = mod(t, T);
  return Math.max(pulse(tm, at, len, s), pulse(tm + T, at, len, s), pulse(tm - T, at, len, s));
};
