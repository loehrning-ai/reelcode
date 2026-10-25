#!/usr/bin/env node
// capture.mjs: turn a local web app into reelcode assets (docs/SPEC.md §5.5).
//
//   npx reelcode capture <fixture:name | http://127.0.0.1:PORT/... | http://localhost:PORT/... | ./path/to/page.html> projects/Y
//        [--states home,search,report] [--routes name=/path,...] [--selectors id=css,...]
//        [--w 1440 --h 900 --dpr 2] [--no-full] [--no-crops] [--apply-brand] [--brand-preset id]
//        [--wait-for css|state=css,...] [--wait-timeout ms] [--warm] [--scroll css|state=css,...] [--scroll-offset px]
//        [--hide css]
//
// Client-rendered apps: --wait-for waits until an element is visible (a demo mounted after hydration), --warm loads
// every state twice so fonts with font-display: optional are cached and used, --scroll scrolls a state to an element
// (minus --scroll-offset, e.g. a sticky header), --hide removes overlays (dev badges, cookie banners) before the
// screenshot. The same recipe can live in project.json content.capture (waitFor, waitTimeout, warm, scroll,
// scrollOffset, hide); a flag wins over the recipe.
//
// --brand-preset id writes brands/<id>.json (+ brands/<id>/logo.*) from the captured brand; with --apply-brand the
// project's brand becomes "@id".
//
// Per state: viewport screenshot (assets/screen-<s>.png), full-page screenshot (assets/full-<s>.png),
// one crop per [data-cap] element / --selectors entry (assets/crops/<s>-<id>.png) and its rect.
// Once: logo (assets/logo.png, plus logo.svg when the source is SVG), brand colours (CSS vars,
// computed styles, pixel-sampled palette), locally present fonts. Writes assets/assets.json.
// Never touches the network: every request outside the target origin is aborted. No timestamps.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND_VARS = ['bg', 'fg', 'accent', 'muted', 'surface'];
// Fallback families when the captured app's own fonts are not available to the film page: the bundled ones.
const HOUSE_FONTS = { display: '"Archivo", sans-serif', ui: '"Inter", sans-serif', mono: '"JetBrains Mono", monospace' };
const USAGE = 'usage: npx reelcode capture <fixture:name|http://127.0.0.1:PORT/...|path.html> <project> ' +
  '[--states a,b] [--routes a=/x,b=/y] [--selectors id=css,...] [--w 1440 --h 900 --dpr 2] [--no-full] [--no-crops] [--apply-brand] [--brand-preset id] ' +
  '[--wait-for css|state=css,...] [--wait-timeout ms] [--warm] [--scroll css|state=css,...] [--scroll-offset px] [--hide css]';
const NAV_MS = 120000; // a dev server may compile a route on its first request

const die = (msg) => { console.error(`capture: ${msg}`); process.exit(1); };
const warn = (warnings, msg) => { warnings.push(msg); console.error(`capture: warning: ${msg}`); };

// ---------- args ----------
function parseArgv(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(`${USAGE}\nAll flags, with examples: docs/CLI.md`); process.exit(0); }
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (['apply-brand', 'no-full', 'no-crops', 'warm'].includes(k)) flags[k] = true;
    else if (i + 1 < argv.length) flags[k] = argv[++i];
    else die(`missing value for --${k}\n${USAGE}`);
  }
  if (pos.length !== 2) die(USAGE);
  // a bare name means projects/<name> in this repository; anything else is a path from the current directory
  const bare = /^[a-z0-9_][a-z0-9_-]{0,63}$/.test(pos[1]) && !existsSync(resolve(pos[1]));
  return { target: pos[0], projectDir: bare ? join(STUDIO_ROOT, 'projects', pos[1]) : resolve(pos[1]), flags };
}
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : null);
// id=value pairs; a comma starts a new pair only before "<id>=", so a CSS value may hold a selector list or [a=b]
const PAIR = /^[A-Za-z0-9_-]+=/;
const pairs = (s) => {
  if (!s) return null;
  const out = {};
  for (const p of String(s).split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((x) => x.trim()).filter(Boolean)) {
    const i = p.indexOf('='); if (i < 1) die(`bad pair "${p}" (want id=value)`); out[p.slice(0, i)] = p.slice(i + 1).trim();
  }
  return out;
};
/** A per-state CSS option: one selector for every state ("css" -> {'*': css}) or state=css pairs. */
const perState = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const out = typeof v === 'object' ? { ...v } : PAIR.test(String(v)) ? pairs(v) : { '*': String(v).trim() };
  for (const [k, css] of Object.entries(out)) if (typeof css !== 'string' || !css.trim() || /[{}]/.test(css)) die(`--${name} ${k}: want a CSS selector (got ${JSON.stringify(css)})`);
  return out;
};
const forState = (m, s) => (m ? (m[s] ?? m['*'] ?? null) : null);
const num = (v, d, name) => {
  if (v === undefined || v === null) return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) die(`--${name} must be a positive number`);
  return n;
};

