"""Lift BGA's page background off a hand-taken screenshot, leaving transparency.

Step one of the two-step sequence a documentation screenshot needs; `border.py` is step two. A shot
cropped from a BGA table carries the wood texture at its edges, which is the host page rather than
the subject — bake a border around that and the frame preserves someone else's background.

**No second capture is needed.** The usual way to separate a subject from its backdrop is to shoot it
over two known backdrops and solve `O = C*a + B*(1-a)` per pixel, because both the colour and the
coverage are unknown. BGA's panels are rounded rectangles, so their *geometry* supplies the coverage,
and one capture is enough. Two details make it clean:

  * **Inset one pixel.** A mask alone leaves a fringe on the arcs, because the pixels it half-covers
    are genuinely half wood. Insetting past that band drops them. The corner ends up a pixel tighter,
    which is invisible at viewing size.
  * **The inset is also why nothing here un-blends.** Recovering a boundary pixel's true colour with
    `C = (O - B*(1-a)) / a` is correct only where the pixel actually contains backdrop. With the inset
    the mask boundary sits inside the subject, so a partial pixel is pure subject being antialiased,
    and subtracting a backdrop that is not in it over-brightens toward white — a 7%-alpha white fringe
    that passed every numeric check and showed only on screen. So the backdrop's colour is never
    measured, only its presence.

Masking by shape also sidesteps how close BGA's panel fill and wood are: about 28 levels of blue
apart, which no colour key separates reliably.

Usage: python key.py <file.png> [<file.png> ...]
"""

import statistics
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from border import contrast_grey

SS = 8            # mask supersampling, for a clean antialiased arc
INSET = 1         # pixels dropped from the subject's edge; see the module docstring
MIN_BAND = 20     # ignore non-backdrop runs shorter than this


def is_backdrop(p):
    """BGA's wood: markedly warmer than any panel fill, which no panel or control is."""
    return p[0] - p[2] > 60


def _bands(px, w, h):
    """Vertical runs that are not backdrop — one per subject."""
    xs = range(20, max(21, w - 20), 12)
    out, start = [], None
    for y in range(h):
        solid = sum(1 for x in xs if is_backdrop(px[x, y])) / len(xs) < 0.5
        if solid and start is None:
            start = y
        elif not solid and start is not None:
            if y - start > MIN_BAND:
                out.append((start, y - 1))
            start = None
    if start is not None and h - start > MIN_BAND:
        out.append((start, h - 1))
    return out


def _x_extent(px, w, y):
    x0, x1 = 0, w - 1
    while x0 < w and is_backdrop(px[x0, y]):
        x0 += 1
    while x1 > 0 and is_backdrop(px[x1, y]):
        x1 -= 1
    return x0, x1


def _radius(px, y0, x0, limit=16):
    """How far the top edge is inset on its first row — the arc's extent."""
    x = x0
    while x < x0 + limit and is_backdrop(px[x, y0]):
        x += 1
    return max(3, min(limit, x - x0 + 4))


def key(path: Path) -> tuple[list, int | None]:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()

    # Cheap presence check on a grid: nothing to key if the shot carries no backdrop at all. The
    # backdrop's *colour* is deliberately not measured — with an inset the mask never touches a pixel
    # that contains any of it, so there is nothing to subtract.
    if not any(is_backdrop(px[x, y]) for y in range(0, h, 4) for x in range(0, w, 4)):
        return [], None

    rects = []
    for y0, y1 in _bands(px, w, h):
        x0, x1 = _x_extent(px, w, (y0 + y1) // 2)
        rects.append((x0, y0, x1, y1, _radius(px, y0, x0)))

    mask = Image.new("L", (w, h), 0)
    for x0, y0, x1, y1, r in rects:
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        m = Image.new("L", (bw * SS, bh * SS), 0)
        ImageDraw.Draw(m).rounded_rectangle(
            [INSET * SS, INSET * SS, (bw - INSET) * SS - 1, (bh - INSET) * SS - 1], radius=r * SS, fill=255)
        mask.paste(m.resize((bw, bh), Image.LANCZOS), (x0, y0))

    # Outline the subject, not the canvas: a keyed image has no rectangular edge left, so a border
    # round the frame would enclose floating panels and the page between them. Median over a grid
    # rather than one sample — a lone pixel lands on text as often as on the fill.
    lums = []
    for x0, y0, x1, y1, _ in rects:
        for yy in range(y0 + 4, y1 - 3, max(1, (y1 - y0) // 24)):
            for xx in range(x0 + 4, x1 - 3, max(1, (x1 - x0) // 24)):
                r_, g_, b_ = px[xx, yy]
                lums.append(0.299 * r_ + 0.587 * g_ + 0.114 * b_)
    v = contrast_grey(statistics.median(lums))

    stroke = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(stroke)
    for x0, y0, x1, y1, r in rects:
        sd.rounded_rectangle([x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET], radius=r, outline=255, width=1)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op, mp, sp = out.load(), mask.load(), stroke.load()
    for y in range(h):
        for x in range(w):
            a = mp[x, y]
            if not a:
                continue
            op[x, y] = (*px[x, y], a)
            if sp[x, y]:
                op[x, y] = (v, v, v, 255)
    out.save(path)
    return rects, v


def trim_margin(path: Path, threshold: int = 235) -> int:
    """Drop trailing columns that are near-white for their whole height — BGA's page margin.

    Runs before `key`: the margin is not backdrop by the warmth test, so it would otherwise be taken
    for part of the subject and included in the rect.
    """
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    keep = w
    while keep > 0 and sum(1 for y in range(h) if min(px[keep - 1, y]) > threshold) / h > 0.98:
        keep -= 1
    if keep < w:
        im.crop((0, 0, keep, h)).save(path)
    return w - keep


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 1
    for name in sys.argv[1:]:
        path = Path(name).resolve()
        if not path.is_file():
            print(f"No such file: {path}", file=sys.stderr)
            return 1
        dropped = trim_margin(path)
        rects, v = key(path)
        if v is None:
            print(f"no backdrop found, left alone  {path.name}")
            continue
        print(f"{len(rects)} rect(s), outline #{v:02x}{v:02x}{v:02x}"
              f"{f', {dropped} margin col(s) trimmed' if dropped else ''}  {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
