"""Generate Yammer's app icons from the three source images.

macOS: light/dark rounded-square icons on Apple's 1024 grid (824px body, continuous-corner squircle),
plus full-bleed light/dark squares in AppIcon.icon for the macOS 26 adaptive icon (../build-mac-icon.sh).
Windows/Linux: the transparent ribbon Y.

The light and dark sources are full-bleed squares on a flat background, and the Y is a different size in
each, so both are re-centred and scaled to the same share of the tile: the icon keeps its size when the
system theme flips.

Run from anywhere: python3 make_icons.py <path to apps/desktop> <scratch dir>
Then commit and push: mac-icon.yml recompiles icons/Assets.car, which macOS builds refuse to bundle until
it matches AppIcon.icon (../check-mac-icon.sh).
"""
import subprocess, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageChops

ROOT = Path(sys.argv[1])            # apps/desktop
SRC = ROOT / "src-tauri/icons/source"
ICONS = ROOT / "src-tauri/icons"
PUBLIC = ROOT / "public"
TMP = Path(sys.argv[2])

LIGHT = SRC / "yammer-light.png"    # Y on white
DARK = SRC / "yammer-dark.png"      # glowing Y on navy
MARK = SRC / "yammer-mark.png"      # Y on transparent

CANVAS, BODY = 1024, 824            # Apple macOS icon grid: 100px margin, 824px rounded body
ART = 0.74                          # the Y's longer side, as a share of the body
SS = 4                              # supersampling for the mask edge


def squircle_mask(size, r=0.344, n=3.26):
    """Apple's macOS icon shape: a rounded square with continuous corners. On the 824 body the corner
    radius is 185.4px (22.5%); a continuous corner starts its curve ~1.53x further in (34.4%), and n is
    chosen so the curve crosses the diagonal exactly where the 22.5% circle would."""
    s = size * SS
    c = (np.arange(s) + 0.5) / s
    d = np.maximum(r - np.minimum(c, 1 - c), 0) / r     # 0 on the straight edges, 1 at the corner
    x, y = np.meshgrid(d, d)
    m = (x ** n + y ** n <= 1).astype(np.uint8) * 255
    return Image.fromarray(m).resize((size, size), Image.LANCZOS)


def normalize(path):
    """Square crop of a full-bleed source with the Y centred and filling ART of it, padded with the
    source's own (flat) background colour where the crop runs past the image."""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    edge = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    bg = tuple(int(v) for v in np.median(edge, axis=0))
    ys, xs = np.nonzero(np.abs(a - bg).max(axis=2) > 40)   # the ribbon itself, not the dark one's glow
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    side = round(max(xs.max() - xs.min(), ys.max() - ys.min()) / ART)
    out = Image.new("RGB", (side, side), bg)
    out.paste(im, (round(side / 2 - cx), round(side / 2 - cy)))
    return out


def mac_icon(path):
    body = normalize(path).resize((BODY, BODY), Image.LANCZOS).convert("RGBA")
    body.putalpha(squircle_mask(BODY))
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    # Soft drop shadow, as in Apple's macOS icon template.
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sh_alpha = Image.new("L", (CANVAS, CANVAS), 0)
    sh_alpha.paste(body.getchannel("A").point(lambda v: v * 0.3), (100, 112))
    shadow.putalpha(sh_alpha.filter(ImageFilter.GaussianBlur(14)))
    out = Image.alpha_composite(out, shadow)
    out.alpha_composite(body, (100, 100))
    return out, body


def full_bleed(path):
    """Unmasked 1024 square for AppIcon.icon: macOS 26 applies its own shape, so the art must fill the canvas."""
    return normalize(path).resize((CANVAS, CANVAS), Image.LANCZOS)


def clean_mark(path):
    """Drop the background-removal specks around the Y and trim it to a square with a margin."""
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A")
    solid = a.point(lambda v: 255 if v > 40 else 0)
    keep = solid.filter(ImageFilter.MinFilter(15)).filter(ImageFilter.MaxFilter(15))  # opening kills small islands
    keep = keep.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2))   # re-grow edge, feather
    im.putalpha(ImageChops.multiply(a, keep))
    im = im.crop(im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())
    side = round(max(im.size) / 0.88)    # ~6% margin each side
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return sq.resize((1024, 1024), Image.LANCZOS)


def icns(master, dest):
    iconset = TMP / (dest.stem + ".iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    for s in (16, 32, 128, 256, 512):
        master.resize((s, s), Image.LANCZOS).save(iconset / f"icon_{s}x{s}.png")
        master.resize((s * 2, s * 2), Image.LANCZOS).save(iconset / f"icon_{s}x{s}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest)], check=True)


light, light_body = mac_icon(LIGHT)
dark, dark_body = mac_icon(DARK)
mark = clean_mark(MARK)

# macOS
light.save(ICONS / "macos-light.png")
dark.save(ICONS / "macos-dark.png")
icns(light, ICONS / "icon.icns")
icns(dark, ICONS / "icon-dark.icns")
assets = ICONS / "AppIcon.icon/Assets"
assets.mkdir(parents=True, exist_ok=True)
full_bleed(LIGHT).save(assets / "light.png")
full_bleed(DARK).save(assets / "dark.png")

# Windows / Linux
mark.save(ICONS / "icon.png")
for name, s in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256)]:
    mark.resize((s, s), Image.LANCZOS).save(ICONS / name)
for s in (30, 44, 71, 89, 107, 142, 150, 284, 310):
    mark.resize((s, s), Image.LANCZOS).save(ICONS / f"Square{s}x{s}Logo.png")
mark.resize((50, 50), Image.LANCZOS).save(ICONS / "StoreLogo.png")
mark.save(ICONS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# In-app logo: the transparent Y, which reads on both themes. Favicon: one tile per theme.
mark.resize((256, 256), Image.LANCZOS).save(PUBLIC / "yammer-mark.png")
light_body.resize((64, 64), Image.LANCZOS).save(PUBLIC / "favicon-light.png")
dark_body.resize((64, 64), Image.LANCZOS).save(PUBLIC / "favicon-dark.png")
print("done")
