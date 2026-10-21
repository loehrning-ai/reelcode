"""make_media.py: procedural, photo-like test media for the media blocks (no downloads, seeded, reproducible).

.venv/bin/python -I fixtures/media/make_media.py [--out DIR] [--frames 180]

Renders into fixtures/media/ (a git-ignored cache, rebuilt when this script changes) and copies the files into
--out, so every project that uses the shared photos gets them in a second instead of half a minute.
Writes (numpy renders raw RGB, ffmpeg encodes; nothing is downloaded):
  ridge.jpg    2400x1600  dusk mountain ridges with haze, a low sun and grain        (landscape)
  harbor.jpg   2400x1600  night harbour: skyline, lit windows, bokeh, reflections    (landscape, dark)
  canopy.jpg   1600x2400  macro leaf canopy with veins and shallow depth of field    (portrait)
  ridge.webm   1280x720   6 s @ 30 fps: a parallax "train window" pass over the ridges, VP9
Prints one JSON line {ok, files}.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
from scipy import ndimage

SEED = 20261019


def fbm1(rng, n, octaves=7, base=4):
    """1-D fractal noise in [-1, 1] of length n (sum of smoothed random octaves)."""
    out = np.zeros(n)
    amp, total = 1.0, 0.0
    x = np.arange(n)
    for o in range(octaves):
        k = base * 2 ** o
        knots = rng.standard_normal(k + 2)
        out += amp * np.interp(x, np.linspace(0, n - 1, k + 2), knots)
        total += amp
        amp *= 0.55
    out = ndimage.gaussian_filter1d(out / total, 2)
    return out / (np.abs(out).max() + 1e-9)


def fbm2(rng, h, w, octaves=6, base=3):
    """2-D fractal value noise in [0, 1]."""
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        gh, gw = base * 2 ** o + 1, int(base * 2 ** o * w / h) + 1
        g = rng.random((gh, gw))
        out += amp * ndimage.zoom(g, (h / gh, w / gw), order=3, mode='reflect')[:h, :w]
        total += amp
        amp *= 0.5
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-9)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a + (b - a) * t


def rgb(hexs):
    return np.array([int(hexs[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0


def grain(rng, img, amt=0.025):
    n = ndimage.gaussian_filter(rng.standard_normal(img.shape[:2]), 0.6)[..., None]
    return np.clip(img + amt * n, 0, 1)


def vignette(img, k=0.35):
    h, w = img.shape[:2]
    y, x = np.mgrid[0:h, 0:w]
    r = np.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / np.sqrt(2)
    return img * (1 - k * r ** 2)[..., None]


# ---------- ridge ----------
def ridge_layers(rng, w, h):
    """Sky + four ridge layers (colour, mask) for width w. Shared by the still and the clip."""
    y = np.linspace(0, 1, h)[:, None]
    top, horizon = rgb('#1D2B53'), rgb('#F29E6D')
    sky = mix(top, horizon, np.clip(y / 0.62, 0, 1) ** 1.6)
    sky = np.broadcast_to(sky, (h, w, 3)).copy()
    clouds = fbm2(rng, h, w, 6, 2)
    band = np.exp(-((y - 0.32) / 0.12) ** 2)
    sky = mix(sky, rgb('#F7C59F'), np.clip((clouds - 0.55) * 2.2, 0, 1) * band * 0.55)
    sun_x, sun_y, sun_r = 0.68 * w, 0.5 * h, 0.035 * h
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(xx - sun_x, yy - sun_y)
    sky = mix(sky, rgb('#FFF1D6'), np.clip(1.2 - d / sun_r, 0, 1))
    sky = mix(sky, rgb('#FFD9A8'), np.exp(-(d / (sun_r * 9)) ** 2) * 0.35)
    layers = []
    cols = ['#6A5A86', '#4A3F6B', '#2E2849', '#17142A']
    for i, c in enumerate(cols):
        base_y = 0.5 + i * 0.1
        amp = 0.06 + i * 0.035
        prof = base_y - amp * (0.5 + 0.5 * fbm1(rng, w, 8, 3 + i))
        mask = (yy / h > prof[None, :]).astype(np.float64)
        mask = ndimage.gaussian_filter(mask, 0.8)
        tex = fbm2(rng, h, w, 5, 6 + 2 * i)
        col = rgb(c)[None, None, :] * (0.85 + 0.3 * tex[..., None])
        haze = 0.42 - i * 0.12
        col = mix(col, horizon, max(0.0, haze))
        layers.append((col, mask))
    return sky, layers


def make_ridge(rng, w=2400, h=1600):
    sky, layers = ridge_layers(rng, w, h)
    img = sky
    for col, mask in layers:
        img = mix(img, col, mask)
    return grain(rng, vignette(img, 0.3))


# ---------- harbor ----------
def make_harbor(rng, w=2400, h=1600):
    y = np.linspace(0, 1, h)[:, None]
    img = np.broadcast_to(mix(rgb('#070B1A'), rgb('#1B2346'), np.clip(y / 0.55, 0, 1)), (h, w, 3)).copy()
    water = int(h * 0.62)
    lights = np.zeros((h, w, 3))
    x = 0
    while x < w:
        bw = int(rng.integers(60, 220))
        bh = int(h * rng.uniform(0.12, 0.42))
        top = water - bh
        shade = rgb('#0B1022') * rng.uniform(0.7, 1.3)
        img[top:water, x:x + bw] = shade
        warm = rng.random() < 0.6
        for wy in range(top + 14, water - 10, 22):
            for wx in range(x + 8, x + bw - 8, 16):
                if rng.random() < 0.38:
                    c = rgb('#FFC872') if warm else rgb('#9FD3FF')
                    lights[wy:wy + 8, wx:wx + 6] = c * rng.uniform(0.6, 1.0)
        x += bw + int(rng.integers(0, 30))
    img = np.clip(img + lights, 0, 1)
    bokeh = np.zeros((h, w, 3))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(46):
        cx, cy, r = rng.uniform(0, w), rng.uniform(0.05 * h, 0.6 * h), rng.uniform(18, 70)
        c = [rgb('#FF9A5C'), rgb('#FFD27A'), rgb('#7FC4FF'), rgb('#FF6FA3')][int(rng.integers(0, 4))]
        y0, y1, x0, x1 = int(max(0, cy - r - 2)), int(min(h, cy + r + 2)), int(max(0, cx - r - 2)), int(min(w, cx + r + 2))
        d = np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy)
        disk = np.clip(r - d, 0, 1) * (0.25 + 0.2 * (d / r))
        bokeh[y0:y1, x0:x1] += disk[..., None] * c
    img = np.clip(img + ndimage.gaussian_filter(bokeh, (2, 2, 0)), 0, 1)
    # water: the skyline mirrored, rippled and darkened
    above = img[water - (h - water):water][::-1]
    ripple = (np.sin(np.arange(h - water)[:, None] * 0.9 + fbm2(rng, h - water, w, 4, 5) * 12) * 6).astype(int)
    cols = np.clip(np.arange(w)[None, :] + ripple, 0, w - 1)
    refl = np.take_along_axis(above, cols[..., None].repeat(3, axis=2), axis=1)
    refl = ndimage.gaussian_filter(refl, (3, 1.5, 0))
    img[water:] = refl * 0.55 + rgb('#050816') * 0.45
    return grain(rng, vignette(img, 0.4), 0.03)


# ---------- canopy ----------
def make_canopy(rng, w=1600, h=2400):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    n = fbm2(rng, h, w, 6, 3)
    img = mix(rgb('#0E2A12'), rgb('#3E7A2B'), n)
    # three leaves: an ellipse each, a midrib, side veins, lit from the upper right
    for (cx, cy, a, b, ang, lit) in [(0.62, 0.38, 0.42, 0.2, -0.6, 1.0), (0.3, 0.7, 0.38, 0.17, 0.5, 0.8), (0.75, 0.82, 0.3, 0.13, -0.2, 0.65)]:
        cx, cy, a, b = cx * w, cy * h, a * w, b * w
        ca, sa = np.cos(ang), np.sin(ang)
        u = ((xx - cx) * ca + (yy - cy) * sa) / a
        v = (-(xx - cx) * sa + (yy - cy) * ca) / b
        r = u ** 2 + (v / (1 - 0.35 * u)) ** 2
        mask = ndimage.gaussian_filter((r < 1).astype(np.float64), 2)
        vein = np.exp(-(v * 40) ** 2) + 0.6 * np.exp(-(np.sin((u * 7 - np.abs(v) * 3.2) * np.pi) * 6) ** 2) * (np.abs(v) < 0.9)
        leaf = mix(rgb('#4F9A2E'), rgb('#B8E06A'), np.clip(0.35 + 0.5 * (u * 0.4 - v * 0.3) + 0.25 * n, 0, 1)) * lit
        leaf = mix(leaf, rgb('#E4F5A8'), np.clip(vein, 0, 1) * 0.55)
        img = mix(img, leaf, mask)
    # shallow depth of field: sharp band in the middle, blurred top and bottom
    blur = ndimage.gaussian_filter(img, (9, 9, 0))
    focus = np.clip(np.abs(yy / h - 0.45) * 3.2 - 0.25, 0, 1)
    img = mix(img, blur, focus)
    return grain(rng, vignette(img, 0.35), 0.02)


# ---------- clip ----------
def make_ridge_clip(rng, out, frames=180, w=1280, h=720, fps=30):
    """Parallax pass: each ridge layer scrolls at its own speed (near = fast), poles whip past; 6 s at 30 fps."""
    W = w * 4
    sky, _ = ridge_layers(np.random.default_rng(SEED + 7), w, h)  # sky (with the sun) is fixed to the window
    _, layers = ridge_layers(rng, W, h)
    speeds = [1.2, 3.0, 6.5, 12.0]  # px per frame: far ... near
    yy = np.arange(h)[:, None]
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-',
           '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
           '-pix_fmt', 'yuv420p', '-an', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    pole_col = rgb('#0B0914')
    for i in range(frames):
        img = sky.copy()
        for (col, mask), s in zip(layers, speeds):
            x = int(round(s * i)) % (W - w)
            img = mix(img, col[:, x:x + w], mask[:, x:x + w])
        # telegraph poles + a sagging wire, 34 px/frame, one every 900 px
        off = (34 * i) % 900
        for px in range(w + 900 - off, -200, -900):
            x0, x1 = px - 14, px + 14
            if x1 > 0 and x0 < w:
                img[int(h * 0.18):, max(0, x0):min(w, x1)] = pole_col
                img[int(h * 0.2):int(h * 0.2) + 10, max(0, px - 70):min(w, px + 70)] = pole_col
        xs = np.arange(w)
        ph = ((xs + off) % 900) / 900.0
        wire_y = (h * 0.215 + 60 * 4 * ph * (1 - ph)).astype(int)
        for k in range(3):
            img[np.clip(wire_y + k, 0, h - 1), xs] = pole_col
        p.stdin.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise RuntimeError('ffmpeg failed encoding the clip')


def write_jpg(img, out):
    h, w = img.shape[:2]
    data = (np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes()
    r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-i', '-',
                        '-frames:v', '1', '-q:v', '3', '-update', '1', out], input=data)
    if r.returncode != 0:
        raise RuntimeError(f'ffmpeg failed writing {out}')


NAMES = ['ridge.jpg', 'harbor.jpg', 'canopy.jpg', 'ridge.webm']
CACHE = os.path.dirname(os.path.abspath(__file__))


def render_all(out, frames):
    """Render the four files into `out` (a few dozen seconds)."""
    os.makedirs(out, exist_ok=True)
    files = []
    for name, fn in [('ridge.jpg', make_ridge), ('harbor.jpg', make_harbor), ('canopy.jpg', make_canopy)]:
        path = os.path.join(out, name)
        write_jpg(fn(np.random.default_rng(SEED + len(files))), path)
        files.append(path)
    clip = os.path.join(out, 'ridge.webm')
    make_ridge_clip(np.random.default_rng(SEED), clip, frames=frames)
    files.append(clip)
    return files


def cache_key(frames):
    import hashlib
    with open(os.path.abspath(__file__), 'rb') as fh:
        return hashlib.sha256(fh.read() + str(frames).encode()).hexdigest()


def main():
    import shutil
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=CACHE)
    ap.add_argument('--frames', type=int, default=180)
    a = ap.parse_args()
    stamp = os.path.join(CACHE, '.stamp')
    key = cache_key(a.frames)
    fresh = os.path.isfile(stamp) and open(stamp).read().strip() == key and \
        all(os.path.isfile(os.path.join(CACHE, n)) for n in NAMES)
    if not fresh:
        render_all(CACHE, a.frames)
        with open(stamp, 'w') as fh:
            fh.write(key + '\n')
    out = os.path.abspath(a.out)
    files = []
    for n in NAMES:
        dst = os.path.join(out, n)
        if os.path.abspath(os.path.join(CACHE, n)) != dst:
            os.makedirs(out, exist_ok=True)
            shutil.copyfile(os.path.join(CACHE, n), dst)
        files.append(dst)
    print(json.dumps({'ok': True, 'cached': fresh, 'files': files}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # one JSON line on failure too
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
