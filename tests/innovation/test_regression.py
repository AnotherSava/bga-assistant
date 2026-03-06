"""Regression tests for Innovation game state pipeline.

Reruns track_state and format_state on committed fixture data and asserts
that the output matches the reference files (game_state.json, summary.html).
Fixtures live in tests/innovation/fixtures/ and are always present.
"""

import json
from pathlib import Path

import pytest

from bga_tracker.innovation.card import CardDatabase, CardSet
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.game_log_processor import GameLogProcessor
from bga_tracker.innovation.game_state import GameState, GameStateEncoder
from bga_tracker.innovation import format_state

# Discover table directories: "TABLE_ID opponent" folders under tests/innovation/fixtures/
DATA_DIR = Path(__file__).resolve().parent / "fixtures"
TABLE_DIRS = sorted(DATA_DIR.glob("* *"))

CARD_INFO_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "card_info.json"

# Config loaded from .env — fixtures were generated with these settings
CONFIG = Config.from_env()


def table_ids():
    """Yield (table_id, opponent, table_dir) for each available table."""
    for d in TABLE_DIRS:
        parts = d.name.split(" ", 1)
        if len(parts) == 2 and (d / "game_log.json").exists():
            yield parts[0], parts[1], d


TABLE_PARAMS = list(table_ids())


@pytest.mark.parametrize("table_id,opponent,table_dir", TABLE_PARAMS,
                         ids=[p[0] for p in TABLE_PARAMS])
def test_track_state(table_id, opponent, table_dir):
    reference = table_dir / "game_state.json"
    expected = reference.read_text(encoding="utf-8")

    card_db = CardDatabase(CARD_INFO_PATH)
    players = [CONFIG.player_name, opponent]
    game_log_path = table_dir / "game_log.json"

    tracker = GameLogProcessor(card_db, players, CONFIG.player_name)
    game_state = tracker.process_log(game_log_path).to_json()

    actual = json.dumps(game_state, indent=2, cls=GameStateEncoder)
    assert actual == expected.rstrip("\n")


@pytest.mark.parametrize("table_id,opponent,table_dir", TABLE_PARAMS,
                         ids=[p[0] for p in TABLE_PARAMS])
def test_format_state(table_id, opponent, table_dir):
    reference = table_dir / "summary.html"
    expected = reference.read_text(encoding="utf-8")

    card_db = CardDatabase(CARD_INFO_PATH)
    tracker = GameLogProcessor(card_db, [CONFIG.player_name, opponent], CONFIG.player_name)
    game_state = tracker.process_log(table_dir / "game_log.json")

    players = [CONFIG.player_name, opponent]
    actual = format_state.SummaryFormatter(game_state, table_id, CONFIG, card_db, players, CONFIG.player_name).render()
    assert actual == expected.rstrip("\n")


@pytest.mark.parametrize("table_id,opponent,table_dir", TABLE_PARAMS,
                         ids=[p[0] for p in TABLE_PARAMS])
def test_from_json_round_trip(table_id, opponent, table_dir):
    """Serialize a GameState via to_json + GameStateEncoder, deserialize via from_json,
    and verify all zones and query methods return the same results."""
    card_db = CardDatabase(CARD_INFO_PATH)
    players = [CONFIG.player_name, opponent]
    tracker = GameLogProcessor(card_db, players, CONFIG.player_name)
    original = tracker.process_log(table_dir / "game_log.json")

    # Round-trip: to_json -> JSON string -> parse -> from_json
    serialized = json.loads(json.dumps(original.to_json(), cls=GameStateEncoder))
    restored = GameState.from_json(serialized)

    # Verify zones re-serialize identically
    original_json = json.dumps(original.to_json(), indent=2, cls=GameStateEncoder)
    restored_json = json.dumps(restored.to_json(), indent=2, cls=GameStateEncoder)
    assert restored_json == original_json

    # Verify query methods: resolved_count for all age/set groups
    for card_set in (CardSet.BASE, CardSet.CITIES):
        for age in range(1, 11):
            assert restored.resolved_count(age, card_set) == original.resolved_count(age, card_set)

    # Verify opponent knowledge queries on hand cards
    for player in players:
        for orig_card, rest_card in zip(original.hands[player], restored.hands[player]):
            assert original.opponent_has_partial_information(orig_card) == restored.opponent_has_partial_information(rest_card)
            assert original.opponent_knows_nothing(orig_card) == restored.opponent_knows_nothing(rest_card)


@pytest.mark.parametrize("table_id,opponent,table_dir", TABLE_PARAMS,
                         ids=[p[0] for p in TABLE_PARAMS])
def test_format_state_from_game_state_json(table_id, opponent, table_dir):
    """Verify format_state produces the same summary.html when reading from game_state.json
    (via GameState.from_json) as the reference fixture."""
    reference = table_dir / "summary.html"
    expected = reference.read_text(encoding="utf-8")

    card_db = CardDatabase(CARD_INFO_PATH)
    game_state_path = table_dir / "game_state.json"
    with open(game_state_path, encoding="utf-8") as f:
        game_state = GameState.from_json(json.load(f))

    players = [CONFIG.player_name, opponent]
    actual = format_state.SummaryFormatter(game_state, table_id, CONFIG, card_db, players, CONFIG.player_name).render()
    assert actual == expected.rstrip("\n")
