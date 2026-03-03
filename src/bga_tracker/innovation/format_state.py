"""
Innovation Game State Summary Formatter

Runs the state tracker on game_log.json and produces summary.html showing
hidden information from both perspectives, with card images.

Usage: python -m bga_tracker.innovation.format_state TABLE_ID

Input:  data/<TABLE_ID>/game_log.json + .env for PLAYER_NAME
Output: data/<TABLE_ID>/summary.html
"""

import re
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from bga_tracker import PROJECT_ROOT
from bga_tracker.innovation.card import Card, CardDB, CardInfo, COLOR_ORDER, SET_BASE, SET_CITIES
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.game_state import GameState
from bga_tracker.innovation.state_tracker import StateTracker

DATA_DIR = PROJECT_ROOT / "data"
CARDINFO_PATH = PROJECT_ROOT / "assets" / "cardinfo.json"

# Relative paths from summary.html (data/<TABLE_ID>/) to assets/
ICONS_REL = "../../assets/icons"
CARDS_REL = "../../assets/cards"

# Jinja2 environment
_TEMPLATE_DIR = PROJECT_ROOT / "templates" / "innovation"
_jinja_env = Environment(loader=FileSystemLoader(_TEMPLATE_DIR), autoescape=False)

_DOGMA_IMG_RE = re.compile(r'<img\s+src="/static/icons/inline-(\w+)\.png"\s*/?>')
_COLOR_NAMES_ORDERED = ["blue", "red", "green", "yellow", "purple"]  # BRGYP


# --- Data preparation helpers ---

def clean_dogma(dogma_list: tuple[str, ...] | list[str]) -> str:
    """Clean dogma HTML for tooltip text."""
    if not dogma_list:
        return ""
    lines = []
    for d in dogma_list:
        text = _DOGMA_IMG_RE.sub(lambda m: m.group(1), d)
        text = re.sub(r'<[^>]+>', '', text)
        text = ' '.join(text.split())
        lines.append(text)
    return '\n'.join(lines)


def _card_set_letter(card_set: int) -> str | None:
    """Return 'b' for base, 'c' for cities, else None."""
    if card_set == SET_BASE:
        return "b"
    if card_set == SET_CITIES:
        return "c"
    return None


def _is_suspected(card: Card, ghc: dict[tuple[int, int], int]) -> bool:
    """Check if opponent might suspect this card's identity."""
    return not card.opponent_knows_exact and bool(card.opponent_might_suspect) and len(card.opponent_might_suspect) < ghc[card.group_key]


def _prepare_card(info: CardInfo, star: bool = False, is_known: bool = False) -> dict:
    """Prepare a known card data dict for template rendering."""
    dogma_text = clean_dogma(info.dogmas)

    if info.card_set == SET_BASE and len(info.icons) == 4:
        layout = "base"
    elif info.card_set == SET_CITIES:
        layout = "cities"
    else:
        layout = "fallback"

    return {"type": "known", "name": info.name, "age": info.age, "color": info.color, "layout": layout, "cardnum": info.cardnum, "icons": info.icons, "dogma_text": dogma_text, "star": star, "is_known": is_known}


def _prepare_unknown(age: int | None = None, set_letter: str | None = None) -> dict:
    """Prepare an unknown card data dict for template rendering."""
    return {"type": "unknown", "age": age, "set_letter": set_letter}


def _prepare_toggle(target_id: str, options: list[tuple[str, str]], default: str) -> tuple[dict, str]:
    """Prepare toggle data and compute div attributes string.

    Returns (toggle_dict, div_attrs_string).
    """
    mode_aliases = {"show": "all", "hide": "none"}
    default_mode = mode_aliases.get(default, default)
    valid_modes = {m for m, _ in options}
    if default_mode not in valid_modes:
        default_mode = options[0][0]

    toggle = {"target_id": target_id, "options": [{"mode": mode, "label": label, "active": mode == default_mode} for mode, label in options]}

    attrs = ""
    if default_mode == "none":
        attrs += ' style="display:none"'
    if default_mode == "unknown":
        attrs += ' class="mode-unknown"'
    return toggle, attrs


