// media tests: crop/Ken Burns/mask/clip-time math (pure), clip extraction (ffmpeg, frame-exact, cached), and the
// projects/_media smoke project in a browser (clip plays deterministically, plates are readable, no empty cut frames).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as media from '../media.js';
import { extractClip, prepareClips, clipParams, clipSpec, frameCount } from '../cli/lib/clips.mjs';
import { frame } from '../layout.js';
import { makeTheme } from '../runtime.js';
import { makeGrid } from '../beat.js';
import { ensurePrepared } from './_prepare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
ensurePrepared('_media');
const CLIP = join(ROOT, 'projects', '_media', 'assets', 'ridge.webm');
const TMP = mkdtempSync(join(tmpdir(), 'media-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const BRAND = { colors: { bg: '#0C0C0D', fg: '#F3F0E8', accent: '#C8F23C' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } };

// ---------- pure ----------
test('coverView: covers the box with the box aspect, centres on focus, stays inside the image at any zoom/pan', () => {
  const box = { x: 0, y: 0, w: 1080, h: 1920 };
  const v = media.coverView(2400, 1600, box);
  assert.ok(near(v.sw / v.sh, box.w / box.h, 1e-9));
  assert.ok(near(v.sh, 1600) && near(v.sx, (2400 - v.sw) / 2));
  const f = media.coverView(2400, 1600, box, { focus: [0.68, 0.5] });
  assert.ok(near(f.sx + f.sw / 2, 0.68 * 2400));
  for (const zoom of [1, 1.1, 2]) for (const focus of [[0, 0], [1, 1], [0.5, 0.5]]) for (const pan of [[-1, 0], [1, 1], [0, 0]]) {
    const c = media.coverView(2400, 1600, box, { zoom, focus, pan });
    assert.ok(c.sx >= -1e-9 && c.sy >= -1e-9 && c.sx + c.sw <= 2400 + 1e-9 && c.sy + c.sh <= 1600 + 1e-9, JSON.stringify({ zoom, focus, pan, c }));
    assert.ok(near(c.sw, media.coverView(2400, 1600, box).sw / zoom, 1e-6));
  }
  const w = media.coverView(1600, 2400, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.ok(near(w.sw, 1600) && near(w.sh, 900));
});

test('containView: whole image inside the box, anchored by focus', () => {
  const v = media.containView(1600, 2400, { x: 10, y: 20, w: 1920, h: 1080 });
  assert.ok(near(v.dh, 1080) && near(v.dw, 720) && near(v.dx, 10 + 600) && near(v.dy, 20));
  assert.ok(near(media.containView(1600, 2400, { x: 0, y: 0, w: 1920, h: 1080 }, { focus: [0, 0] }).dx, 0));
});

test('kenBurns + kbProgress: moves are monotone springs that still move on the last frame and re-frame on the middle beat', () => {
  assert.deepEqual(media.kenBurns('push-in', 0.1), { z0: 1, z1: 1.1, p0: [0, 0], p1: [0, 0] });
  assert.equal(media.kenBurns('pull-out').z0, 1.1);
  assert.ok(media.kenBurns('pan-l').p0[0] < media.kenBurns('pan-l').p1[0]);
  assert.ok(media.kenBurns('pan-r').p0[0] > media.kenBurns('pan-r').p1[0]);
  assert.throws(() => media.kenBurns('zoom'), /move "zoom"/);
  const sec = 3, ts = Array.from({ length: 91 }, (_, i) => i / 30);
  const p = ts.map((t) => media.kbProgress(t, sec));
  assert.equal(p[0], 0);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1] - 1e-12, `monotone at ${ts[i]}`);
  assert.ok(p[90] < 1 && p[90] > 0.9 && p[90] - p[87] > 1e-4, `still drifting at the end: ${p[87]} -> ${p[90]}`);
  const m = ts.map((t) => media.kbProgress(t, sec, 1.5));
  const vel = (arr, i) => arr[i + 1] - arr[i];
  assert.ok(vel(m, 50) > 2 * vel(p, 50), 're-frame speeds the move up after the middle beat');
  assert.ok(Math.max(...m) < 1.02);
});

test('maskPath: none/full fills the box, empty at 0, wipe/iris/slats stay inside the box', () => {
  const rec = () => { const ops = []; return { ops, rect: (...a) => ops.push(['rect', ...a]), moveTo: () => {}, arc: (...a) => ops.push(['arc', ...a]) }; };
  const box = { x: 100, y: 200, w: 800, h: 400 };
  let c = rec(); media.maskPath(c, 'wipe', 1, box); assert.deepEqual(c.ops, [['rect', 100, 200, 800, 400]]);
  c = rec(); media.maskPath(c, 'iris', 0, box); assert.deepEqual(c.ops, []);
  c = rec(); media.maskPath(c, 'wipe', 0.25, box, { dir: 'l' }); assert.deepEqual(c.ops, [['rect', 700, 200, 200, 400]]);
  c = rec(); media.maskPath(c, 'wipe', 0.5, box, { dir: 'u' }); assert.deepEqual(c.ops, [['rect', 100, 400, 800, 200]]);
  c = rec(); media.maskPath(c, 'iris', 0.5, box, { origin: [0, 0] }); assert.equal(c.ops[0][1], 100); assert.ok(near(c.ops[0][3], 0.5 * Math.hypot(800, 400)));
  c = rec(); media.maskPath(c, 'slats', 0.5, box);
  assert.ok(c.ops.length > 0 && c.ops.every(([, x, y, w, h]) => x >= 100 && y >= 200 - 1e-9 && x + w <= 900.6 && y + h <= 600 + 1e-9));
  assert.throws(() => media.maskPath(rec(), 'fade', 0.5, box), /reveal "fade"/);
});

test('clip time: trim, speed, hold on the last frame or wrap; frame index is floor((sec - from) * fps)', () => {
  const clip = { from: 0.5, fps: 30, frames: 150 };
  assert.equal(media.frameIndex(clip, 0.5), 0);
  assert.equal(media.frameIndex(clip, 0.5 + 1 / 30), 1, 'exact frame boundaries land on the new frame');
  assert.equal(media.frameIndex(clip, 0.5 + 0.999 / 30), 0);
  assert.equal(media.frameIndex(clip, -3), 0);
  assert.equal(media.frameIndex(clip, 99), 149);
  const tm = { from: 1, to: 3, rate: 2, fps: 30 };
  assert.equal(media.clipTime(0, tm), 1);
  assert.equal(media.clipTime(0.5, tm), 2);
  assert.ok(media.clipTime(5, tm) < 3 && media.clipTime(5, tm) > 2.98, 'held on the last frame');
  assert.ok(near(media.clipTime(1.25, { ...tm, loop: true }), 1.5), 'wraps');
  assert.equal(media.clipTime(-1, tm), 1, 'outgoing/early times clamp');
});

test('inkFor: plate colours by WCAG contrast (bg/fg on a dark brand, falls back on a low-contrast brand)', () => {
  const F = frame('9x16');
  const dark = media.inkFor(makeTheme(BRAND, F));
  assert.deepEqual([dark.plate, dark.ink, dark.sub], ['bg', 'fg', 'muted']);
  assert.ok(dark.ratio >= 7);
  const mush = media.inkFor(makeTheme({ ...BRAND, colors: { bg: '#777777', fg: '#888888', accent: '#000000' } }, F));
  assert.ok(mush.ratio >= 4.5, JSON.stringify(mush));
  assert.ok(media.contrast('#000000', '#FFFFFF') > 20.9 && near(media.contrast('#777777', '#777777'), 1));
});

test('blocks: cues and events come from the options (identical in every format), errors name the problem', () => {
  const grid = makeGrid({ bpm: 120 }, 16);
  const img = { naturalWidth: 2400, naturalHeight: 1600 };
  const measuring = { measureText: (s) => ({ width: s.length * 10, actualBoundingBoxAscent: 7 }), set font(v) {}, set letterSpacing(v) {} };
  const mk = (fmt, o) => {
    const F = frame(fmt), theme = makeTheme(BRAND, F);
    const api = { F, theme, grid, ctx: measuring, assets: { images: { a: img }, screens: {} }, clips: { c: { from: 0, to: 6, fps: 30, frames: 180, frameAt: () => img } } };
    return o.clip ? media.clipBlock(api, o) : media.imageBlock(api, o);
  };
  const o = { id: 's', beats: 6, image: 'a', caption: 'Hi there', lower: { title: 'Name', sub: 'Role', at: 1.5, until: 5 } };
  const a = mk('9x16', o), b = mk('16x9', o);
  assert.deepEqual(a.events, b.events); assert.deepEqual(a.sfx, b.sfx);
  assert.deepEqual(a.events, [0, 1, 1.5, 3, 5]);
  assert.ok(a.sfx.some((m) => m.sfx === 'whoosh' && m.at === 0), 'reveal whoosh');
  assert.equal(mk('1x1', { ...o, transition: { type: 'wipe' } }).sfx.some((m) => m.sfx === 'whoosh'), false, 'a transition replaces the reveal');
  assert.deepEqual(mk('1x1', { id: 's', beats: 4, image: 'a' }).events, [0], 'no re-frame below 6 beats');
  assert.throws(() => mk('1x1', { id: 's', beats: 4, image: 'nope' }), /no image "nope"/);
  assert.throws(() => mk('1x1', { id: 's', beats: 4, clip: 'zz' }), /clip "zz" is not loaded/);
  assert.throws(() => mk('1x1', { id: 's', beats: 4, clip: 'c', from: 5, to: 7 }), /must lie inside/);
});

// ---------- clips.mjs ----------
test('extractClip: frame-exact trim, exact count, cached by content + params, re-extracts on change', async () => {
  const out = join(TMP, 'x');
  const r = await extractClip({ src: CLIP, outDir: out, fps: 30, from: 1, to: 2, width: 640 });
  assert.equal(r.cached, false); assert.equal(r.frames, 30); assert.deepEqual([r.w, r.h], [640, 360]);
  assert.equal(readdirSync(out).filter((f) => f.endsWith('.png')).length, 30);
  const j = JSON.parse(readFileSync(join(out, 'clip.json'), 'utf8'));
  assert.equal(j.pattern, '%05d.png'); assert.equal(j.key, r.key);
  // Frame 00000 is the source frame at t=1s (n=30), not the nearest keyframe: compare at full width.
  const full = await extractClip({ src: CLIP, outDir: join(TMP, 'full'), fps: 30, from: 1, to: 1.2 });
  const raw = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  assert.ok(raw(['-i', join(TMP, 'full', '00000.png')]).equals(raw(['-i', CLIP, '-vf', 'select=eq(n\\,30)', '-frames:v', '1'])), 'first frame is source frame 30');
  assert.equal((await extractClip({ src: CLIP, outDir: out, fps: 30, from: 1, to: 2, width: 640 })).cached, true);
  const r3 = await extractClip({ src: CLIP, outDir: out, fps: 15, from: 1, to: 2, width: 640 });
  assert.equal(r3.cached, false); assert.equal(r3.frames, 15);
  assert.equal(readdirSync(out).filter((f) => f.endsWith('.png')).length, 15, 'stale frames removed');
  await assert.rejects(extractClip({ src: 'https://example.com/a.mp4', outDir: out }), /local file/);
  await assert.rejects(extractClip({ src: CLIP, outDir: out, from: 2, to: 1 }), /greater than from/);
  await assert.rejects(extractClip({ src: CLIP, outDir: out, to: 60 }), /past the end/);
});

test('clipParams/clipSpec: defaults, limits, paths stay inside the project', () => {
  const meta = { w: 1920, h: 1080, duration: 6, fps: 30 };
  assert.deepEqual(clipParams({}, meta), { from: 0, to: 6, fps: 30, width: 1280 });
  assert.equal(clipParams({ width: 1600 }, { ...meta, w: 1281 }).width, 1280, 'never upscales, always even');
  assert.throws(() => clipParams({ fps: 29.97 }, meta), /fps must be an integer/);
  assert.equal(frameCount(0.5, 6, 30), 165);
  const dir = join(TMP, 'proj'); mkdirSync(join(dir, 'assets'), { recursive: true });
  copyFileSync(CLIP, join(dir, 'assets', 'c.webm'));
  symlinkSync(CLIP, join(dir, 'assets', 'link.webm'));
  assert.equal(clipSpec(dir, 'ok', { src: 'assets/c.webm', from: 1 }).from, 1);
  assert.throws(() => clipSpec(dir, 'x', { src: '../c.webm' }), /inside the project/);
  assert.throws(() => clipSpec(dir, 'x', { src: 'assets/link.webm' }), /outside the project/);
  assert.throws(() => clipSpec(dir, 'x', { src: '/etc/passwd' }), /project-relative/);
  assert.throws(() => clipSpec(dir, 'x', { src: 'assets/c.webm', speed: 2 }), /unknown key/);
  assert.throws(() => clipSpec(dir, 'Bad Id', { src: 'assets/c.webm' }), /must match/);
});

// ---------- browser: projects/_media ----------
test('projects/_media: clip frames play deterministically, plates are readable, reveals never show an empty frame', async () => {
  const { loadProject } = await import('../cli/lib/project.mjs');
  const { startServer } = await import('../cli/lib/server.mjs');
  const { launch, openPage } = await import('../cli/lib/browser.mjs');
  const P = loadProject('projects/_media');
  await prepareClips(P, {});
  const srv = await startServer(), browser = await launch();
  try {
    for (const fmt of ['9x16', '16x9']) {
      const s = await openPage({ browser, base: srv.base, project: '_media', format: fmt, quiet: true });
      try {
        const sc = Object.fromEntries(s.info.scenes.map((x) => [x.id, x]));
        // Every scene's first frame already shows the picture (the reveal is under way): at least 40% of the
        // non-bg pixels the fully revealed frame has (a duotone night shot is half bg by design, so this is relative).
        const ink = () => s.page.evaluate(() => {
          const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 400) if (Math.abs(d[i] - 12) + Math.abs(d[i + 1] - 12) + Math.abs(d[i + 2] - 13) > 6) n++;
          return n / (d.length / 400);
        });
        for (const id of ['ridge', 'harbor', 'pass', 'canopy']) {
          await s.seek(sc[id].start + 1e-4); const first = await ink();
          await s.seek(sc[id].start + 0.75); const open = await ink();
          assert.ok(open > 0.3 && first >= 0.4 * open, `[${fmt}] ${id}: first frame ${first.toFixed(2)} vs revealed ${open.toFixed(2)}`);
        }
        // The clip advances frame by frame (1.25x) and the same t always paints the same pixels.
        const t0 = sc.pass.start + 1;
        const h = [];
        for (const dt of [0, 1 / 30, 2 / 30]) h.push(await s.seekHash(t0 + dt));
        assert.equal(new Set(h).size, 3, 'consecutive frames differ');
        await s.seek(0); assert.equal(await s.seekHash(t0), h[0], 'seek is a pure function of t');
        // Lower third at rest: its text boxes sit on the opaque plate; WCAG contrast of the ink against the
        // actual pixels behind the glyphs' box (the plate) clears 4.5:1 and the box is inside the safe area.
        await s.seek(sc.pass.start + 4 * 0.5);
        const r = await s.report();
        const lower = r.texts.filter((x) => /^(Window|seat)$|clip, 1.25x|frame-exact/.test(x.s));
        assert.ok(lower.length >= 3, JSON.stringify(r.texts.map((x) => x.s)));
        const safe = frame(fmt).safe;
        for (const x of lower) {
          const b = x.box;
          assert.ok(b.x >= safe.x - 1 && b.y >= safe.y - 1 && b.x + b.w <= safe.x + safe.w + 1 && b.y + b.h <= safe.y + safe.h + 1, `${x.s} inside safe`);
          const ratio = await s.page.evaluate(([bx, txt]) => {
            const ctx = document.getElementById('c').getContext('2d');
            const d = ctx.getImageData(Math.floor(bx.x), Math.floor(bx.y), Math.ceil(bx.w), Math.ceil(bx.h)).data;
            const lum = (r, g, b) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
            // darkest and lightest pixel in the box: plate vs ink
            let lo = 1, hi = 0;
            for (let i = 0; i < d.length; i += 4) { const L = lum(d[i], d[i + 1], d[i + 2]); lo = Math.min(lo, L); hi = Math.max(hi, L); }
            return { ratio: (hi + 0.05) / (lo + 0.05), txt };
          }, [b, x.s]);
          assert.ok(ratio.ratio >= 4.5, `[${fmt}] "${x.s}" contrast ${ratio.ratio.toFixed(2)}`);
        }
        assert.deepEqual(s.pageErrors, []);
      } finally { await s.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
});
