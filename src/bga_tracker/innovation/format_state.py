"""
Innovation Game State Summary Formatter

Reads game_state.json and produces summary.html showing hidden information
from both perspectives, with card images.

Usage: python -m bga_tracker.innovation.format_state TABLE_ID

Input:  data/<TABLE_ID>/game_state.json + .env for PLAYER_NAME
Output: data/<TABLE_ID>/summary.html
"""

import json
import sys
from itertools import groupby
from dataclasses import dataclass, field
from jinja2 import Environment, FileSystemLoader

from bga_tracker.innovation.paths import CARD_INFO_PATH, TEMPLATE_DIR, find_table
from bga_tracker.innovation.card import Card, CardDatabase, CardInfo, CardSet, Color
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.game_state import GameState

# Relative paths from summary.html (data/<TABLE_ID>/) to assets/
ICONS_REL = "../../assets/icons"
CARDS_REL = "../../assets/cards"
TALL_COLUMNS = len(Color)  # number of columns in tall layout (one per color)

# Jinja2 environment
_jinja_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=False)



@dataclass(frozen=True, slots=True)
class TemplateCard:
    """A card prepared for template rendering. Known cards have name/color/icons; unknown cards only have age/layout."""
    known: bool                            # True = named card with full info, False = unknown placeholder
    age: int | None                        # card age 1-10, None for blank deck slots
    card_set: CardSet                      # BASE or CITIES — selects card grid layout
    name: str | None = None                # display name (known only)
    color: Color | None = None             # CSS color class (known only)
    sprite_index: int | None = None         # index into BGA sprite sheet (known only)
    icons: tuple[str, ...] | None = None   # resource icon names for grid cells (known only)
    resolved: bool = False                 # identity known to the tracker (masked in "Unknown" view)


@dataclass(frozen=True, slots=True)
class Row:
    """A card row within a section, optionally labelled."""
    cards: list[TemplateCard | None]  # None for empty cells in table layout
    label: str = ""                   # icon key ("eye_closed"|"eye_open"|"question"), age ("1"-"10"), or "" (blank)
    all_known: bool = False           # CSS class for unknown-mode row hiding


@dataclass
class Section:
    """Generic section — replaces all per-type section dataclasses."""
    title: str
    section_id: str                      # kebab-case identifier for config lookup and DOM targeting
    toggle: dict | None = None           # visibility toggle
    layout_toggle: dict | None = None    # wide/tall toggle
    rows: list[Row] = field(default_factory=list)  # primary (wide) layout
    column_count: int = 0                # >0: tall layout splits rows into table
    arrange_by_columns: bool = True      # tall grid order: True = column-major (color columns), False = row-major
    empty: bool = False                  # show "empty" placeholder
    mark_resolved: bool = False          # add data-known attrs for unknown-mode masking



# --- Data preparation helpers ---

def _prepare(info: CardInfo | None = None, *, age: int | None = None, card_set: CardSet = CardSet.BASE, resolved: bool = False) -> TemplateCard:
    """Prepare a card for template rendering. Known card if info is given, unknown otherwise."""
    if info is not None:
        return TemplateCard(known=True, age=info.age, card_set=info.card_set, name=info.name, color=info.color, sprite_index=info.sprite_index, icons=info.icons, resolved=resolved)
    return TemplateCard(known=False, age=age, card_set=card_set)


def _visibility_toggle(target_id: str, default: str, none_label: str, all_label: str, unknown_label: str | None = None) -> dict:
    """Prepare visibility toggle (none/all, optionally unknown)."""
    options = [("none", none_label), ("all", all_label)]
    if unknown_label is not None:
        options.append(("unknown", unknown_label))
    config_to_mode = {"hide": "none", "none": "none", "show": "all", "unknown": "unknown"}
    default_mode = config_to_mode.get(default, "none")
    return {"target_id": target_id, "default_mode": default_mode, "options": [{"mode": mode, "label": label, "active": mode == default_mode} for mode, label in options]}


def _layout_toggle(target_id: str, default: str) -> dict:
    """Prepare layout toggle (wide/tall)."""
    options = [("wide", "Wide"), ("tall", "Tall")]
    return {"target_id": target_id, "default_mode": default, "options": [{"mode": mode, "label": label, "active": mode == default} for mode, label in options]}


