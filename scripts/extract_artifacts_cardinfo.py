"""
One-time script: extract Artifacts of History card definitions from a BGA
raw_data.json archive and append them to assets/bga/innovation/card_info.json.

Reads gamedatas.cards with type="1" (BGA's Artifacts set id). Emits entries
with set=4 (the tracker's internal CardSet.ARTIFACTS id).

Also flags known relic cards (is_relic="1") across all sets with is_relic=true
in card_info.json so the engine can route them to the Available Relics zone
at game start.

Usage: python scripts/extract_artifacts_cardinfo.py data/bgaa_<TABLE>.zip
"""

import json
import os
import sys
import zipfile

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "bga", "innovation")
CARD_INFO_PATH = os.path.join(ASSETS_DIR, "card_info.json")

BGA_COLOR = {"0": "blue", "1": "red", "2": "green", "3": "yellow", "4": "purple"}
BGA_ICON = {
    "0": "hex", "1": "crown", "2": "leaf", "3": "lightbulb", "4": "castle", "5": "factory", "6": "clock",
    # Cities specials
    "8": "whiteflag", "9": "blackflag", "11": "left", "12": "right", "13": "up", "14": "plus",
    # Echoes special
    "7": "echo", "10": "hexnote",
}


def spot_to_icon(spot: str) -> str:
    if spot is None:
        return None
    s = str(spot)
    if s.startswith("10") and s != "10":
        # bonus-N: BGA encodes as 102..111 (subtract 100).
        return f"bonus-{int(s) - 100}"
    icon = BGA_ICON.get(s)
    if icon is None:
        raise KeyError(f"Unknown BGA icon value: {s!r}")
    return icon


def normalize_name(text: str) -> str:
    """Match src/games/innovation/process_log.ts normalizeName: replace U+2011 with '-' and strip combining marks."""
    import unicodedata
    text = text.replace("\u2011", "-")
    nfd = unicodedata.normalize("NFD", text)
    return "".join(c for c in nfd if not unicodedata.combining(c))


def load_raw_data(archive_path: str) -> dict:
    if archive_path.endswith(".zip"):
        with zipfile.ZipFile(archive_path) as zf:
            with zf.open("raw_data.json") as f:
                return json.load(f)
    with open(archive_path, "r", encoding="utf-8") as f:
        return json.load(f)


def card_to_entry(c: dict, set_id: int) -> dict:
    """Convert one gamedata card dict to a card_info.json entry."""
    icons = []
    for i in range(1, 7):
        spot = c.get(f"spot_{i}")
        if spot is None:
            break
        icons.append(spot_to_icon(spot))
    entry = {
        "name": normalize_name(c["name"]),
        "age": int(c["age"]),
        "color": BGA_COLOR[str(c["color"])],
        "set": set_id,
        "icons": icons,
    }
    if str(c.get("is_relic", "0")) == "1":
        entry["is_relic"] = True
    return entry


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <archive.zip | raw_data.json>", file=sys.stderr)
        sys.exit(1)

    raw = load_raw_data(sys.argv[1])
    cards = raw["gamedatas"]["cards"]

    with open(CARD_INFO_PATH, "r", encoding="utf-8") as f:
        card_info = json.load(f)

    # BGA type -> card_info set id. Figures (type=4) skipped — unsupported.
    SET_FROM_BGA_TYPE = {"0": 0, "2": 2, "3": 3, "1": 4}

    # Index existing card_info entries by case-insensitive name -> idx.
    name_to_idx = {entry["name"].lower(): i for i, entry in enumerate(card_info) if entry and entry.get("name")}

    # Upstream image sort: within each artifact (age, color RYGBP order, BGA id).
    # Emitting set=4 entries in this exact order keeps card_info index positions
    # aligned 1:1 with Print_ArtifactsCards_front-NNN.png.
    # - Include Yamato-style dataless artifacts (upstream publishes images for them)
    #   with hex-only placeholder icons so render doesn't crash.
    # - Append relic artifacts (e.g. Newton-Wickins) at the end — upstream image
    #   set of 105 excludes them.
    COLOR_ORDER = {"1": 0, "3": 1, "2": 2, "0": 3, "4": 4}  # R, Y, G, B, P

    relic_flagged = 0
    appended = 0
    skipped_incomplete = 0

    # First pass: flag relics / append missing relics for non-artifact sets (base, cities, echoes).
    for c in sorted(cards.values(), key=lambda c: int(c.get("id", 0))):
        name = c.get("name")
        if not name:
            continue
        bga_type = str(c.get("type"))
        if bga_type not in SET_FROM_BGA_TYPE or bga_type == "1":
            continue  # skip artifacts in this pass; unsupported sets dropped
        is_relic = str(c.get("is_relic", "0")) == "1"
        nm = normalize_name(name).lower()
        idx = name_to_idx.get(nm)
        if idx is not None:
            if is_relic and not card_info[idx].get("is_relic"):
                card_info[idx]["is_relic"] = True
                relic_flagged += 1
            continue
        if c.get("dogma_icon") is None or c.get("spot_1") is None:
            skipped_incomplete += 1
            continue
        card_info.append(card_to_entry(c, set_id=SET_FROM_BGA_TYPE[bga_type]))
        appended += 1

    # Second pass: artifacts (type=1) in upstream order — non-relics first,
    # then relics appended at the end.
    def artifact_key(c):
        return (int(c["age"]), COLOR_ORDER[str(c["color"])], int(c["id"]))

    artifacts_non_relic = [c for c in cards.values() if str(c.get("type")) == "1" and c.get("name") and str(c.get("is_relic", "0")) == "0"]
    artifacts_relic = [c for c in cards.values() if str(c.get("type")) == "1" and c.get("name") and str(c.get("is_relic", "0")) == "1"]
    artifacts_non_relic.sort(key=artifact_key)
    artifacts_relic.sort(key=artifact_key)

    for c in artifacts_non_relic + artifacts_relic:
        nm = normalize_name(c["name"]).lower()
        if name_to_idx.get(nm) is not None:
            continue  # already present
        if c.get("dogma_icon") is None or c.get("spot_1") is None:
            # Dataless artifact (e.g. Battleship Yamato). Upstream publishes an
            # image file for it, so we need to reserve the card_info slot.
            card_info.append({
                "name": normalize_name(c["name"]),
                "age": int(c["age"]),
                "color": BGA_COLOR[str(c["color"])],
                "set": 4,
                "icons": ["hex", "hex", "hex", "hex"],
            })
            appended += 1
            skipped_incomplete += 1
            continue
        card_info.append(card_to_entry(c, set_id=4))
        appended += 1

    with open(CARD_INFO_PATH, "w", encoding="utf-8") as f:
        json.dump(card_info, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Flagged {relic_flagged} relic cards in existing entries.")
    print(f"Appended {appended} new cards. Skipped {skipped_incomplete} incomplete. Total entries: {len(card_info)}.")


if __name__ == "__main__":
    main()