def _prepare_opponent_zone(cards: list[Card], card_db: CardDB) -> list[dict]:
    """Prepare opponent's hand/score as a sorted list of card data dicts."""
    parsed = []
    for card in cards:
        if card.is_resolved:
            info = card_db[card.card_index]
            sort_key = (info.age, 0, COLOR_ORDER.get(info.color, 99), info.index_name)
            parsed.append((sort_key, _prepare_card(info)))
        else:
            sort_key = (card.age, 1, card.card_set, "")
            parsed.append((sort_key, _prepare_unknown(card.age, _card_set_letter(card.card_set))))
    parsed.sort(key=lambda x: x[0])
    return [item for _, item in parsed]


def _prepare_my_cards(cards: list[Card], card_db: CardDB, ghc: dict[tuple[int, int], int]) -> dict:
    """Prepare my hand/score as hidden/suspected/revealed lists."""
    if not cards:
        return {"hidden": [], "suspected": [], "revealed": []}
    known = sorted([c for c in cards if c.is_resolved], key=lambda c: card_db.sort_key(c.card_index))
    unknown = sorted([c for c in cards if not c.is_resolved], key=lambda c: (c.age, c.card_set))
    revealed = []
    suspected = []
    hidden = []
    for card in known:
        info = card_db[card.card_index]
        is_revealed = card.opponent_knows_exact
        item = _prepare_card(info, star=is_revealed)
        if is_revealed:
            revealed.append(item)
        elif _is_suspected(card, ghc):
            suspected.append(item)
        else:
            hidden.append(item)
    for card in unknown:
        hidden.append(_prepare_unknown(card.age, _card_set_letter(card.card_set)))
    return {"hidden": hidden, "suspected": suspected, "revealed": revealed}


def _prepare_deck(game_state: GameState, target_set: int) -> list[dict]:
    """Prepare deck age rows as a list of dicts."""
    card_db = game_state.card_db
    first_age = 1
    while first_age <= 10 and not game_state.decks.get((first_age, target_set), []):
        first_age += 1

    rows = []
    for age in range(first_age, 11):
        stack = game_state.decks.get((age, target_set), [])
        items = []
        for card in stack:
            if card.is_resolved:
                info = card_db[card.card_index]
                items.append(_prepare_card(info))
            else:
                items.append(_prepare_unknown())
        rows.append({"age": age, "cards": items})
    return rows


def _all_known_check(cards: list[CardInfo], known_names: set[str] | None) -> bool:
    """Check if all cards in a list are in known_names."""
    return known_names is not None and all(c.name in known_names for c in cards)


def _prepare_all_cards(card_set: int, card_db: CardDB, known_names: set[str] | None) -> dict:
    """Prepare all cards of a set for wide and tall layouts."""
    cards_by_age: dict[int, list[CardInfo]] = {}
    for card in card_db.values():
        if card.card_set != card_set:
            continue
        cards_by_age.setdefault(card.age, []).append(card)

    # Wide layout: one row per age
    wide_rows = []
    for age in range(1, 11):
        cards = sorted(cards_by_age.get(age, []), key=lambda c: (COLOR_ORDER.get(c.color, 99), c.name))
        if not cards:
            continue
        items = [_prepare_card(c, is_known=known_names is not None and c.name in known_names) for c in cards]
        wide_rows.append({"age": age, "cards": items, "all_known": _all_known_check(cards, known_names)})

    # Tall layout: 5 color columns (BRGYP), age label on the left
    grid: dict[tuple[int, str], list[CardInfo]] = {}
    for age in range(1, 11):
        for card in cards_by_age.get(age, []):
            grid.setdefault((age, card.color), []).append(card)
    for k in grid:
        grid[k].sort(key=lambda c: c.name)

    tall_rows = []
    for age in range(1, 11):
        max_per_color = max((len(grid.get((age, color), [])) for color in _COLOR_NAMES_ORDERED), default=0)
        if max_per_color == 0:
            continue
        all_age_cards = [c for color in _COLOR_NAMES_ORDERED for c in grid.get((age, color), [])]
        all_known = _all_known_check(all_age_cards, known_names)

        for row_idx in range(max_per_color):
            cells = []
            for color in _COLOR_NAMES_ORDERED:
                color_cards = grid.get((age, color), [])
                if row_idx < len(color_cards):
                    c = color_cards[row_idx]
                    cells.append(_prepare_card(c, is_known=known_names is not None and c.name in known_names))
                else:
                    cells.append(None)
            tall_rows.append({"age": age, "age_rowspan": max_per_color if row_idx == 0 else None, "all_known": all_known, "cells": cells})

    return {"wide_rows": wide_rows, "tall_rows": tall_rows}


