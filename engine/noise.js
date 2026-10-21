// noise.js: seeded, stateless noise. Never Math.random.

/** Integer hash of (n, seed) -> [0, 1). Non-integers are floored. */
export function hash(n, seed = 0) {
  let x = (Math.floor(n) | 0) ^ Math.imul(seed | 0, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** mulberry32 generator: rng(seed)() -> [0, 1). Deterministic per seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (p) => p * p * (3 - 2 * p);

/** 1-D value noise in [0, 1), continuous in x. */
export function noise1(seed, x) {
  const i = Math.floor(x), p = smooth(x - i);
  const a = hash(i, seed), b = hash(i + 1, seed);
  return a + (b - a) * p;
}

const h2 = (seed, i, j) => hash(i + Math.imul(j, 7919), seed ^ 0x5bd1e995);

/** 2-D value noise in [0, 1), continuous in x and y. */
export function noise2(seed, x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const px = smooth(x - i), py = smooth(y - j);
  const a = h2(seed, i, j), b = h2(seed, i + 1, j), c = h2(seed, i, j + 1), d = h2(seed, i + 1, j + 1);
  const top = a + (b - a) * px, bot = c + (d - c) * px;
  return top + (bot - top) * py;
}

/** Smooth wobble of amplitude amp at roughly hz, centred on 0. */
export const jitter = (seed, t, amp, hz) => (noise1(seed, t * hz) * 2 - 1) * amp;