// ---------- server: engine/cli/lib/server.mjs (shared); this inline copy is only a fallback if it fails to import ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
function inlineStartServer(root) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    let f;
    try { f = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch { res.writeHead(400); return res.end(); }
    if (f !== base && !f.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok({
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}
async function getStartServer() {
  const lib = join(STUDIO_ROOT, 'engine/cli/lib/server.mjs');
  if (existsSync(lib)) {
    try { const m = await import(pathToFileURL(lib).href); if (typeof m.startServer === 'function') return m.startServer; } catch { /* fall back */ }
  }
  return inlineStartServer;
}

// ---------- target resolution ----------
async function resolveTarget(target, startServer) {
  if (target.startsWith('fixture:')) {
    const name = target.slice(8);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) die(`bad fixture name "${name}"`);
    const root = join(STUDIO_ROOT, 'fixtures', name);
    if (!existsSync(join(root, 'index.html'))) die(`fixture not found: fixtures/${name}/index.html`);
    // served from the repository root so a fixture can use the bundled fonts (../../engine/fonts/fonts.css)
    const srv = await startServer(STUDIO_ROOT);
    return { source: target, entry: `${srv.base}/fixtures/${name}/index.html`, origin: srv.base, close: srv.close };
  }
  if (/^https?:\/\//i.test(target)) {
    let u;
    try { u = new URL(target); } catch { die(`bad URL ${target}`); }
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
      die(`refused ${target}: only fixture:<name>, http://127.0.0.1:* , http://localhost:* or a local file are allowed`);
    }
    return { source: target, entry: u.href, origin: u.origin, close: async () => {} };
  }
  const p = resolve(target.startsWith('file://') ? fileURLToPath(target) : target);
  if (!existsSync(p)) die(`refused ${target}: not a fixture, a localhost URL, or an existing file`);
  const isDir = statSync(p).isDirectory();
  const root = isDir ? p : dirname(p);
  const file = isDir ? 'index.html' : basename(p);
  if (!existsSync(join(root, file))) die(`no ${file} in ${root}`);
  const srv = await startServer(root);
  const rel = relative(STUDIO_ROOT, p);
  return { source: rel.startsWith('..') ? `file:${basename(p)}` : `file:${rel.split(sep).join('/')}`,
    entry: `${srv.base}/${encodeURI(file)}`, origin: srv.base, close: srv.close };
}

function stateUrl(entry, state, routes) {
  if (routes && routes[state] !== undefined) return new URL(routes[state], entry).href;
  if (state === 'default') return entry;
  const u = new URL(entry); u.searchParams.set('state', state); return u.href;
}

/**
 * Open one state and make it ready for its screenshot. opt (per state, from flags or content.capture):
 * {warm, waitFor, waitTimeout, hide, scroll, scrollOffset}. Without any of them this is the plain load + fonts path.
 */
async function visit(page, url, warnings, label, opt = {}) {
  for (let pass = opt.warm ? 2 : 1; pass > 0; pass--) {
    // --warm: the first visit fills the browser cache, so the second one uses fonts a cold visit would skip
    // (font-display: optional) and images that would still be loading
    await page.goto(url, { timeout: NAV_MS });
    if (opt.warm) {
      try { await page.waitForLoadState('networkidle', { timeout: opt.waitTimeout }); }
      catch { warn(warnings, `${label}: the network never went idle within ${opt.waitTimeout} ms (--warm)`); }
      await page.evaluate(() => document.fonts.ready);
    }
  }
  await settle(page, warnings, label, opt);
}

async function settle(page, warnings, label, opt = {}) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  try {
    await page.waitForFunction(() => window.__fixtureReady === true, null, { timeout: 2500 });
  } catch {
    const defined = await page.evaluate(() => '__fixtureReady' in window);
    if (defined) warn(warnings, `${label}: window.__fixtureReady never became true`);
  }
  if (opt.waitFor) { // fail closed: a screenshot without the element it waited for is a wrong screenshot
    try { await page.locator(opt.waitFor).first().waitFor({ state: 'visible', timeout: opt.waitTimeout }); }
    catch { die(`${label}: --wait-for "${opt.waitFor}" did not become visible within ${opt.waitTimeout} ms`); }
    await page.evaluate(() => document.fonts.ready);
  }
  // Freeze anything that still moves: carets, CSS animations, transitions, smooth scroll. --hide removes overlays.
  let css = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
  if (opt.hide) {
    const bad = await page.evaluate((sel) => { try { document.querySelectorAll(sel); return null; } catch (e) { return e.message; } }, opt.hide);
    if (bad) die(`--hide "${opt.hide}" is not a valid CSS selector`);
    css += `${opt.hide}{display:none!important}`;
  }
  await page.addStyleTag({ content: css });
  if (opt.scroll) {
    const y = await page.evaluate(([sel, off]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - off));
      return window.scrollY;
    }, [opt.scroll, opt.scrollOffset || 0]);
    if (y === null) die(`${label}: --scroll "${opt.scroll}" matched no element`);
  } else await page.evaluate(() => window.scrollTo(0, 0));
  if (opt.waitFor || opt.scroll || opt.warm) await page.evaluate(pageQuiet, Math.min(opt.waitTimeout, 5000));
}

