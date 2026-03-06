"""End-to-end Innovation pipeline: fetch → process → track → format → open.

Usage:
  python -m bga_tracker.innovation.pipeline run URL [--no-open] [--skip-fetch]
  python -m bga_tracker.innovation.pipeline serve [--port 8787]

  run   URL          Fetch, process, track, format, and open an Innovation game
  serve              Start HTTP server for Chrome extension

  --no-open    Skip opening summary.html in the default browser
  --skip-fetch Skip browser fetch step; reuse existing raw_log.json
  --port PORT  Port for the HTTP server (default: 8787)
"""

import argparse
import json
import webbrowser

from bga_tracker.innovation.card import CardDatabase
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.fetch import _determine_opponent, fetch_game_data
from bga_tracker.innovation.format_state import SummaryFormatter
from bga_tracker.innovation.game_log_processor import GameLogProcessor
from bga_tracker.innovation.game_state import GameStateEncoder
from bga_tracker.innovation.paths import CARD_INFO_PATH, create_table_dir, find_table, parse_bga_url
from bga_tracker.innovation.process_log import process_raw_log



def run_pipeline(url: str, *, no_open: bool = False, skip_fetch: bool = False, raw_data: dict | None = None) -> dict:
    """Execute the full pipeline: fetch, process, track, format, open.

    When raw_data is provided (from the Chrome extension / server), it is used
    directly instead of fetching via Playwright.  The data is saved to disk
    and processed through the same pipeline.

    Returns a dict with 'table_dir' and 'summary_path' keys (as strings).
    """
    config = Config.from_env()

    # 1. Parse table_id from URL
    table_id = parse_bga_url(url)
    print(f"Table ID: {table_id}")

    if raw_data is not None:
        # In-memory raw data from Chrome extension
        opponent = _determine_opponent(raw_data["players"], config.player_name)
        table_dir = create_table_dir(table_id, opponent)

        # Save raw_log.json
        raw_log_path = table_dir / "raw_log.json"
        raw_log_path.write_text(json.dumps(raw_data, indent=2), encoding="utf-8")
        print(f"Saved raw_log.json to {table_dir}")
    elif skip_fetch:
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
            opponent = _determine_opponent(log_data["players"], config.player_name)
        else:
            print("Skipping fetch — using existing raw_log.json")
            try:
                raw_data = json.loads(raw_log_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Malformed JSON in {raw_log_path}: {exc}") from exc
            # Extract real opponent name from raw data (directory name may be sanitized)
            opponent = _determine_opponent(raw_data["players"], config.player_name)
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

    return {"table_dir": str(table_dir), "summary_path": str(summary_path)}


def build_parser() -> argparse.ArgumentParser:
    """Build and return the CLI argument parser."""
    parser = argparse.ArgumentParser(description="Innovation pipeline: fetch → process → track → format → open.")
    subparsers = parser.add_subparsers(dest="command")

    # run subcommand
    run_parser = subparsers.add_parser("run", help="Run the full pipeline for a BGA game URL")
    run_parser.add_argument("url", help="Full BGA game URL, e.g. https://boardgamearena.com/10/innovation?table=815951228")
    run_parser.add_argument("--no-open", action="store_true", help="Skip opening summary.html in the default browser")
    run_parser.add_argument("--skip-fetch", action="store_true", help="Skip browser fetch step; reuse existing raw_log.json")

    # serve subcommand
    serve_parser = subparsers.add_parser("serve", help="Start HTTP server for Chrome extension")
    serve_parser.add_argument("--port", type=int, default=8787, help="Port to listen on (default: 8787)")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "serve":
        import uvicorn

        from bga_tracker.innovation.server import app

        print(f"Starting Innovation tracker server on port {args.port}...")
        uvicorn.run(app, host="127.0.0.1", port=args.port)
    elif args.command == "run":
        run_pipeline(args.url, no_open=args.no_open, skip_fetch=args.skip_fetch)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