class SummaryFormatter:
    """Formats game state into an HTML summary.

    Stores game_state, table_id, and config as instance state, eliminating
    repeated parameter threading through helper methods.
    """

    def __init__(self, game_state: GameState, table_id: str, config: Config, card_db: CardDatabase, players: list[str], perspective: str) -> None:
        self.game_state = game_state
        self.table_id = table_id
        self.config = config
        self.card_db = card_db
        self.me = perspective
        self.opponent = [player for player in players if player != self.me][0]

    def _card_sort_key(self, card: Card) -> tuple:
        """Sort key for a Card: (age, is_unknown, color_order, name)."""
        if card.is_resolved:
            info = self.card_db[card.card_index]
            return info.age, 0, info.color, info.index_name
        return card.age, 1, card.card_set, ""

    def _from_card(self, card: Card) -> TemplateCard:
        """Prepare a TemplateCard from a Card — resolves info lookup and known/unknown dispatch."""
        if card.is_resolved:
            return _prepare(self.card_db[card.card_index], resolved=True)
        return _prepare(age=card.age, card_set=card.card_set)

    def _prepare_cards(self, cards: list[Card], label: str = "", *, sort: bool = True) -> Row:
        """Prepare cards for template rendering and wrap in a Row. Sorts by default."""
        ordered = sorted(cards, key=self._card_sort_key) if sort else cards
        return Row([self._from_card(card) for card in ordered], label)

    def _prepare_my_cards(self, zone: list[Card]) -> list[Row]:
        """Classify cards by opponent knowledge and prepare rows.

        - revealed: opponent_knows_exact
        - suspected: opponent has a partial suspect list
        - hidden: everything else
        """
        rows = []

        hidden_cards = [card for card in zone if self.game_state.opponent_knows_nothing(card)]
        if hidden_cards:
            rows.append(self._prepare_cards(hidden_cards, "eye_closed"))

        suspected_cards = [card for card in zone if self.game_state.opponent_has_partial_information(card)]
        if suspected_cards:
            rows.append(self._prepare_cards(suspected_cards, "question"))

        revealed_cards = [card for card in zone if card.opponent_knows_exact]
        if revealed_cards:
            rows.append(self._prepare_cards(revealed_cards, "eye_open"))

        return rows

    def _prepare_deck(self, target_set: CardSet) -> list[Row]:
        """Prepare deck age rows as Row objects."""
        rows = []
        empty_ages = True
        for age in range(1, 11):
            cards = self.game_state.decks[age, target_set]
            if empty_ages and not cards:
                continue
            empty_ages = False
            rows.append(self._prepare_cards(cards, str(age), sort=False))
        return rows

    def _prepare_all_cards(self, card_set: CardSet) -> list[Row]:
        """Prepare all cards of a set in color-grouped order (one row per age)."""
        game_state = self.game_state

        rows: list[Row] = []
        for age in range(1, 11):
            cards_info = self.card_db.group_infos(age, card_set)
            all_known = game_state.resolved_count(age, card_set) == len(cards_info)
            items = [_prepare(info, resolved=game_state.is_resolved(info.index_name)) for info in cards_info]
            rows.append(Row(items, str(age), all_known=all_known))
        return rows

    def _make_section(self, section_id: str, title: str, rows: list[Row], *, has_unknown: bool = False, column_count: int = 0, arrange_by_columns: bool = True, mark_resolved: bool = False) -> Section:
        """Build a section with visibility/layout toggles derived from config by section_id."""
        config_key = section_id.replace("-", "_")
        default_visibility = getattr(self.config, config_key)
        if has_unknown:
            toggle = _visibility_toggle(section_id, default_visibility, "None", "All", "Unknown")
        else:
            toggle = _visibility_toggle(section_id, default_visibility, "Hide", "Show")
        layout_toggle = _layout_toggle(section_id, getattr(self.config, config_key + "_layout")) if column_count > 0 else None
        empty = not any(row.cards for row in rows)
        return Section(section_id=section_id, title=title, toggle=toggle, layout_toggle=layout_toggle, rows=rows, column_count=column_count, arrange_by_columns=arrange_by_columns, empty=empty, mark_resolved=mark_resolved)

    def render(self) -> str:
        """Assemble the full summary as HTML."""
        game_state = self.game_state
        config = self.config

        opponent_hand = self._prepare_cards(game_state.hands[self.opponent])
        opponent_score = self._prepare_cards(game_state.scores[self.opponent])
        achievements = self._prepare_cards(game_state.achievements)

        sections: list[Section] = [
            self._make_section("hand-opponent", "Hand &mdash; opponent", [opponent_hand]),
            self._make_section("hand-me", "Hand &mdash; me", self._prepare_my_cards(game_state.hands[self.me])),
            self._make_section("score-opponent", "Score &mdash; opponent", [opponent_score]),
            self._make_section("score-me", "Score &mdash; me", self._prepare_my_cards(game_state.scores[self.me])),
            self._make_section("achievements", "Achievements", [achievements], column_count=TALL_COLUMNS, arrange_by_columns=False),
            self._make_section("base-deck", "Base deck", self._prepare_deck(CardSet.BASE)),
            self._make_section("cities-deck", "Cities deck", self._prepare_deck(CardSet.CITIES)),
            self._make_section("base-list", "Base list", self._prepare_all_cards(CardSet.BASE), has_unknown=True, column_count=TALL_COLUMNS, mark_resolved=True),
            self._make_section("cities-list", "Cities list", self._prepare_all_cards(CardSet.CITIES), has_unknown=True, column_count=TALL_COLUMNS, mark_resolved=True),
        ]

        # --- Arrange sections into columns ---
        sections.sort(key=lambda s: config.section_positions[s.section_id])
        columns = [list(g) for _, g in groupby(sections, key=lambda s: config.section_positions[s.section_id][0])]

        template = _jinja_env.get_template("summary.html.j2")
        return template.render(table_id=self.table_id, icons_rel=ICONS_REL, cards_rel=CARDS_REL, columns=columns)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m bga_tracker.innovation.format_state TABLE_ID")
        sys.exit(1)

    config = Config.from_env()

    table_id = sys.argv[1]
    table_dir, _ = find_table(table_id)

    game_state_path = table_dir / "game_state.json"
    card_db = CardDatabase(CARD_INFO_PATH)
    with open(game_state_path, encoding="utf-8") as f:
        game_state = GameState.from_json(json.load(f))

    # Extract real opponent name from game state (directory name may be sanitized)
    opponents = [p for p in game_state.hands if p != config.player_name]
    if len(opponents) != 1:
        raise ValueError(f"Expected exactly one opponent, found {len(opponents)} other players: {opponents}")
    opponent = opponents[0]
    players = [config.player_name, opponent]
    print(f"Players: {', '.join(players)}")

    html = SummaryFormatter(game_state, table_id, config, card_db, players, config.player_name).render()

    summary_path = table_dir / "summary.html"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Written: {summary_path}")


if __name__ == "__main__":
    main()