/** Page side: wait until the images in the viewport have loaded and the DOM has been quiet for 300 ms (cap: max ms). */
async function pageQuiet(max) {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const t0 = performance.now(), left = () => Math.max(0, max - (performance.now() - t0));
  await frame(); await frame();
  const imgs = [...document.images].filter(inView);
  const loaded = Promise.all(imgs.filter((i) => !i.complete).map((i) => new Promise((r) => {
    i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true });
  })));
  await Promise.race([loaded, new Promise((r) => setTimeout(r, left()))]);
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? i.decode().catch(() => {}) : null)));
  await new Promise((done) => {
    let quiet;
    const fin = () => { mo.disconnect(); clearTimeout(quiet); clearTimeout(cap); done(); };
    const mo = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(fin, 300); });
    const cap = setTimeout(fin, left());
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    quiet = setTimeout(fin, 300);
  });
  await document.fonts.ready;
  await frame(); await frame();
}

// ---------- page-side probes (run via page.evaluate; must be self-contained) ----------
function pageRects(sel) {
  const out = {};
  const add = (id, el) => {
    if (!el || out[id]) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    out[id] = { x: r.left, y: r.top, w: r.width, h: r.height, sy: window.scrollY, sx: window.scrollX };
  };
  document.querySelectorAll('[data-cap]').forEach((el) => add(el.getAttribute('data-cap'), el));
  for (const [id, css] of Object.entries(sel || {})) { try { add(id, document.querySelector(css)); } catch { /* bad selector */ } }
  return { rects: out, page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }, scroll: { x: window.scrollX, y: window.scrollY } };
}

function pageBrand() {
  const toHex = (c) => {
    const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
    if (m) {
      const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      if (a < 0.05) return null;
      return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    const h = String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!h) return null;
    const s = h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1];
    return '#' + s.toUpperCase();
  };
  const norm = (v) => { // resolve any CSS colour (named, hsl, var) through the engine
    if (!v) return null;
    const d = document.createElement('div'); d.style.color = v.trim(); document.body.appendChild(d);
    const out = d.style.color ? toHex(getComputedStyle(d).color) : null; d.remove(); return out;
  };
  const root = getComputedStyle(document.documentElement);
  const vars = {};
  for (const k of ['bg', 'fg', 'accent', 'muted', 'surface']) { const v = norm(root.getPropertyValue(`--brand-${k}`)); if (v) vars[k] = v; }
  const body = getComputedStyle(document.body);
  const prim = document.querySelector('[data-cap="primary"]') || document.querySelector('.btn-primary, button[type=submit], .primary');
  const surf = document.querySelector('[data-cap="surface"], .card, [class*="card"], [class*="panel"]');
  const computed = {
    bg: toHex(body.backgroundColor) || toHex(root.backgroundColor) || '#FFFFFF',
    fg: toHex(body.color) || '#000000',
    accent: prim ? toHex(getComputedStyle(prim).backgroundColor) : null,
    surface: surf ? toHex(getComputedStyle(surf).backgroundColor) : null,
  };
  return { vars, computed };
}

