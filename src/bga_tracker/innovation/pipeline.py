"""End-to-end Innovation pipeline: fetch → process → track → format → open.

Usage: python -m bga_tracker.innovation.pipeline URL [--no-open] [--skip-fetch]

  URL          Full BGA game URL, e.g. https://boardgamearena.com/10/innovation?table=815951228
  --no-open    Skip opening summary.html in the default browser
  --skip-fetch Skip browser fetch step; reuse existing raw_log.json
"""

import argparse
import json
import webbrowser

from bga_tracker.innovation.card import CardDatabase
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.fetch import fetch_game_data
from bga_tracker.innovation.format_state import SummaryFormatter
from bga_tracker.innovation.game_log_processor import GameLogProcessor
from bga_tracker.innovation.game_state import GameStateEncoder
from bga_tracker.innovation.paths import CARD_INFO_PATH, find_table, parse_bga_url
from bga_tracker.innovation.process_log import process_raw_log


def _extract_opponent(players_dict: dict[str, str], player_name: str) -> str:
    """Find the opponent's name from a log file's players dict (ID → name)."""
    if player_name not in players_dict.values():
        raise ValueError(f"PLAYER_NAME '{player_name}' not found in game players: {list(players_dict.values())}. Check your .env configuration.")
    opponents = [name for name in players_dict.values() if name != player_name]
    if len(opponents) != 1:
        raise ValueError(f"Expected exactly one opponent, found {len(opponents)} other players: {opponents}")
    return opponents[0]


def run_pipeline(url: str, *, no_open: bool = False, skip_fetch: bool = False) -> None:
    """Execute the full pipeline: fetch, process, track, format, open."""
    config = Config.from_env()

    # 1. Parse table_id from URL
    table_id = parse_bga_url(url)
    print(f"Table ID: {table_id}")

    if skip_fetch:
        # Locate existing table directory
        table_dir, _ = find_table(table_id)
        raw_log_path = table_dir / "raw_log.json"
        if not raw_log_path.exists():
            # Fall back to game_log.json if raw_log.json doesn't exist
            game_log_path = table_dir / "game_log.json"
            if not game_log_path.exists():
                raise FileNotFoundError(f"No raw_log.json or game_log.json found in {table_dir}")
            print("Skipping fetch — using existing game_log.json")
            raw_data = None
            # Extract real opponent name from log data (directory name may be sanitized)
            log_data = json.loads(game_log_path.read_text(encoding="utf-8"))
            opponent = _extract_opponent(log_data["players"], config.player_name)
        else:
            print("Skipping fetch — using existing raw_log.json")
            try:
                raw_data = json.loads(raw_log_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Malformed JSON in {raw_log_path}: {exc}") from exc
            # Extract real opponent name from raw data (directory name may be sanitized)
            opponent = _extract_opponent(raw_data["players"], config.player_name)
    else:
        # 2. Fetch game data via browser
        print("Fetching game data from BGA...")
        raw_data, table_dir, opponent = fetch_game_data(url)
        print(f"Saved raw_log.json to {table_dir}")

    players = [config.player_name, opponent]
    print(f"Players: {', '.join(players)}")

    # 3. Process raw log → game_log.json
    game_log_path = table_dir / "game_log.json"
    if raw_data is not None:
        print("Processing raw log...")
        game_log = process_raw_log(raw_data)
        game_log_path.write_text(json.dumps(game_log, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Saved game_log.json ({len(game_log['log'])} entries)")
    else:
        print("Using existing game_log.json")

    # 4. Track card state → GameState
    print("Tracking card state...")
    card_db = CardDatabase(CARD_INFO_PATH)
    tracker = GameLogProcessor(card_db, players, config.player_name)
    game_state = tracker.process_log(game_log_path)

    # 5. Save game_state.json
    game_state_path = table_dir / "game_state.json"
    game_state_path.write_text(json.dumps(game_state.to_json(), indent=2, cls=GameStateEncoder), encoding="utf-8")
    print("Saved game_state.json")

    # 6. Format summary HTML
    print("Generating summary.html...")
    html = SummaryFormatter(game_state, table_id, config, card_db, players, config.player_name).render()
    summary_path = table_dir / "summary.html"
    summary_path.write_text(html, encoding="utf-8")
    print("Saved summary.html")

    # 7. Open in browser
    if not no_open:
        print("Opening summary.html in browser...")
        webbrowser.open(summary_path.as_uri())
    else:
        print(f"Done. Open {summary_path} to view.")


def main() -> None:
    parser = argparse.ArgumentParser(description="End-to-end Innovation pipeline: fetch → process → track → format → open.")
    parser.add_argument("url", help="Full BGA game URL, e.g. https://boardgamearena.com/10/innovation?table=815951228")
    parser.add_argument("--no-open", action="store_true", help="Skip opening summary.html in the default browser")
    parser.add_argument("--skip-fetch", action="store_true", help="Skip browser fetch step; reuse existing raw_log.json")
    args = parser.parse_args()

    run_pipeline(args.url, no_open=args.no_open, skip_fetch=args.skip_fetch)


if __name__ == "__main__":
    main()
