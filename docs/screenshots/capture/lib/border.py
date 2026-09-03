"""Stamp a hairline border into a screenshot.

A shot whose own background matches the page it sits on has no visible boundary — a light app on a
light theme, a dark app on a dark theme — so the reader cannot see where the picture stops. The edge
has to live in the image rather than in the site's CSS, for three reasons: one CSS colour cannot suit
both of just-the-docs' colour schemes, a CSS border draws a *square* box around an image with
transparent rounded corners, and github.com strips `style` and never loads the site's stylesheet, so
a README image is out of a stylesheet's reach entirely.

A border contrasting with the image's *own* background is theme-independent by construction:
whichever of border-vs-page or image-vs-page lacks contrast, the other one has it.

This is step two. Step one — taking the background out to transparency — belongs to whatever produced
the shot; a frame that still carries the host page's background at its edges wants re-capturing, not
a border drawn around the wrong thing.

Usage: python border.py <file.png> [<file.png> ...] [--force]
"""

import sys
from pathlib import Path

from PIL import Image

# How far the hairline sits from the edge it has to contrast with, in luminance. Large enough to read
# at a glance on either theme, and clamped below so a mid-grey edge still gets a usable line.
CONTRAST = 130
DARKEST, LIGHTEST = 30, 225


def _edge_pixels(image: Image.Image) -> list[tuple[int, int, int]]:
    """The image's outermost ring, which is what a border has to contrast with."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    px = rgb.load()
    return (
        [px[x, 0] for x in range(width)]
        + [px[x, height - 1] for x in range(width)]
        + [px[0, y] for y in range(height)]
        + [px[width - 1, y] for y in range(height)]
    )


def _luminance(pixels: list[tuple[int, int, int]]) -> float:
    return sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels) / len(pixels)


def contrast_grey(luminance: float) -> int:
    """A neutral grey `CONTRAST` away from `luminance`, clamped short of pure black and white.

    Shared with `key.py`, which strokes an outline round a keyed subject: the two must agree, or a
    stroke and a border drawn on the same image would come out different greys.
    """
    return int(min(LIGHTEST, max(DARKEST, luminance + CONTRAST if luminance < 128 else luminance - CONTRAST)))


def has_border(image: Image.Image) -> bool:
    """Whether a hairline is already present, so stamping twice cannot double it.

    A uniform outer ring is not enough on its own: a shot padded with its own background has one too.
    The ring must also *contrast* with the ring inside it, which is what a border does and what
    padding never does.
    """
    width, height = image.size
    if width < 4 or height < 4:
        return False
    outer = _edge_pixels(image)
    first = outer[0]
    if any(max(abs(a - b) for a, b in zip(p, first)) > 8 for p in outer):
        return False
    inner = _edge_pixels(image.crop((1, 1, width - 1, height - 1)))
    return abs(_luminance(outer) - _luminance(inner)) > 40


def stamp(path: Path, force: bool = False) -> int | None:
    """Grow the canvas by one pixel a side and fill that ring. Returns the grey used, or None.

    Growing rather than overwriting the outermost row keeps the capture intact — no pixel of the
    subject is replaced by the frame.
    """
    image = Image.open(path)
    alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
    image = image.convert("RGBA" if alpha else "RGB")

    if not force and has_border(image):
        return None

    value = contrast_grey(_luminance(_edge_pixels(image)))
    colour = (value, value, value, 255) if alpha else (value, value, value)

    width, height = image.size
    framed = Image.new(image.mode, (width + 2, height + 2), colour)
    framed.paste(image, (1, 1))
    framed.save(path)
    return value


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]
    if not args:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 1
    for name in args:
        path = Path(name).resolve()
        if not path.is_file():
            print(f"No such file: {path}", file=sys.stderr)
            return 1
        value = stamp(path, force)
        print(f"{'skipped (already bordered)' if value is None else f'#{value:02x}{value:02x}{value:02x}'}  {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