function pageFonts() {
  const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji'];
  const ctx = document.createElement('canvas').getContext('2d');
  const S = 'mmmmmmmmmmlli1WQ@#&% Hamburgefonstiv 0123456789';
  const w = (fam) => { ctx.font = `72px ${fam}`; return ctx.measureText(S).width; };
  const present = (f) => ['monospace', 'serif', 'sans-serif'].some((b) => Math.abs(w(`"${f}", ${b}`) - w(b)) > 0.5);
  const split = (stack) => stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const reduce = (el, role) => {
    if (!el) return { role, stack: null, family: null, css: null };
    const stack = getComputedStyle(el).fontFamily;
    const fams = split(stack);
    const generic = fams.find((f) => GENERIC.includes(f.toLowerCase())) || (role === 'mono' ? 'monospace' : 'sans-serif');
    const hit = fams.find((f) => !GENERIC.includes(f.toLowerCase()) && present(f));
    const q = (f) => (/^[a-z-]+$/i.test(f) ? f : `"${f}"`);
    return { role, stack, family: hit || null, css: hit ? `${q(hit)}, ${generic}` : null };
  };
  return {
    display: reduce(document.querySelector('h1') || document.querySelector('h2'), 'display'),
    ui: reduce(document.body, 'ui'),
    mono: reduce(document.querySelector('code, kbd, pre, .mono'), 'mono'),
  };
}

function pageLogoPrep(css) {
  let el = null;
  try { el = (css && document.querySelector(css)) || document.querySelector('[data-cap="logo"]'); } catch { el = document.querySelector('[data-cap="logo"]'); }
  if (!el) return null;
  el.setAttribute('data-capture-logo', '');
  const r = el.getBoundingClientRect();
  let svg = null, src = null;
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (el.tagName.toLowerCase() === 'svg') svg = el.outerHTML;
  else if (el.querySelector('svg')) svg = el.querySelector('svg').outerHTML;
  else if (img && /\.svg(\?|#|$)/i.test(img.currentSrc || img.src)) src = img.currentSrc || img.src;
  // Make the logo's backdrop transparent so omitBackground yields alpha.
  for (let n = el; n; n = n.parentElement) { n.style.setProperty('background', 'transparent', 'important'); n.style.setProperty('box-shadow', 'none', 'important'); }
  document.querySelectorAll('body *').forEach((n) => { if (!n.contains(el) && !el.contains(n) && n !== el) n.style.setProperty('visibility', 'hidden', 'important'); });
  return { w: r.width, h: r.height, svg, src };
}

async function samplePalette(page, pngs) {
  // Decode screenshots in a blank page and histogram them (12-bit buckets, merged by distance). Pure + deterministic.
  return page.evaluate(async (b64s) => {
    const buckets = new Map(); let total = 0;
    for (const b64 of b64s) {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d');
      cx.drawImage(bmp, 0, 0);
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      for (let i = 0; i < d.length; i += 4 * 3) {
        const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const b = buckets.get(key) || [0, 0, 0, 0];
        b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; buckets.set(key, b); total++;
      }
    }
    const cols = [...buckets.values()].map((b) => ({ r: b[0] / b[3], g: b[1] / b[3], b: b[2] / b[3], n: b[3] })).sort((a, z) => z.n - a.n);
    const merged = [];
    for (const c of cols) {
      const m = merged.find((x) => Math.hypot(x.r - c.r, x.g - c.g, x.b - c.b) < 28);
      if (m) { const n = m.n + c.n; m.r = (m.r * m.n + c.r * c.n) / n; m.g = (m.g * m.n + c.g * c.n) / n; m.b = (m.b * m.n + c.b * c.n) / n; m.n = n; } else merged.push({ ...c });
    }
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const sat = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx === 0 ? 0 : (mx - mn) / mx; };
    merged.sort((a, z) => z.n - a.n);
    const palette = merged.slice(0, 8).map((c) => ({ hex: hex(c), share: +(c.n / total).toFixed(4) }));
    const acc = merged.find((c) => sat(c) > 0.4 && Math.max(c.r, c.g, c.b) > 90 && c.n / total > 0.002);
    return { palette, dominant: palette[0] ? palette[0].hex : null, accent: acc ? hex(acc) : null };
  }, pngs.map((b) => b.toString('base64')));
}

// ---------- colour helpers (node side) ----------
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();

function pickColors(brand, sampled, warnings) {
  const { vars, computed } = brand;
  if (BRAND_VARS.every((k) => vars[k])) return { colors: { ...vars }, source: 'css-vars' };
  const bg = vars.bg || computed.bg;
  const fg = vars.fg || computed.fg;
  const accent = vars.accent || computed.accent || sampled.accent || mix(bg, fg, 0.5);
  if (!vars.accent && !computed.accent) warn(warnings, `no --brand-accent or [data-cap="primary"]; accent ${sampled.accent ? 'pixel-sampled' : 'mixed'}`);
  return {
    colors: { bg, fg, accent, muted: vars.muted || mix(bg, fg, 0.45), surface: vars.surface || computed.surface || mix(bg, fg, 0.08) },
    source: Object.keys(vars).length ? 'css-vars+computed' : 'computed',
  };
}

function cleanAssets(dir) {
  mkdirSync(join(dir, 'crops'), { recursive: true });
  for (const f of readdirSync(dir)) if (/^(screen|full)-.+\.png$|^logo\.(png|svg)$/.test(f)) rmSync(join(dir, f));
  for (const f of readdirSync(join(dir, 'crops'))) if (f.endsWith('.png')) rmSync(join(dir, 'crops', f));
}

const safeId = (s) => String(s).replace(/[^a-z0-9_-]+/gi, '_');
/** A rect clipped to the viewport (screen rects map onto the viewport screenshot), or null when none of it shows. */
const inViewport = (r, W, H) => {
  const x = Math.max(0, r.x), y = Math.max(0, r.y), x2 = Math.min(W, r.x + r.w), y2 = Math.min(H, r.y + r.h);
  return x2 - x >= 1 && y2 - y >= 1 ? { x, y, w: x2 - x, h: y2 - y } : null;
};
const px = (r, dpr) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * dpr));

