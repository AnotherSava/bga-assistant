"""
Innovation Card State Tracker

Reads game_log.json (extracted from BGA), processes all card movements,
and outputs the current location of every card.

Usage: python -m bga_tracker.innovation.track_state TABLE_ID

Input:  assets/card_info.json, data/<TABLE_ID>/game_log.json
Output: data/<TABLE_ID>/game_state.json
"""

import json
import sys

from bga_tracker.innovation.paths import CARD_INFO_PATH, find_table
from bga_tracker.innovation.card import CardDatabase
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.game_log_processor import GameLogProcessor
from bga_tracker.innovation.game_state import GameStateEncoder


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m bga_tracker.innovation.track_state TABLE_ID")
        sys.exit(1)

    config = Config.from_env()

    table_id = sys.argv[1]
    table_dir, _ = find_table(table_id)

    game_log_path = table_dir / "game_log.json"
    out_path = table_dir / "game_state.json"

    # Extract real opponent name from log data (directory name may be sanitized)
    with open(game_log_path, encoding="utf-8") as f:
        log_players = json.load(f)["players"]
    opponents = [name for name in log_players.values() if name != config.player_name]
    if len(opponents) != 1:
        raise ValueError(f"Expected exactly one opponent, found {len(opponents)} other players: {opponents}")
    opponent = opponents[0]
    players = [config.player_name, opponent]
    print(f"Players: {', '.join(players)}")

    card_db = CardDatabase(CARD_INFO_PATH)
    print(f"Loaded {len(card_db)} cards from database (sets 0+3)")

    tracker = GameLogProcessor(card_db, players, config.player_name)
    game_state = tracker.process_log(game_log_path).to_json()

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(game_state, f, indent=2, cls=GameStateEncoder)
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
