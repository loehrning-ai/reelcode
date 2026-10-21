// browser.mjs: one chromium per command; each Session is a fresh context on it.
import { chromium } from 'playwright';
import { FORMATS, FORMAT_IDS } from '../../layout.js';

let shared = null;
export async function launch() {
  try { return await chromium.launch(); }
  catch (e) { throw new Error(`could not launch chromium (npx playwright install chromium): ${e.message.split('\n')[0]}`); }
}
async function sharedBrowser() { if (!shared) shared = await launch(); return shared; }
export async function closeShared() { if (shared) { await shared.close(); shared = null; } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Failed to load resource: the server responded with a status of 404/;

/** Page URL: the engine page (default) or a bespoke page, with ?project&format&w&h&mode[&variant][&cutdown]. */
export function pageUrl({ base, page = '/engine/page.html', project, format, mode = 'render', variant, cutdown }) {
  const spec = FORMATS[format];
  if (!spec) throw new Error(`unknown format "${format}" (use ${FORMAT_IDS.join(', ')})`);
  const q = new URLSearchParams({ project, format, w: String(spec.w), h: String(spec.h), mode });
  if (variant && variant !== 'main') q.set('variant', variant);
  if (cutdown && cutdown !== 'full') q.set('cutdown', cutdown);
  return `${base}${page}?${q.toString()}`;
}

/**
 * openPage({browser?, base, project, format, mode='render', page?, variant?, cutdown?, timeout=15000}) -> Session
 * Waits for window.__reelcode.status !== 'booting' by polling from Node (the page's own timers are
 * banned in render mode). Throws Error(errors.join('\n')) when the page reports 'error'.
 * page: a bespoke page path ('/projects/<p>/page.html'); when it defines window.seek but no window.__reelcode,
 * the bridge is adopted from engine/bespoke.js. variant/cutdown select the rendition (pass P.pageOpts).
 */
export async function openPage({ browser, base, project, format, mode = 'render', page: pagePath, variant, cutdown, timeout = 15000, quiet = false }) {
  const spec = FORMATS[format];
  const url = pageUrl({ base, page: pagePath || undefined, project, format, mode, variant, cutdown });
  const b = browser || await sharedBrowser();
  const context = await b.newContext({ viewport: { width: spec.w, height: spec.h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); if (!quiet) console.error(`pageerror [${format}]: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text()) && !quiet) console.error(`console [${format}]: ${m.text()}`); });
  const close = async () => { await context.close().catch(() => {}); };
  try {
    await page.goto(url, { waitUntil: 'load' });
    const t0 = Date.now();
    let st = null;
    let adopted = false;
    for (;;) {
      st = await page.evaluate(() => (window.__reelcode ? { status: window.__reelcode.status, errors: window.__reelcode.errors } : null));
      if (st && st.status !== 'booting') break;
      if (!st && pagePath && !adopted && await page.evaluate(() => typeof window.seek === 'function')) {
        adopted = true; // a minimal bespoke page: wrap its window.seek in the reelcode bridge
        await page.evaluate(() => import('/engine/bespoke.js').then((m) => m.adopt()));
        continue;
      }
      if (!st && pageErrors.length && Date.now() - t0 > 1500) throw new Error(`page failed before boot: ${pageErrors.join('\n')}`);
      if (Date.now() - t0 > timeout) throw new Error(`page did not become ready within ${timeout} ms (${url})${pageErrors.length ? `\n${pageErrors.join('\n')}` : ''}`);
      await sleep(40);
    }
    if (st.status === 'error') throw new Error(st.errors.join('\n') || 'page reported status=error');
    const ok = await page.evaluate(() => typeof window.seek === 'function');
    if (!ok) throw new Error('page is ready but window.seek is not defined');
  } catch (e) { await close(); throw e; }
  const info = await page.evaluate(() => window.__reelcode.timeline());
  const warnings = await page.evaluate(() => window.__reelcode.warnings.slice());
  const canvas = page.locator('#c');
  return {
    page, context, W: spec.w, H: spec.h, format, info, warnings, pageErrors,
    seek: (t) => page.evaluate((x) => { window.__reelcode.seek(x); }, t),
    hash: () => page.evaluate(() => window.__reelcode.hash()),
    seekHash: (t) => page.evaluate((x) => { window.__reelcode.seek(x); return window.__reelcode.hash(); }, t),
    shot: (path) => canvas.screenshot({ type: 'png', ...(path ? { path } : {}) }),
    cues: () => page.evaluate(() => window.__reelcode.cues()),
    report: () => page.evaluate(() => window.__reelcode.report()),
    diff: (a, b, thr) => page.evaluate(([x, y, z]) => window.__reelcode.diff(x, y, z), [a, b, thr]),
    close,
  };
}
