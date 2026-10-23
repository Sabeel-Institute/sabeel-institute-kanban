#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["cairosvg", "pillow", "numpy"]
# ///
"""
Build the Sabeel app icons: one shared calligraphic mark, one badge per app.

    uv run scripts/make-app-icons.py kanban
    uv run scripts/make-app-icons.py timetracker --repo ../sabeel-institute-time-tracker
    uv run scripts/make-app-icons.py recordings  --repo ../sabeel-recording-app

Three Sabeel apps share one identity, so they share one generator. The mark is
the brand; the badge says which app. See docs/BRAND.md for the palette.

WHY THIS WRITES ANDROID RESOURCES TOO
-------------------------------------
All three repos COMMIT their `android/` directory, so `app.json` and
`assets/icon.png` alone change nothing a build would see: Gradle compiles the
mipmaps under `android/app/src/main/res`. Expo regenerates those during
`prebuild`, but prebuild also rewrites `build.gradle` from its template — which
would silently drop each repo's release signing and Sentry setup. So this
script writes exactly what prebuild would write, and nothing else.

The output matches `@expo/prebuild-config` (withAndroidIcons.js): a foreground
at 108dp per density, legacy square and round icons at 48dp, the two
`mipmap-anydpi-v26` XMLs, and an `iconBackground` colour. A later prebuild is
therefore a no-op on icons rather than a conflict.

THE GEOMETRY IS MEASURED, NOT CHOSEN
------------------------------------
An adaptive icon's foreground fills the whole 108dp layer, of which only the
central 72dp is guaranteed to survive the launcher's mask. That is 66.67%, so on
this 1024 canvas the safe radius is 341 — NOT the 350 that a "roughly two
thirds" reading suggests. The difference is 9px of badge edge that a circular
mask would quietly shave off.

Within that circle three quantities trade against each other, and each bound
below was found by rendering candidates and counting pixels (see `--check`,
which re-proves both invariants on every run):

  * BADGE SIZE. 410px hides zero calligraphy; 418px starts cutting the sweep.
    414px is also free, but 410 keeps a margin off a measured wall.
  * HOW LOW THE MARK SITS. Dropping it is what frees the upper arc for a large
    badge, but at cy=643 its own descender reaches 343 and leaves the circle.
  * BEARING. Flatter reads as a corner badge rather than a stacked lockup, but
    walks into the calligraphy; 36 deg already hides 12px, so 38 is the floor.

Mark and badge both end up 338 from centre, three pixels inside the wall: the
composition is pressed against the same circle from two directions at once.

The badge lands where the wordmark used to be. That is deliberate: the lockup's
text is illegible at launcher sizes, so it is dropped, and the hole it leaves is
the one place a badge costs the calligraphy nothing. The conventional
bottom-right corner sits on the sweep and buries the gold accent.
"""

from __future__ import annotations

import argparse
import base64
import math
import re
import sys
from io import BytesIO
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image, ImageDraw

# --- brand (docs/BRAND.md — Option 1 palette) -------------------------------
IVORY = "#F6EBDD"  # Warm Ivory: the canvas, and the only background
PLUM = "#83114F"  # Dark Raspberry: spent on the badge alone
ON_PLUM = "#F9F2E9"  # ivory on plum is 8.8:1

# --- geometry (see module docstring; every number here is measured) ----------
CANVAS = 1024
SAFE_R = 341  # 72dp of the 108dp adaptive layer
BADGE_R = 205
MARK_W = 507
MARK_CY = 637
BEARING = 38  # degrees above horizontal, from centre
RING = 14  # ivory separation between badge and mark

MARK_SRC = Path("docs/brand/sabeel-mark.png")
MARK_NATIVE = (1536, 949)

APPS = {
    "kanban": ("board", "."),
    "timetracker": ("stopwatch", "../sabeel-institute-time-tracker"),
    "recordings": ("mic", "../sabeel-recording-app"),
}

# Density buckets, and the baseline sizes @expo/prebuild-config uses.
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
LEGACY_BASE = 48
ADAPTIVE_BASE = 108

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""


