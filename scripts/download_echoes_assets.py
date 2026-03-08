"""
Download BGA Innovation Echoes expansion assets.

Extracts hex icons and hexnote icon from the echoes hex sprite sheet,
and downloads card face images.

Usage: python scripts/download_echoes_assets.py
"""

import json
import os
import urllib.request

from PIL import Image

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "bga", "innovation")
SPRITES_DIR = os.path.join(ASSETS_DIR, "sprites")
ICONS_DIR = os.path.join(ASSETS_DIR, "icons")
CARDS_DIR = os.path.join(ASSETS_DIR, "cards")
CARD_INFO_PATH = os.path.join(ASSETS_DIR, "card_info.json")

BASE_URL = "https://raw.githubusercontent.com/micahstairs/bga-innovation/main-dev/img/"
CARDS_BASE_URL = "https://raw.githubusercontent.com/micahstairs/bga-innovation/main-dev/misc/cards/"

# Hex icon sprite sort order (same as base cards)
COLOR_ORDER = {"blue": 0, "red": 1, "green": 2, "yellow": 3, "purple": 4}

# Card face image sort order — echoes uses Y,G,R,P,B (different from base R,Y,G,B,P)
ECHOES_IMG_COLOR_ORDER = {"yellow": 0, "green": 1, "red": 2, "purple": 3, "blue": 4}


def load_cardinfo():
    with open(CARD_INFO_PATH) as f:
        return json.load(f)


def download_echoes_sprite():
    """Download the echoes hex sprite sheet if not present."""
    os.makedirs(SPRITES_DIR, exist_ok=True)
    dest = os.path.join(SPRITES_DIR, "hexagon_icons_echoes.png")
    if os.path.exists(dest):
        print(f"  Already exists: hexagon_icons_echoes.png")
        return
    url = BASE_URL + "hexagon_icons_echoes.png"
    print(f"  Downloading hexagon_icons_echoes.png...")
    urllib.request.urlretrieve(url, dest)


def extract_echoes_hex_icons():
    """Extract hexagon icons for echoes cards from the echoes sprite sheet.

    Sprite layout (same grid as base): 15 columns, 10 rows.
    CSS M-size: background-size 735px, offset 49px, start 3px, icon 45x45.
    Row 0: 15 cols (age 1), Rows 1-9: 10 cols each (ages 2-10).
    Special icons: col 10 row 1 = plain hex, col 11 row 1 = music note (hexnote).
    """
    sprite = Image.open(os.path.join(SPRITES_DIR, "hexagon_icons_echoes.png"))
    w, h = sprite.size
    scale = w / 735
    offset = 49 * scale
    start = 3 * scale
    icon_px = round(45 * scale)

    cards = load_cardinfo()

    # Echoes cards (set 3)
    echoes = [(i, c) for i, c in enumerate(cards) if c and c.get("set") == 3]
    sorted_echoes = sorted(
        echoes, key=lambda x: (x[1]["age"], COLOR_ORDER[x[1]["color"]], x[0])
    )

    for sprite_idx, (cardnum, _card) in enumerate(sorted_echoes):
        if sprite_idx < 15:
            row, col = 0, sprite_idx
        else:
            row = 1 + (sprite_idx - 15) // 10
            col = (sprite_idx - 15) % 10

        x = round(start + col * offset)
        y = round(start + row * offset)
        icon = sprite.crop((x, y, x + icon_px, y + icon_px))
        icon.save(os.path.join(ICONS_DIR, f"hex_{cardnum}.png"))

    print(f"  Extracted {len(sorted_echoes)} echoes hex icons")

    # Extract music note (hexnote) icon from row 1, col 11
    x = round(start + 11 * offset)
    y = round(start + 1 * offset)
    hexnote = sprite.crop((x, y, x + icon_px, y + icon_px))
    hexnote.save(os.path.join(ICONS_DIR, "hexnote_purple.png"))
    print("  Extracted hexnote (music note) icon")


def download_echoes_card_images():
    """Download card face images for the echoes set.

    Images sorted by (age, color, name) where color order is Y,G,R,P,B.
    Echoes: Print_EchoesCards_front-001.png to -105.png
    """
    os.makedirs(CARDS_DIR, exist_ok=True)
    cards = load_cardinfo()

    echoes = [(i, c) for i, c in enumerate(cards) if c and c.get("set") == 3]
    sorted_cards = sorted(
        echoes,
        key=lambda x: (x[1]["age"], ECHOES_IMG_COLOR_ORDER[x[1]["color"]], x[1]["name"])
    )

    folder = "Print_EchoesCards_front"
    count = 0
    errors = 0
    for img_idx, (cardnum, _card) in enumerate(sorted_cards):
        dest = os.path.join(CARDS_DIR, f"card_{cardnum}.png")
        if os.path.exists(dest):
            count += 1
            continue
        img_num = f"{img_idx + 1:03d}"
        url = f"{CARDS_BASE_URL}{folder}/{folder}-{img_num}.png"
        print(f"  Downloading {folder}-{img_num}.png -> card_{cardnum}.png")
        try:
            urllib.request.urlretrieve(url, dest)
            count += 1
        except Exception as e:
            print(f"    Error: {e}")
            errors += 1

    print(f"  Echoes: {count} card images downloaded, {errors} errors")


def main():
    os.makedirs(ICONS_DIR, exist_ok=True)

    print("Step 1: Downloading echoes sprite sheet...")
    download_echoes_sprite()

    print("Step 2: Extracting echoes hex icons...")
    extract_echoes_hex_icons()

    print("Step 3: Downloading echoes card face images...")
    download_echoes_card_images()

    print("Done!")


if __name__ == "__main__":
    main()
