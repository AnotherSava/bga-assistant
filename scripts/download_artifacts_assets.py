"""
Download BGA Innovation Artifacts expansion assets and derive hex icons.

Two-step pipeline:
1. Download card face images from the bga-innovation GitHub repo. Artifacts in
   card_info.json are stored in BGA upstream id order (see
   extract_artifacts_cardinfo.py), so their sequential positions among set=4
   entries line up 1:1 with Print_ArtifactsCards_front-NNN.png numbering.
2. Derive per-card hex icons by cropping the circular icon from each downloaded
   card face and applying a circular alpha mask. Output matches the existing
   hex_NNN.png format: 64x64 RGBA with transparent corners.

Usage: python scripts/download_artifacts_assets.py
"""

import json
import os
import urllib.request

from PIL import Image, ImageDraw

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "bga", "innovation")
CARDS_DIR = os.path.join(ASSETS_DIR, "cards")
ICONS_DIR = os.path.join(ASSETS_DIR, "icons")
CARD_INFO_PATH = os.path.join(ASSETS_DIR, "card_info.json")

CARDS_BASE_URL = "https://raw.githubusercontent.com/micahstairs/bga-innovation/main-dev/misc/cards/"

# Hex icon crop box on a 750x550 artifact card face. The icon sits on the top-left.
HEX_CROP_BOX = (70, 70, 190, 190)
HEX_SIZE = 64


def load_cardinfo():
    with open(CARD_INFO_PATH) as f:
        return json.load(f)


def artifact_entries(cards):
    """Return (sprite_index, card_dict) pairs for set=4 artifacts that have a
    corresponding upstream image (card_info.json lists them in BGA image order;
    upstream publishes only the 105 non-relic artifacts — relic artifacts like
    Newton-Wickins Telescope are stored in card_info for state tracking but have
    no card face / hex icon to download)."""
    return [(i, c) for i, c in enumerate(cards) if c and c.get("set") == 4 and not c.get("is_relic")]


def download_artifacts_card_images():
    os.makedirs(CARDS_DIR, exist_ok=True)
    cards = load_cardinfo()
    entries = artifact_entries(cards)

    folder = "Print_ArtifactsCards_front"
    count = 0
    errors = 0
    for img_idx, (cardnum, _card) in enumerate(entries):
        webp = os.path.join(CARDS_DIR, f"card_{cardnum}.webp")
        png = os.path.join(CARDS_DIR, f"card_{cardnum}.png")
        if os.path.exists(webp) or os.path.exists(png):
            count += 1
            continue
        img_num = f"{img_idx + 1:03d}"
        url = f"{CARDS_BASE_URL}{folder}/{folder}-{img_num}.png"
        try:
            urllib.request.urlretrieve(url, png)
            count += 1
        except Exception as e:
            print(f"    Error downloading {url}: {e}")
            errors += 1

    print(f"  Card images: {count} fetched, {errors} errors")


def extract_artifact_hex_icons():
    """Crop the circular icon from each artifact card face and save as hex_NNN.png.

    Matches the visual style of existing hex icons: 64x64 RGBA with transparent
    corners (we use a circular mask since artifact icons are drawn in a circle,
    not a hexagon, on the card face)."""
    os.makedirs(ICONS_DIR, exist_ok=True)
    cards = load_cardinfo()

    mask = Image.new("L", (HEX_SIZE, HEX_SIZE), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, HEX_SIZE, HEX_SIZE), fill=255)

    count = 0
    missing = 0
    for cardnum, _card in artifact_entries(cards):
        src_png = os.path.join(CARDS_DIR, f"card_{cardnum}.png")
        src_webp = os.path.join(CARDS_DIR, f"card_{cardnum}.webp")
        src = src_png if os.path.exists(src_png) else src_webp
        if not os.path.exists(src):
            missing += 1
            continue
        dest = os.path.join(ICONS_DIR, f"hex_{cardnum}.png")
        face = Image.open(src).convert("RGB")
        icon = face.crop(HEX_CROP_BOX).resize((HEX_SIZE, HEX_SIZE), Image.LANCZOS)
        out = Image.new("RGBA", (HEX_SIZE, HEX_SIZE), (0, 0, 0, 0))
        out.paste(icon, (0, 0), mask)
        out.save(dest)
        count += 1

    print(f"  Hex icons: {count} extracted, {missing} missing source images")


def main():
    print("Step 1: Downloading Artifact card face images...")
    download_artifacts_card_images()
    print("Step 2: Extracting Artifact hex icons from card faces...")
    extract_artifact_hex_icons()
    print("Done!")


if __name__ == "__main__":
    main()