def badge_glyph(kind: str, cx: float, cy: float, r: float) -> str:
    """The per-app glyph, drawn in a -100..100 space then placed on the badge."""
    g = (
        f'<g transform="translate({cx},{cy}) scale({r / 100.0})" fill="none" '
        f'stroke="{ON_PLUM}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">'
    )
    if kind == "stopwatch":
        g += (
            '<circle cx="0" cy="8" r="46"/>'
            '<path d="M-16 -46 h32"/>'  # crown bar
            '<path d="M0 -46 v10"/>'  # stem
            '<path d="M0 8 v-24 M0 8 h20"/>'  # hands
        )
    elif kind == "board":
        # Three columns at different fills — a board, still legible as bars at 48dp.
        g += (
            f'<g fill="{ON_PLUM}" stroke="none">'
            '<rect x="-54" y="-42" width="30" height="84" rx="9"/>'
            '<rect x="-15" y="-42" width="30" height="58" rx="9"/>'
            '<rect x="24" y="-42" width="30" height="36" rx="9"/>'
            "</g>"
        )
    elif kind == "mic":
        g += (
            '<rect x="-17" y="-52" width="34" height="58" rx="17"/>'
            '<path d="M-34 -2 a34 34 0 0 0 68 0"/>'
            '<path d="M0 32 v18"/>'
        )
    else:
        raise ValueError(f"unknown glyph {kind!r}")
    return g + "</g>"


def icon_svg(mark_uri: str, kind: str, *, badge: bool = True, background: bool = True) -> str:
    """background=False yields the adaptive foreground layer (transparent)."""
    h = MARK_W * MARK_NATIVE[1] / MARK_NATIVE[0]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">'
    ]
    if background:
        parts.append(f'<rect width="{CANVAS}" height="{CANVAS}" fill="{IVORY}"/>')
    parts.append(
        f'<image x="{(CANVAS - MARK_W) / 2}" y="{MARK_CY - h / 2}" '
        f'width="{MARK_W}" height="{h}" xlink:href="{mark_uri}"/>'
    )
    if badge:
        # Tangent to the safe circle: a bigger badge walks inward along the same
        # bearing, which is the only direction with room.
        t = math.radians(BEARING)
        d = SAFE_R - BADGE_R - 4
        bx, by = CANVAS / 2 + d * math.cos(t), CANVAS / 2 - d * math.sin(t)
        # The ring keeps the badge legible where it passes near a stroke; it is
        # drawn even on the transparent layer, so the mark never touches it.
        parts.append(f'<circle cx="{bx}" cy="{by}" r="{BADGE_R + RING}" fill="{IVORY}"/>')
        parts.append(f'<circle cx="{bx}" cy="{by}" r="{BADGE_R}" fill="{PLUM}"/>')
        parts.append(badge_glyph(kind, bx, by, BADGE_R))
    parts.append("</svg>")
    return "".join(parts)


def render(svg: str, size: int = CANVAS) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(BytesIO(png)).convert("RGBA")


def verify(mark_uri: str, kind: str) -> tuple[float, int]:
    """
    Re-prove the two invariants on the pixels actually produced.

    Returns (max ink radius, calligraphy pixels hidden). Both bounds are the
    whole basis for the geometry, so they are checked on every run rather than
    trusted from the session that first measured them.
    """
    ivory = np.array([246, 235, 221])
    bare = np.array(render(icon_svg(mark_uri, kind, badge=False)).convert("RGB")).astype(int)
    full = np.array(render(icon_svg(mark_uri, kind)).convert("RGB")).astype(int)

    dark = (np.abs(bare - ivory).sum(axis=2) > 40) & (bare.sum(axis=2) < 300)
    ink = np.abs(full - ivory).sum(axis=2) > 40
    still = ink & (full.sum(axis=2) < 300)

    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS]
    radius = np.sqrt((xx - CANVAS / 2) ** 2 + (yy - CANVAS / 2) ** 2)
    return float(radius[ink].max()), int((dark & ~still).sum())


