"""make_train.py: the night-train assets for example-ad (seeded, no downloads, regenerated in code).

.venv/bin/python -I projects/example-ad/scripts/make_train.py

The train-window motif is the spine of the film: a carriage interior (wall, window gasket, sill, reading lamp, berth
with pillow and breakfast tray) with a transparent rounded-rect window, one overlay per aspect so the window is laid
out for each frame instead of cropped. The world slides past behind it.

Writes into projects/example-ad/assets/:
  carriage-v.png (1080x1920) carriage-p.png (1080x1350) carriage-s.png (1080x1080) carriage-h.png (1920x1080)
                 RGBA overlays; the window hole is transparent. carriage.json holds each hole rect (0..1 of the frame).
  city-far.jpg   4000x1400 Berlin at night: an irregular skyline with the TV-tower needle, lit floors, dark embankment.
  city-near.png  2000x1400 RGBA, the near layer: catenary masts and smeared platform lamps (tiles horizontally).
  dawn.jpg       4000x1400 Alpine sunrise: snow-capped peaks, gold sky, teal valley (not the purple fixture ridge).
  breakfast.jpg  2400x2000 top-down berth tray: coffee, croissant, juice on a wool blanket in a band of sunlight (full-bleed).
  ticket.jpg     2400x1600 a night-train ticket on the berth under the reading lamp (no lettering: type stays in code).
Reuses the fixture generator's helpers (fixtures/media/make_media.py). Prints one JSON line {ok, files}.
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.abspath(os.path.join(HERE, '..', 'assets'))
sys.path.insert(0, os.path.join(ROOT, 'fixtures', 'media'))
import make_media as mm  # noqa: E402

SEED = 20261021
rgb = mm.rgb


def mix(a, b, t):
    """Linear mix; t must already broadcast against the colours (add [..., None] yourself)."""
    return a + (b - a) * t

# window hole per aspect (x, y, w, h as fractions of the frame) and corner radius (fraction of the short side)
HOLES = {
    'v': {'size': (1080, 1920), 'hole': (0.075, 0.115, 0.85, 0.6), 'r': 0.11},
    'p': {'size': (1080, 1350), 'hole': (0.075, 0.075, 0.85, 0.63), 'r': 0.1},
    's': {'size': (1080, 1080), 'hole': (0.075, 0.07, 0.85, 0.64), 'r': 0.09},
    'h': {'size': (1920, 1080), 'hole': (0.06, 0.075, 0.88, 0.66), 'r': 0.09},
}


def write_png_rgba(img, alpha, out):
    h, w = img.shape[:2]
    data = np.concatenate([np.clip(img, 0, 1), np.clip(alpha, 0, 1)[..., None]], axis=2)
    raw = (data * 255).astype(np.uint8).tobytes()
    r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{w}x{h}', '-i', '-',
                        '-frames:v', '1', '-update', '1', out], input=raw)
    if r.returncode != 0:
        raise RuntimeError(f'ffmpeg failed writing {out}')


def rrect_sdf(w, h, box, r):
    """Signed distance (px) to a rounded rect box=(x, y, bw, bh); negative inside."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    x, y, bw, bh = box
    cx, cy = x + bw / 2, y + bh / 2
    qx, qy = np.abs(xx - cx) - (bw / 2 - r), np.abs(yy - cy) - (bh / 2 - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def soft(d, k=1.2):
    """Coverage of a shape from its SDF (antialiased edge)."""
    return np.clip(0.5 - d / k, 0, 1)


def ellipse(w, h, cx, cy, rx, ry):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    return (np.hypot((xx - cx) / rx, (yy - cy) / ry) - 1) * min(rx, ry)


# ---------- carriage overlay ----------
def make_carriage(rng, key):
    spec = HOLES[key]
    w, h = spec['size']
    hx, hy, hw, hh = spec['hole']
    box = (hx * w, hy * h, hw * w, hh * h)
    r = spec['r'] * min(w, h)
    y = np.linspace(0, 1, h)[:, None]
    # wall: dark warm laminate with a faint vertical grain, lit from the lamp
    grain = mm.fbm2(rng, h, w, 5, 3)
    streak = ndimage.gaussian_filter(rng.standard_normal((1, w)), (0, 2))[0]
    wall = mix(rgb('#1A1420'), rgb('#2A2030'), np.clip(grain[..., None] * 0.7 + 0.15 * streak[None, :, None], 0, 1))
    lamp_x, lamp_y = (0.86 * w, 0.05 * h) if key != 'h' else (0.965 * w, 0.2 * h)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    pool = np.exp(-(((xx - lamp_x) / (0.45 * min(w, h))) ** 2 + ((yy - lamp_y - 0.08 * min(w, h)) / (0.6 * min(w, h))) ** 2))
    img = mix(wall, rgb('#6B4630'), pool[..., None] * 0.55)
    d = rrect_sdf(w, h, box, r)
    # gasket (the rubber seal) and a bevel of lighter frame metal outside it
    u = min(w, h) / 1080
    rim = soft(np.abs(d + 5 * u) - 9 * u)
    bevel = soft(np.abs(d - 22 * u) - 14 * u)
    img = mix(img, rgb('#3B3242') * (0.9 + 0.2 * grain[..., None]), bevel[..., None] * 0.9)
    img = mix(img, rgb('#08070C'), rim[..., None])
    # inner shadow on the wall just outside the frame (depth)
    img = img * (1 - 0.35 * np.exp(-np.maximum(d - 36 * u, 0) / (30 * u)))[..., None] ** 1
    # sill under the window
    sill_y0 = box[1] + box[3] + 34 * u
    sill = ((yy > sill_y0) & (yy < sill_y0 + 30 * u)).astype(np.float64)
    img = mix(img, rgb('#4A3A44'), sill[..., None] * 0.95)
    img = mix(img, rgb('#0D0A10'), ((yy >= sill_y0 + 30 * u) & (yy < sill_y0 + 44 * u))[..., None] * 0.9)
    # berth: a wool blanket over the bottom, a pillow at the window end, a breakfast tray
    berth_y = sill_y0 + 44 * u
    blanket_tex = mm.fbm2(rng, h, w, 5, 18)
    blanket = mix(rgb('#141A3A'), rgb('#232B5A'), blanket_tex[..., None])
    folds = 0.5 + 0.5 * np.sin(xx / (38 * u) + mm.fbm2(rng, h, w, 3, 2) * 6)
    blanket = blanket * (0.85 + 0.25 * folds[..., None])
    by = np.clip((yy - berth_y) / (24 * u), 0, 1)
    img = mix(img, blanket, by[..., None])
    pil_cx = box[0] + 0.12 * box[2] if key != 'h' else box[0] + 0.08 * box[2]
    pw_, ph_ = (0.36 * w if key != 'h' else 0.22 * w), 0.075 * h
    pil = rrect_sdf(w, h, (pil_cx - pw_ / 2, berth_y + 0.005 * h, pw_, ph_), ph_ * 0.45)
    # a soft pillow: lit along its top edge, shaded toward the blanket, a seam across the middle
    ptop = np.clip((yy - (berth_y + 0.005 * h)) / ph_, 0, 1)
    pil_shade = (1.05 - 0.45 * ptop) * (0.9 + 0.2 * mm.fbm2(rng, h, w, 3, 4))
    seam = np.exp(-((yy - (berth_y + 0.005 * h + ph_ * 0.55)) / (3 * u)) ** 2) * 0.25
    img = mix(img, rgb('#5A6488') * (pil_shade - seam)[..., None], soft(pil, 2)[..., None])
    img = mix(img, rgb('#0A0B16'), (soft(pil - 6 * u, 10 * u) - soft(pil, 2))[..., None].clip(0, 1) * 0.6)
    # tray (warm wood) with a cup and a plate, seen from the pillow
    tw, th = (0.34 * w, 0.075 * h) if key == 'v' else (0.26 * w, 0.11 * h) if key == 'h' else (0.32 * w, 0.1 * h)
    tx, ty = box[0] + box[2] - tw - 0.02 * w, berth_y + 0.02 * h
    tray = rrect_sdf(w, h, (tx, ty, tw, th), 12 * u)
    wood = mix(rgb('#5A3A22'), rgb('#7A5232'), mm.fbm2(rng, h, w, 4, 24)[..., None])
    img = mix(img, wood, soft(tray, 2)[..., None])
    cup_r = min(tw, th) * 0.32
    for (cx, kind) in ((tx + tw * 0.3, 'cup'), (tx + tw * 0.68, 'plate')):
        cy = ty + th * 0.5
        if kind == 'cup':
            img = mix(img, rgb('#CFC6BA') * 0.8, soft(ellipse(w, h, cx, cy, cup_r * 1.25, cup_r * 0.9), 2)[..., None])
            img = mix(img, rgb('#3A2316'), soft(ellipse(w, h, cx, cy, cup_r * 0.8, cup_r * 0.55), 2)[..., None])
        else:
            img = mix(img, rgb('#B9B0A5') * 0.8, soft(ellipse(w, h, cx, cy, cup_r * 1.5, cup_r * 0.95), 2)[..., None])
            img = mix(img, rgb('#B87532'), soft(ellipse(w, h, cx, cy, cup_r * 0.9, cup_r * 0.42), 2)[..., None])
    # reading lamp: a brass arm and a dark shade with its lit rim
    shade_w = 70 * u
    arm = ((np.abs(xx - lamp_x) < 4 * u) & (yy < lamp_y + 10 * u)).astype(np.float64) if key != 'h' else \
        ((np.abs(yy - lamp_y) < 4 * u) & (xx > lamp_x)).astype(np.float64)
    img = mix(img, rgb('#9C7A44'), arm[..., None])
    sy0 = lamp_y + 6 * u
    trap = (yy > sy0) & (yy < sy0 + 46 * u) & (np.abs(xx - lamp_x) < shade_w * 0.35 + (yy - sy0) * 0.45)
    img = mix(img, rgb('#24202A'), trap[..., None] * 1.0)
    lit = (yy > sy0 + 40 * u) & (yy < sy0 + 48 * u) & (np.abs(xx - lamp_x) < shade_w * 0.35 + 46 * u * 0.45)
    img = mix(img, rgb('#FFD9A0'), lit[..., None] * 1.0)
    img = mm.grain(rng, img, 0.02)
    alpha = 1 - soft(d, 1.5)  # the hole is transparent
    return img, alpha, {'hole': [hx, hy, hw, hh], 'radius': spec['r']}


# ---------- outside: Berlin at night (two parallax layers) ----------
def make_city_far(rng, w=4000, h=1400):
    y = np.linspace(0, 1, h)[:, None]
    img = np.broadcast_to(mix(rgb('#0A0E24'), rgb('#2A2550'), (np.clip(y / 0.62, 0, 1) ** 1.3)[..., None]), (h, w, 3)).copy()
    yy, xx = np.mgrid[0:h, 0:w]
    ground = int(h * 0.7)
    lights = np.zeros((h, w, 3))
    x = 0
    while x < w:
        bw = int(rng.integers(50, 260))
        bh = int(h * (rng.uniform(0.08, 0.3) if rng.random() < 0.8 else rng.uniform(0.3, 0.45)))
        top = ground - bh
        img[top:ground, x:x + bw] = rgb('#0C0F22') * rng.uniform(0.6, 1.4)
        fl = int(rng.integers(14, 30))                      # floor height varies per building
        cw = int(rng.integers(8, 26))                       # window width varies per building
        warm = rng.random() < 0.7
        p_lit = rng.uniform(0.08, 0.6)
        for wy in range(top + 10, ground - 8, fl):
            row_on = rng.random() < 0.8
            for wx in range(x + 6, x + bw - cw, cw + int(rng.integers(3, 10))):
                if row_on and rng.random() < p_lit:
                    c = rgb('#FFC872') if warm else rgb('#A8D8FF')
                    lights[wy:wy + max(4, fl // 2), wx:wx + cw] = c * rng.uniform(0.4, 1.0)
        x += bw + int(rng.integers(0, 40))
    # the TV-tower needle (one Berlin cue), twice across the wide plate
    for tx in (0.3 * w, 0.8 * w):
        shaft = (np.abs(xx - tx) < 9) & (yy > h * 0.12) & (yy < ground)
        ball = np.hypot(xx - tx, yy - h * 0.27) < 38
        img[shaft | ball] = rgb('#101327')
        lights[(np.abs(yy - h * 0.27) < 4) & (np.abs(xx - tx) < 34)] = rgb('#FFB45E')
        lights[(np.hypot(xx - tx, yy - h * 0.12) < 6)] = rgb('#FF5A4A')
    img = np.clip(img + ndimage.gaussian_filter(lights, (0.6, 0.6, 0)), 0, 1)
    # embankment + track bed in the foreground (dark, for type)
    img[ground:] = mix(rgb('#0B0B18'), rgb('#05050C'), np.clip((yy[ground:] - ground) / (h - ground), 0, 1)[..., None])
    halo = ndimage.gaussian_filter(lights[ground - 40:ground], (12, 30, 0))
    img[ground:ground + 40] = np.clip(img[ground:ground + 40] + halo[::-1] * 0.4, 0, 1)
    return mm.grain(rng, img, 0.025)


def make_city_near(rng, w=2000, h=1400):
    img, a = np.zeros((h, w, 3)), np.zeros((h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    # catenary masts: dark verticals that whip past
    for mx in (0.18 * w, 0.68 * w):
        m = (np.abs(xx - mx) < 16) & (yy > h * 0.05)
        a[m] = 1
        img[m] = rgb('#06060C')
        arm = (np.abs(yy - h * 0.12) < 6) & (xx > mx - 140) & (xx < mx + 140)
        a[arm] = 1
        img[arm] = rgb('#06060C')
    wire = (np.abs(yy - h * 0.14) < 2)
    a[wire] = np.maximum(a[wire], 0.8)
    # platform lamps smeared into horizontal streaks by the motion
    st = np.zeros((h, w, 3))
    for row in (0.2, 0.26):
        for _ in range(7):
            xc, ln = rng.uniform(0, w), rng.uniform(120, 420)
            c = rgb('#FFB45E') if rng.random() < 0.75 else rgb('#CFE3FF')
            yc = int(h * row + rng.uniform(-8, 8))
            st[yc - 3:yc + 3, int(max(0, xc - ln / 2)):int(min(w, xc + ln / 2))] += c * rng.uniform(0.6, 1)
    st = ndimage.gaussian_filter(st, (2, 20, 0))
    sa = np.clip(st.max(axis=2) * 1.6, 0, 1)
    img = img * (1 - sa[..., None]) + np.clip(st * 1.6, 0, 1)
    a = np.maximum(a, sa)
    return img, a


# ---------- outside: Alpine dawn ----------
def make_dawn(rng, w=4000, h=1400):
    y = np.linspace(0, 1, h)[:, None]
    sky = mix(rgb('#3C4E8C'), rgb('#FFB766'), (np.clip(y / 0.55, 0, 1) ** 1.4)[..., None])
    sky = np.broadcast_to(sky, (h, w, 3)).copy()
    yy, xx = np.mgrid[0:h, 0:w]
    sun_x, sun_y = 0.62 * w, 0.47 * h
    dd = np.hypot(xx - sun_x, yy - sun_y)
    sky = mix(sky, rgb('#FFF4DC'), np.clip(1.4 - dd / 46, 0, 1)[..., None])
    sky = mix(sky, rgb('#FFE0A8'), (np.exp(-(dd / 520) ** 2) * 0.45)[..., None])
    img = sky
    # peaks: sharp alpine profiles (abs-folded noise), snow above a slanted line, lit from the sun side
    for i, (c, base, amp) in enumerate([('#8E7FA8', 0.42, 0.2), ('#4F6E86', 0.55, 0.16), ('#24465A', 0.68, 0.1), ('#10262E', 0.8, 0.06)]):
        n = mm.fbm1(rng, w, 8, 4 + 2 * i)
        prof = base - amp * (1 - np.abs(n)) ** 2 * 1.4
        mask = ndimage.gaussian_filter((yy / h > prof[None, :]).astype(np.float64), 0.8)
        tex = mm.fbm2(rng, h, w, 5, 8 + 3 * i)
        col = rgb(c)[None, None, :] * (0.8 + 0.4 * tex[..., None])
        if i < 2:
            # a smooth snow line under the ridge (no per-column drips), broken up by the rock texture
            crest = ndimage.gaussian_filter1d(prof, 60)
            snow = np.clip(((crest[None, :] + 0.07 + 0.03 * i) - yy / h) / 0.03 + (tex - 0.5) * 1.2, 0, 1) * (yy / h > prof[None, :])
            slope = ndimage.gaussian_filter1d(np.gradient(prof), 50)
            lit = np.clip(0.5 - slope[None, :] * 1500, 0, 1)
            col = mix(col, mix(rgb('#C9B8D8'), rgb('#FFE2C4'), lit[..., None]), snow[..., None])
        col = mix(col, rgb('#FFC98A'), max(0.0, 0.3 - i * 0.1))
        img = mix(img, col, mask[..., None])
    return mm.grain(rng, mm.vignette(img, 0.25), 0.02)


# ---------- breakfast in bed (top-down macro) ----------
def make_breakfast(rng, w=2400, h=2000):
    """Full-bleed berth: the tray fills every crop (no rim or border reads as a frame in any aspect); items sit in the central 0.3-0.7 of the width."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    tex = mm.fbm2(rng, h, w, 6, 30)
    # wool: warm dusty blue with a woven twill and soft folds
    folds = mm.fbm2(rng, h, w, 3, 260)
    img = mix(rgb('#3A4678'), rgb('#6A78AE'), (0.35 * tex + 0.65 * folds)[..., None])
    img = img * (0.86 + 0.16 * (0.5 + 0.5 * np.sin((xx + yy) / 7) * np.sin((xx - yy) / 7)))[..., None]
    tray = rrect_sdf(w, h, (-0.2 * w, -0.2 * h, 1.4 * w, 1.4 * h), 60)  # the tray bleeds off every crop
    wood = mix(rgb('#6A4426'), rgb('#9A6A3E'), (0.5 + 0.5 * np.sin(yy / 9 + mm.fbm2(rng, h, w, 4, 6) * 10))[..., None] * 0.6 + 0.2)
    img = mix(img, rgb('#0A0812'), soft(tray - 22, 40)[..., None] * 0.55)  # contact shadow on the blanket
    img = mix(img, rgb('#C79A62'), soft(tray, 2)[..., None])  # tray rim
    img = mix(img, wood, soft(tray + 26, 2)[..., None])
    # saucer + cup + coffee with a crema ring
    cx, cy = 0.42 * w, 0.46 * h
    for r, c in ((220, '#E9E2D6'), (150, '#F6F1E8'), (120, '#C9A27A'), (108, '#3B2213')):
        img = mix(img, rgb(c), soft(ellipse(w, h, cx, cy, r, r), 2)[..., None])
    handle = soft(ellipse(w, h, cx + 175, cy, 46, 26), 2) - soft(ellipse(w, h, cx + 175, cy, 26, 12), 2)
    img = mix(img, rgb('#F6F1E8'), np.clip(handle, 0, 1)[..., None])
    # plate + croissant (a crescent of lobes)
    px, py = 0.6 * w, 0.58 * h
    img = mix(img, rgb('#EFE8DC'), soft(ellipse(w, h, px, py, 290, 290), 2)[..., None])
    for k in range(-3, 4):
        a = k * 0.32
        lx, ly = px + np.sin(a) * 190, py + 66 - np.cos(a) * 126
        rr = 100 - abs(k) * 14
        shade = mix(rgb('#8A4A16'), rgb('#E0A050'), 0.6 + 0.4 * np.cos(a))
        img = mix(img, shade * (0.85 + 0.3 * tex[..., None]), soft(ellipse(w, h, lx, ly, rr, rr * 0.8), 3)[..., None])
    # juice glass
    gx, gy = 0.58 * w, 0.31 * h
    img = mix(img, rgb('#F2C46A'), soft(ellipse(w, h, gx, gy, 96, 96), 2)[..., None] * 0.95)
    img = mix(img, rgb('#FF9F43'), soft(ellipse(w, h, gx, gy, 76, 76), 2)[..., None])
    # a diagonal band of low sun through the window
    band = np.exp(-(((xx * 0.7 - yy * 0.5) - 0.05 * w) / (0.2 * w)) ** 2)
    img = np.clip(img * (0.62 + 0.6 * band[..., None]) + rgb('#FFB060') * band[..., None] * 0.1, 0, 1)
    return mm.grain(rng, mm.vignette(img, 0.4), 0.02)


# ---------- the ticket ----------
def make_ticket(rng, w=2400, h=1600):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    tex = mm.fbm2(rng, h, w, 6, 26)
    img = mix(rgb('#0E1230'), rgb('#1E2554'), tex[..., None])
    # ticket rotated ~-8 deg, lower right of the plate
    ang = np.deg2rad(-8)
    cx, cy = 0.62 * w, 0.62 * h
    u = (xx - cx) * np.cos(ang) + (yy - cy) * np.sin(ang)
    v = -(xx - cx) * np.sin(ang) + (yy - cy) * np.cos(ang)
    tw, th = 0.62 * w, 0.32 * h
    qx, qy = np.abs(u) - tw / 2 + 20, np.abs(v) - th / 2 + 20
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - 20
    img = mix(img, rgb('#05060F'), soft(d - 20, 40)[..., None] * 0.7)
    paper = mix(rgb('#E8DCC6'), rgb('#F4ECDD'), mm.fbm2(rng, h, w, 4, 10)[..., None])
    # printed bits: an accent header band, rules, a barcode on the stub, the perforation
    head = (v < -th / 2 + th * 0.24)
    paper = np.where(head[..., None], rgb('#FF9F43') * (0.9 + 0.1 * tex[..., None]), paper)
    for k in range(4):
        rl = np.abs(v - (-th * 0.05 + k * th * 0.11)) < 3
        paper = np.where((rl & (u < tw * 0.1) & (u > -tw * 0.42))[..., None], rgb('#B7AB97'), paper)
    perf = (np.abs(u - tw * 0.2) < 4) & (np.mod(v, 22) < 11)
    paper = np.where(perf[..., None], rgb('#9A8F7E'), paper)
    bars = rng.integers(0, 2, 90)
    bi = np.clip(((u - tw * 0.26) / (tw * 0.2) * 90).astype(int), 0, 89)
    code = (u > tw * 0.26) & (u < tw * 0.46) & (v > -th * 0.12) & (v < th * 0.3) & (bars[bi] == 1)
    paper = np.where(code[..., None], rgb('#1D1A22'), paper)
    img = mix(img, paper, soft(d, 2)[..., None])
    # punched hole
    hole = np.hypot(u + tw * 0.38, v - th * 0.3) < 18
    img[hole] = rgb('#0E1230')
    # the reading lamp's pool of light falls on the ticket; the upper left stays dark for the type
    pool = np.exp(-(((xx - 0.7 * w) / (0.5 * w)) ** 2 + ((yy - 0.7 * h) / (0.55 * h)) ** 2))
    img = img * (0.28 + 0.72 * pool[..., None])
    return mm.grain(rng, mm.vignette(img, 0.5), 0.02)


def main() -> None:
    rng = np.random.default_rng(SEED)
    os.makedirs(OUT, exist_ok=True)
    files, holes = [], {}
    for key in HOLES:
        img, alpha, meta = make_carriage(rng, key)
        p = os.path.join(OUT, f'carriage-{key}.png')
        write_png_rgba(img, alpha, p)
        files.append(p)
        holes[key] = meta
    with open(os.path.join(OUT, 'carriage.json'), 'w') as fh:
        json.dump(holes, fh, indent=1)
    files.append(os.path.join(OUT, 'carriage.json'))
    for name, fn in (('city-far.jpg', make_city_far), ('dawn.jpg', make_dawn), ('breakfast.jpg', make_breakfast), ('ticket.jpg', make_ticket)):
        p = os.path.join(OUT, name)
        mm.write_jpg(fn(rng), p)
        files.append(p)
    img, a = make_city_near(rng)
    p = os.path.join(OUT, 'city-near.png')
    write_png_rgba(img, a, p)
    files.append(p)
    print(json.dumps({'ok': True, 'files': files}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # one JSON line on failure too
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}))
        sys.exit(1)