/** The project's brand merged with the capture (colours, fonts, logo). A "@preset" brand is not expanded here. */
function capturedBrand(proj, assets) {
  const brand = proj && proj.brand && typeof proj.brand === 'object' ? proj.brand : {};
  const fonts = brand.fonts || {};
  const next = {
    ...brand,
    colors: { ...(brand.colors || {}), ...assets.colors },
    fonts: { ...fonts, display: { ...(fonts.display || {}), family: assets.fonts.display }, ui: { ...(fonts.ui || {}), family: assets.fonts.ui } },
    ...(assets.logo ? { logo: assets.logo.file } : {}),
  };
  delete next.extends;
  return next;
}

function readProject(projectDir) {
  const pj = join(projectDir, 'project.json');
  if (!existsSync(pj)) return null;
  try { return JSON.parse(readFileSync(pj, 'utf8')); } catch (e) { die(`project.json is not valid JSON: ${e.message}`); }
}

function applyBrand(projectDir, assets, warnings, preset) {
  const pj = join(projectDir, 'project.json'), proj = readProject(projectDir);
  if (!proj) { warn(warnings, '--apply-brand: no project.json, skipped'); return false; }
  writeFileSync(pj, JSON.stringify({ ...proj, brand: preset ? `@${preset}` : capturedBrand(proj, assets) }, null, 2) + '\n');
  return true;
}

/** --brand-preset id: brands/<id>.json from the captured brand; the logo is copied to brands/<id>/. */
function savePreset(projectDir, assets, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) die(`--brand-preset must match ^[a-z0-9][a-z0-9-]{0,40}$ (got ${id})`);
  const brand = capturedBrand(readProject(projectDir), assets), dir = join(STUDIO_ROOT, 'brands');
  if (assets.logo) {
    const src = assets.logo.svg || assets.logo.file, ext = extname(src);
    mkdirSync(join(dir, id), { recursive: true });
    copyFileSync(join(projectDir, src), join(dir, id, `logo${ext}`));
    brand.logo = `brands/${id}/logo${ext}`;
  } else delete brand.logo;
  const out = { id, description: `Captured by capture.mjs from ${assets.source}`, ...brand };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(out, null, 2) + '\n');
  return `brands/${id}.json`;
}

