"""Screenshot one element of a rendered page.

Headless Chromium via Playwright, so a capture depends on nothing about the machine it runs on —
no window size, no theme, no other app open. Element-scoped rather than full-page because every
documentation shot here frames a single panel section.

Usage: python shoot.py --html <file> --out <file.png> [--selector <css>] [--width N] [--scale N]
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright


def _normalize(path: Path, pad: int) -> None:
    """Shrink the frame to what is actually drawn, then give it `pad` device pixels on every side.

    Framing by viewport width only works when the subject fills it. A section that stretches to its
    container, a page taller than its own content, or a grid whose widest row stops short each leave
    a band of background on one side and not the others. Trimming to the drawn pixels and re-padding
    makes the margin identical on all four sides whatever the subject did.

    Padding outward rather than clipping a wider region is deliberate: on a stacked layout the
    neighbouring section sits a few pixels away, so a generous clip frames the subject with someone
    else's content instead of background.
    """
    image = Image.open(path).convert("RGB")
    colour = image.getpixel((0, 0))
    box = ImageChops.difference(image, Image.new("RGB", image.size, colour)).getbbox()
    if box is None:
        return  # nothing but background; leave the frame alone rather than cropping to nothing
    content = image.crop(box)
    framed = Image.new("RGB", (content.width + pad * 2, content.height + pad * 2), colour)
    framed.paste(content, (pad, pad))
    framed.save(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--selector", default=None, help="element to frame; full page when omitted")
    parser.add_argument("--width", type=int, default=1400)
    parser.add_argument("--height", type=int, default=1200)
    # 1.5 is the device pixel ratio the committed screenshots were taken at, on a 150%-scaled
    # display. Rendering at 1.0 produces a correct but visibly smaller image, which would sit next
    # to the un-replaced shots on the same page at two different apparent zooms.
    parser.add_argument("--scale", type=float, default=1.5)
    parser.add_argument("--pad", type=int, default=16, help="uniform background margin, in device pixels of the output")
    args = parser.parse_args()

    html_path = Path(args.html).resolve()
    if not html_path.is_file():
        print(f"No such file: {html_path}", file=sys.stderr)
        return 1
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": args.width, "height": args.height},
            device_scale_factor=args.scale,
        )
        page.goto(html_path.as_uri())
        # The bundled woff2 faces load from disk; shooting before they land silently swaps in a
        # fallback typeface, which is a wrong screenshot that looks like a right one.
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(300)

        if args.selector:
            target = page.locator(args.selector).first
            if target.count() == 0:
                print(f"Selector matched nothing: {args.selector}", file=sys.stderr)
                browser.close()
                return 1
            # Scoped to the element so nothing of its neighbours can enter the frame; `normalize`
            # supplies the margin afterwards. Playwright scrolls the element into view and captures
            # it whole, so a subject taller than the viewport is not cropped to it.
            target.screenshot(path=str(out_path))
        else:
            page.screenshot(path=str(out_path), full_page=True)

        browser.close()

    _normalize(out_path, args.pad)

    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