def circle_crop(img: Image.Image) -> Image.Image:
    out = img.copy()
    mask = Image.new("L", out.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, out.size[0] - 1, out.size[1] - 1), fill=255)
    out.putalpha(mask)
    return out


def ensure_icon_background(colors_xml: Path) -> None:
    """Add the adaptive background colour without reformatting the file."""
    text = colors_xml.read_text() if colors_xml.exists() else "<resources>\n</resources>\n"
    if 'name="iconBackground"' in text:
        text = re.sub(
            r'(<color name="iconBackground">)[^<]*(</color>)', rf"\g<1>{IVORY}\g<2>", text
        )
    else:
        text = text.replace(
            "</resources>", f'  <color name="iconBackground">{IVORY}</color>\n</resources>'
        )
    colors_xml.parent.mkdir(parents=True, exist_ok=True)
    colors_xml.write_text(text)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app", choices=sorted(APPS), help="which app's badge to build")
    ap.add_argument("--repo", help="repo root to write into (default: the app's sibling path)")
    ap.add_argument("--check", action="store_true", help="verify the geometry and write nothing")
    args = ap.parse_args()

    kind, default_repo = APPS[args.app]
    here = Path(__file__).resolve().parent.parent
    repo = Path(args.repo) if args.repo else (here / default_repo)
    repo = repo.resolve()

    mark = here / MARK_SRC
    if not mark.is_file():
        ap.error(f"mark source not found: {mark}")
    mark_uri = "data:image/png;base64," + base64.b64encode(mark.read_bytes()).decode()

    max_r, hidden = verify(mark_uri, kind)
    print(f"badge {2 * BADGE_R}px ({200 * BADGE_R / CANVAS:.0f}% of icon)")
    print(f"  max ink radius   {max_r:6.1f} of {SAFE_R} safe")
    print(f"  calligraphy hidden {hidden:>4} px")
    if max_r > SAFE_R:
        print(f"FAIL: ink reaches {max_r:.1f}, outside the {SAFE_R}px safe circle", file=sys.stderr)
        return 1
    if hidden:
        print(f"FAIL: the badge hides {hidden}px of calligraphy", file=sys.stderr)
        return 1
    if args.check:
        return 0

    assets = repo / "app" / "assets"
    if not assets.parent.is_dir():
        ap.error(f"no app/ directory under {repo}")
    assets.mkdir(parents=True, exist_ok=True)

    master = render(icon_svg(mark_uri, kind))
    foreground = render(icon_svg(mark_uri, kind, background=False))

    master.convert("RGB").save(assets / "icon.png")
    foreground.save(assets / "adaptive-icon.png")
    master.convert("RGB").resize((196, 196), Image.LANCZOS).save(assets / "favicon.png")
    print(f"wrote {assets}/icon.png, adaptive-icon.png, favicon.png")

    res = repo / "app" / "android" / "app" / "src" / "main" / "res"
    if not res.is_dir():
        print(f"note: no committed android/ under {repo}; skipped native resources")
        return 0

    for folder, scale in DENSITIES.items():
        d = res / f"mipmap-{folder}"
        d.mkdir(parents=True, exist_ok=True)
        legacy = round(LEGACY_BASE * scale)
        adaptive = round(ADAPTIVE_BASE * scale)
        master.convert("RGB").resize((legacy, legacy), Image.LANCZOS).save(
            d / "ic_launcher.webp", lossless=True
        )
        circle_crop(master.resize((legacy, legacy), Image.LANCZOS)).save(
            d / "ic_launcher_round.webp", lossless=True
        )
        foreground.resize((adaptive, adaptive), Image.LANCZOS).save(
            d / "ic_launcher_foreground.webp", lossless=True
        )

    anydpi = res / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(ADAPTIVE_XML)
    (anydpi / "ic_launcher_round.xml").write_text(ADAPTIVE_XML)
    ensure_icon_background(res / "values" / "colors.xml")
    print(f"wrote {res} (mipmaps, anydpi-v26 XML, iconBackground)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