// ---------- main ----------
async function main() {
  const { target, projectDir, flags } = parseArgv(process.argv.slice(2));
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
  let projCap = {};
  const pj = join(projectDir, 'project.json');
  if (existsSync(pj)) { try { projCap = (JSON.parse(readFileSync(pj, 'utf8')).content || {}).capture || {}; } catch { die('project.json is not valid JSON'); } }
  const vp = projCap.viewport || {};
  const W = num(flags.w, vp.w || 1440, 'w'), H = num(flags.h, vp.h || 900, 'h'), DPR = num(flags.dpr, vp.dpr || 2, 'dpr');
  const routes = pairs(flags.routes) || projCap.routes || null;
  const selectors = pairs(flags.selectors) || projCap.selectors || {};
  const wantFull = !flags['no-full'] && projCap.fullPage !== false;
  const wantCrops = !flags['no-crops'] && projCap.crops !== false;
  const waitFor = perState(flags['wait-for'] ?? projCap.waitFor, 'wait-for');
  const scroll = perState(flags.scroll ?? projCap.scroll, 'scroll');
  const hideList = flags.hide ?? projCap.hide;
  const hide = hideList === undefined ? null : (Array.isArray(hideList) ? hideList : [hideList]).map((x) => String(x).trim()).filter(Boolean).join(', ') || null;
  if (hide && /[{}]/.test(hide)) die(`--hide: want a CSS selector (got ${JSON.stringify(hide)})`);
  const offset = Number(flags['scroll-offset'] ?? projCap.scrollOffset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) die('--scroll-offset must be a number >= 0 (CSS pixels)');
  const waitTimeout = num(flags['wait-timeout'], projCap.waitTimeout || 30000, 'wait-timeout');
  const warm = !!flags.warm || projCap.warm === true;
  /** The visit options of one state (a state=css entry wins over a bare selector for every state). */
  const optFor = (s) => ({ warm, waitTimeout, hide, scrollOffset: offset, waitFor: forState(waitFor, s), scroll: forState(scroll, s) });
  const warnings = [];

  const assetsDir = join(projectDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const tgt = await resolveTarget(target, await getStartServer());
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, reducedMotion: 'reduce', colorScheme: 'dark' });
    // Hard network fence: only the target origin (and inline data/blob URLs) may load.
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      return u.startsWith(tgt.origin + '/') || u === tgt.origin || /^(data|blob):/.test(u) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => warn(warnings, `pageerror: ${e.message}`));

    let states = list(flags.states) || projCap.states || (routes ? Object.keys(routes) : null);
    if (!states) {
      await visit(page, tgt.entry, warnings, 'entry', optFor('*'));
      states = await page.evaluate(() => (Array.isArray(window.__fixtureStates) ? window.__fixtureStates : null)) || ['default'];
    }
    for (const [flag, m] of [['wait-for', waitFor], ['scroll', scroll]])
      for (const k of Object.keys(m || {})) if (k !== '*' && !states.includes(k)) die(`--${flag} names state "${k}", which is not captured (states: ${states.join(', ')})`);
    cleanAssets(assetsDir);

    const screens = {}, shots = [];
    let brand = null, fonts = null, logoState = null;
    for (const s of states) {
      const sid = safeId(s);
      await visit(page, stateUrl(tgt.entry, s, routes), warnings, s, optFor(s));
      const buf = await page.screenshot({ path: join(assetsDir, `screen-${sid}.png`) });
      shots.push(buf);
      const { rects, page: pg, scroll: at } = await page.evaluate(pageRects, selectors);
      const entry = { file: `assets/screen-${sid}.png`, w: Math.round(W * DPR), h: Math.round(H * DPR), rects: {} };
      if (at.x || at.y) entry.scroll = { x: Math.round(at.x * DPR), y: Math.round(at.y * DPR) }; // where the screen sits on full
      if (wantFull) {
        await page.screenshot({ path: join(assetsDir, `full-${sid}.png`), fullPage: true });
        entry.full = { file: `assets/full-${sid}.png`, w: Math.round(Math.max(W, pg.w) * DPR), h: Math.round(Math.max(H, pg.h) * DPR) };
      }
      if (wantCrops) entry.crops = {};
      for (const id of Object.keys(rects).sort()) {
        const r = rects[id], vis = inViewport(r, W, H);
        if (vis) entry.rects[id] = px(vis, DPR); // the part on the screenshot; an element off screen has a crop only
        if (!wantCrops) continue;
        const file = `assets/crops/${sid}-${safeId(id)}.png`;
        const clip = { x: Math.max(0, r.x + r.sx), y: Math.max(0, r.y + r.sy), width: r.w, height: r.h };
        await page.screenshot({ path: join(projectDir, file), clip, fullPage: true });
        entry.crops[id] = { file, w: Math.round(r.w * DPR), h: Math.round(r.h * DPR) };
      }
      if (!Object.keys(rects).length) warn(warnings, `${s}: no [data-cap] elements or --selectors matched`);
      screens[s] = entry;
      if (!brand) { brand = await page.evaluate(pageBrand); fonts = await page.evaluate(pageFonts); }
      else if (!brand.computed.accent) { const b2 = await page.evaluate(pageBrand); if (b2.computed.accent) brand.computed.accent = b2.computed.accent; }
      if (!logoState && rects.logo) logoState = s;
    }

    // Logo: re-open its state, isolate the element on a transparent backdrop, screenshot with alpha.
    let logo = null;
    if (logoState) {
      await visit(page, stateUrl(tgt.entry, logoState, routes), warnings, `${logoState} (logo)`, optFor(logoState));
      const info = await page.evaluate(pageLogoPrep, selectors.logo || null);
      if (!info) die(`logo vanished on re-open of state "${logoState}"`);
      await page.locator('[data-capture-logo]').first().screenshot({ path: join(assetsDir, 'logo.png'), omitBackground: true });
      logo = { file: 'assets/logo.png', w: Math.round(info.w * DPR), h: Math.round(info.h * DPR), from: logoState };
      let svgText = info.svg;
      if (!svgText && info.src) svgText = await page.evaluate(async (u) => (await fetch(u)).text(), info.src).catch(() => null);
      if (svgText && /<svg[\s>]/i.test(svgText)) { writeFileSync(join(assetsDir, 'logo.svg'), svgText.trim() + '\n'); logo.svg = 'assets/logo.svg'; }
    } else warn(warnings, 'no [data-cap="logo"] element (or --selectors logo=...) in any state; no logo written');

    // Pixel palette from every viewport shot, decoded in a blank page.
    await page.goto('about:blank');
    const sampled = await samplePalette(page, shots);
    const { colors, source } = pickColors(brand, sampled, warnings);

    const outFonts = {}, families = {};
    for (const role of ['display', 'ui', 'mono']) {
      const f = fonts[role];
      if (f && f.css) { outFonts[role] = f.css; families[role] = f.family; continue; }
      outFonts[role] = HOUSE_FONTS[role]; families[role] = HOUSE_FONTS[role].split(',')[0].replace(/"/g, '');
      if (role !== 'mono' || f.stack) warn(warnings, `${role} font ${f && f.stack ? `"${f.stack}" has no locally present family` : 'not found'}; using house stack ${HOUSE_FONTS[role]}`);
    }

    const assets = {
      source: tgt.source,
      viewport: { w: W, h: H, dpr: DPR },
      states,
      screens,
      logo,
      colors,
      colorsSource: source,
      palette: sampled.palette,
      sampled: { dominant: sampled.dominant, accent: sampled.accent },
      fonts: outFonts,
      fontFamilies: families,
      warnings,
    };
    writeFileSync(join(assetsDir, 'assets.json'), JSON.stringify(assets, null, 2) + '\n');
    const preset = flags['brand-preset'] ? savePreset(projectDir, assets, String(flags['brand-preset'])) : null;
    const applied = flags['apply-brand'] ? applyBrand(projectDir, assets, warnings, preset && String(flags['brand-preset'])) : false;
    if (applied) writeFileSync(join(assetsDir, 'assets.json'), JSON.stringify(assets, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, project: relative(STUDIO_ROOT, projectDir), states: states.length,
      screens: Object.keys(screens), logo: !!logo, colors, fonts: outFonts, applyBrand: applied, ...(preset ? { brandPreset: preset } : {}), warnings: warnings.length }));
  } finally {
    await browser.close();
    await tgt.close();
  }
}

main().catch((e) => { console.error(`capture: ${e && e.stack ? e.stack : e}`); process.exit(1); });