def format_summary(game_state: GameState, table_id: str, config: Config) -> str:
    """Assemble the full summary as HTML."""
    me = game_state.perspective
    opponent = [p for p in game_state.players if p != me][0]
    card_db = game_state.card_db
    ghc = game_state.group_hidden_count()

    # Build sets of card display names known to me, by set
    resolved = game_state.resolved_card_indices()
    known_base = {card_db[idx].name for idx in resolved if card_db[idx].card_set == SET_BASE}
    known_cities = {card_db[idx].name for idx in resolved if card_db[idx].card_set == SET_CITIES}
    for idx in game_state.deduce_achievements():
        if idx:
            (known_base if card_db[idx].card_set == SET_BASE else known_cities).add(card_db[idx].name)

    # --- Build named sections ---
    named: dict[str, dict | None] = {}

    # Opponent hand
    opp_hand_items = _prepare_opponent_zone(game_state.hands[opponent], card_db)
    named["HAND_OPPONENT"] = {"type": "opponent_zone", "title": "Hand &mdash; opponent", "cards": opp_hand_items, "empty": not opp_hand_items}

    # My hand
    my_cards = _prepare_my_cards(game_state.hands[me], card_db, ghc)
    named["HAND_ME"] = {"type": "my_cards", "title": "Hand &mdash; me", "empty": not my_cards["hidden"] and not my_cards["suspected"] and not my_cards["revealed"], **my_cards}

    # Opponent score
    opp_score = game_state.scores[opponent]
    if opp_score:
        opp_score_items = _prepare_opponent_zone(opp_score, card_db)
        named["SCORE_OPPONENT"] = {"type": "opponent_zone", "title": "Score &mdash; opponent", "cards": opp_score_items, "empty": not opp_score_items}
    else:
        named["SCORE_OPPONENT"] = None

    # My score
    my_score = game_state.scores[me]
    if my_score:
        my_score_data = _prepare_my_cards(my_score, card_db, ghc)
        named["SCORE_ME"] = {"type": "my_cards", "title": "Score &mdash; me", "empty": not my_score_data["hidden"] and not my_score_data["suspected"] and not my_score_data["revealed"], **my_score_data}
    else:
        named["SCORE_ME"] = None

    # Achievements (ages 1-9)
    ach_toggle, ach_attrs = _prepare_toggle("achievements", [("none", "Hide"), ("all", "Show")], config.achievements)
    achl_toggle, _ = _prepare_toggle("achievements", [("wide", "Wide"), ("tall", "Tall")], config.ach_layout)
    ach_indices = game_state.deduce_achievements()
    ach_items = []
    for i, card_index in enumerate(ach_indices):
        age = i + 1
        if card_index is None:
            ach_items.append(_prepare_unknown(age))
        else:
            info = card_db[card_index]
            ach_items.append(_prepare_card(info))
    for age in range(len(ach_indices) + 1, 10):
        ach_items.append(_prepare_unknown(age))
    named["ACHIEVEMENTS"] = {"type": "achievements", "title": "Achievements", "toggle": ach_toggle, "layout_toggle": achl_toggle, "div_attrs": ach_attrs, "wide_items": ach_items, "tall_row1": ach_items[:5], "tall_row2": ach_items[5:], "wide_hide_attr": ' style="display:none"' if config.ach_layout == "tall" else "", "tall_hide_attr": ' style="display:none"' if config.ach_layout != "tall" else ""}

    # Base deck
    bd_toggle, bd_attrs = _prepare_toggle("base-deck", [("none", "Hide"), ("all", "Show")], config.base_deck)
    named["BASE_DECK"] = {"type": "deck", "title": "Base deck", "target_id": "base-deck", "toggle": bd_toggle, "div_attrs": bd_attrs, "age_rows": _prepare_deck(game_state, SET_BASE)}

    # Cities deck
    cd_toggle, cd_attrs = _prepare_toggle("cities-deck", [("none", "Hide"), ("all", "Show")], config.cities_deck)
    named["CITIES_DECK"] = {"type": "deck", "title": "Cities deck", "target_id": "cities-deck", "toggle": cd_toggle, "div_attrs": cd_attrs, "age_rows": _prepare_deck(game_state, SET_CITIES)}

    # Base list
    bl_toggle, bl_attrs = _prepare_toggle("base-list", [("none", "None"), ("all", "All"), ("unknown", "Unknown")], config.base_list)
    bll_toggle, _ = _prepare_toggle("base-list", [("wide", "Wide"), ("tall", "Tall")], config.base_layout)
    base_data = _prepare_all_cards(SET_BASE, card_db, known_base)
    named["BASE_LIST"] = {"type": "all_cards", "title": "Base list", "target_id": "base-list", "toggle": bl_toggle, "layout_toggle": bll_toggle, "div_attrs": bl_attrs, "wide_hide_attr": ' style="display:none"' if config.base_layout == "tall" else "", "tall_hide_attr": ' style="display:none"' if config.base_layout != "tall" else "", **base_data}

    # Cities list
    cl_toggle, cl_attrs = _prepare_toggle("cities-list", [("none", "None"), ("all", "All"), ("unknown", "Unknown")], config.cities_list)
    cll_toggle, _ = _prepare_toggle("cities-list", [("wide", "Wide"), ("tall", "Tall")], config.cities_layout)
    cities_data = _prepare_all_cards(SET_CITIES, card_db, known_cities)
    named["CITIES_LIST"] = {"type": "all_cards", "title": "Cities list", "target_id": "cities-list", "toggle": cl_toggle, "layout_toggle": cll_toggle, "div_attrs": cl_attrs, "wide_hide_attr": ' style="display:none"' if config.cities_layout == "tall" else "", "tall_hide_attr": ' style="display:none"' if config.cities_layout != "tall" else "", **cities_data}

    # --- Arrange sections into columns ---
    list_sections = {"BASE_LIST", "CITIES_LIST"}
    col_data: dict[int, list[tuple[float, str, dict]]] = {}
    for key, section in named.items():
        if section is None:
            continue
        col_num, pos = config.section_positions[key]
        col_data.setdefault(col_num, []).append((pos, key, section))
    for col_num in col_data:
        col_data[col_num].sort()

    num_cols = max(col_data) if col_data else 1
    columns = []
    if num_cols == 1:
        col_sections = col_data.get(1, [])
        columns.append({"width": "1fr", "sections": [s for _, _, s in col_sections]})
    else:
        for col_num in range(1, num_cols + 1):
            col_sections = col_data.get(col_num, [])
            has_list = any(k in list_sections for _, k, _ in col_sections)
            columns.append({"width": "auto" if has_list else "1fr", "sections": [s for _, _, s in col_sections]})

    grid_cols = " ".join(col["width"] for col in columns)

    template = _jinja_env.get_template("summary.html.j2")
    return template.render(table_id=table_id, icons_rel=ICONS_REL, cards_rel=CARDS_REL, num_cols=num_cols, columns=columns, grid_cols=grid_cols)


def find_table(table_id: str) -> tuple[Path, str]:
    """Find table data directory and opponent name from 'TABLE_ID opponent' folder."""
    matches = list(DATA_DIR.glob(f"{table_id} *"))
    if len(matches) != 1:
        raise FileNotFoundError(f"No unique table directory for '{table_id}' in {DATA_DIR}")
    table_dir = matches[0]
    opponent = table_dir.name.split(" ", 1)[1]
    return table_dir, opponent


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m bga_tracker.innovation.format_state TABLE_ID")
        sys.exit(1)

    config = Config.from_env()

    table_id = sys.argv[1]
    table_dir, opponent = find_table(table_id)
    players = [config.player_name, opponent]
    print(f"Players: {', '.join(players)}")

    game_log_path = table_dir / "game_log.json"
    card_db = CardDB(CARDINFO_PATH)
    tracker = StateTracker(card_db, players, config.player_name)
    game_state = tracker.process_log(game_log_path)

    html = format_summary(game_state, table_id, config)

    summary_path = table_dir / "summary.html"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Written: {summary_path}")


if __name__ == "__main__":
    main()
