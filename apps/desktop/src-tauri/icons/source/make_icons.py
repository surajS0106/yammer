"""Generate Larp's app icons from the three source images.

macOS: light/dark rounded-square icons on Apple's 1024 grid (824px body, continuous-corner squircle).
Windows/Linux: the transparent ribbon L.

Run from anywhere: python3 make_icons.py <path to apps/desktop> <scratch dir>
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

LIGHT = SRC / "larp-light.png"      # Glowing Neon Ribbon App Icon
DARK = SRC / "larp-dark.png"        # Neon Ribbon Gradient App Icon
MARK = SRC / "larp-mark.png"        # Glossy Gradient Ribbon L Logo (transparent)

CANVAS, BODY = 1024, 824            # Apple macOS icon grid
SS = 4                              # supersampling for the mask edge


def squircle_mask(size, r=0.30, n=3.0):
    """Rounded square with continuous (superellipse) corners, close to Apple's macOS icon shape:
    the corner curve starts 30% in and meets the diagonal where a 22.5%-radius circle would."""
    s = size * SS
    c = (np.arange(s) + 0.5) / s
    d = np.maximum(r - np.minimum(c, 1 - c), 0) / r     # 0 on the straight edges, 1 at the corner
    x, y = np.meshgrid(d, d)
    m = (x ** n + y ** n <= 1).astype(np.uint8) * 255
    return Image.fromarray(m).resize((size, size), Image.LANCZOS)


def opaque(img):
    """The sources sit at alpha ~252; snap the body to fully opaque."""
    r, g, b, a = img.convert("RGBA").split()
    a = a.point(lambda v: 255 if v >= 240 else v)
    return Image.merge("RGBA", (r, g, b, a))


def mac_icon(path):
    im = opaque(Image.open(path))
    body = im.crop((34, 34, 1220, 1220)).resize((BODY, BODY), Image.LANCZOS)
    body.putalpha(ImageChops.multiply(body.getchannel("A"), squircle_mask(BODY)))
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    # Soft drop shadow, as in Apple's macOS icon template.
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sh_alpha = Image.new("L", (CANVAS, CANVAS), 0)
    sh_alpha.paste(body.getchannel("A").point(lambda v: v * 0.3), (100, 112))
    shadow.putalpha(sh_alpha.filter(ImageFilter.GaussianBlur(14)))
    out = Image.alpha_composite(out, shadow)
    out.alpha_composite(body, (100, 100))
    return out, body


def clean_mark(path):
    """Drop the background-removal specks around the L and trim it to a square with a margin."""
    im = opaque(Image.open(path))
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

# Windows / Linux
mark.save(ICONS / "icon.png")
for name, s in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256)]:
    mark.resize((s, s), Image.LANCZOS).save(ICONS / name)
for s in (30, 44, 71, 89, 107, 142, 150, 284, 310):
    mark.resize((s, s), Image.LANCZOS).save(ICONS / f"Square{s}x{s}Logo.png")
mark.resize((50, 50), Image.LANCZOS).save(ICONS / "StoreLogo.png")
mark.save(ICONS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# In-app logo and favicon, one per theme
light_body.resize((256, 256), Image.LANCZOS).save(PUBLIC / "larp-icon-light.png")
dark_body.resize((256, 256), Image.LANCZOS).save(PUBLIC / "larp-icon-dark.png")
light_body.resize((64, 64), Image.LANCZOS).save(PUBLIC / "favicon-light.png")
dark_body.resize((64, 64), Image.LANCZOS).save(PUBLIC / "favicon-dark.png")
print("done")
