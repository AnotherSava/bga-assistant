"""
Innovation Card State Tracker

Reads game_log.json (extracted from BGA), processes all card movements,
and outputs the current location of every card.

Usage: python -m bga_tracker.innovation.track_state TABLE_ID

Input:  assets/cardinfo.json, data/<TABLE_ID>/game_log.json
Output: data/<TABLE_ID>/game_state.json
"""

import json
import sys

from bga_tracker import PROJECT_ROOT
from bga_tracker.innovation.card import CardDB
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.state_tracker import StateTracker

DATA_DIR = PROJECT_ROOT / "data"
CARDINFO_PATH = PROJECT_ROOT / "assets" / "cardinfo.json"


def find_table(table_id: str):
    """Find table data directory and opponent name from 'TABLE_ID opponent' folder."""
    matches = list(DATA_DIR.glob(f"{table_id} *"))
    if len(matches) != 1:
        raise FileNotFoundError(f"No unique table directory for '{table_id}' in {DATA_DIR}")
    table_dir = matches[0]
    opponent = table_dir.name.split(" ", 1)[1]
    return table_dir, opponent


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m bga_tracker.innovation.track_state TABLE_ID")
        sys.exit(1)

    config = Config.from_env()

    table_id = sys.argv[1]
    table_dir, opponent = find_table(table_id)
    players = [config.player_name, opponent]
    print(f"Players: {', '.join(players)}")

    game_log_path = table_dir / "game_log.json"
    out_path = table_dir / "game_state.json"

    card_db = CardDB(CARDINFO_PATH)
    print(f"Loaded {len(card_db)} cards from database (sets 0+3)")

    tracker = StateTracker(card_db, players, config.player_name)
    game_state = tracker.process_log(game_log_path).to_json()

    with open(out_path, "w") as f:
        json.dump(game_state, f, indent=2)
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
