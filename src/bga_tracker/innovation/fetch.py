"""Browser-based BGA game data fetcher using Playwright."""

import json
from pathlib import Path

from bga_tracker import PROJECT_ROOT
from bga_tracker.innovation.config import Config
from bga_tracker.innovation.paths import create_table_dir, parse_bga_url

CHROME_PROFILE = str(PROJECT_ROOT / ".chrome_bga_profile")
FETCH_SCRIPT = PROJECT_ROOT / "scripts" / "fetch_full_history.js"


class LoginRequiredError(Exception):
    """Raised when the BGA page requires login."""


def fetch_game_data(url: str) -> tuple[dict, Path, str]:
    """Launch browser, navigate to BGA game URL, fetch notification history.

    Returns (raw_data_dict, table_dir_path, opponent_name).

    Raises LoginRequiredError if the page redirects to a login page.
    Raises ValueError if the URL is missing a table= parameter.
    Raises RuntimeError if the fetch script returns an error.
    """
    from playwright.sync_api import sync_playwright

    table_id = parse_bga_url(url)
    config = Config.from_env()

    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                CHROME_PROFILE,
                channel="chrome",
                headless=False,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--hide-crash-restore-bubble",
                    "--disable-session-crashed-bubble",
                    "--no-restore-session-state",
                ],
                viewport={"width": 1920, "height": 1080},
            )
        except Exception as exc:
            if "user data directory is already in use" in str(exc).lower() or "singletonlock" in str(exc).lower():
                raise RuntimeError(f"Chrome profile '{CHROME_PROFILE}' is already in use by another process. Close other browser sessions using this profile and try again.") from exc
            raise
        try:
            pages = context.pages
            if len(pages) > 1:
                for old_page in pages[1:]:
                    try:
                        old_page.close()
                    except Exception:
                        pass  # stale tab from persistent context; safe to ignore
            page = pages[0] if pages else context.new_page()

            page.goto(url, wait_until="domcontentloaded")

            current_url = page.url
            if "/account" in current_url or "table=" not in current_url:
                raise LoginRequiredError(
                    "Login required. Run 'python -m browser.browse https://boardgamearena.com' "
                    "and log in manually through the browser first."
                )

            try:
                page.wait_for_function("() => typeof gameui !== 'undefined' && gameui.gamedatas", timeout=30000)
            except Exception as exc:
                if "Timeout" in type(exc).__name__ or "timeout" in str(exc).lower():
                    raise LoginRequiredError(
                        "Timed out waiting for game UI to load. This usually means you need to log in. "
                        "Run 'python -m browser.browse https://boardgamearena.com' and log in manually through the browser first."
                    ) from exc
                raise

            js_code = FETCH_SCRIPT.read_text(encoding="utf-8")
            raw_json = page.evaluate(js_code)
            raw_data = json.loads(raw_json)

            if "error" in raw_data:
                raise RuntimeError(f"Fetch script error: {raw_data.get('msg', raw_data.get('error'))}")

            players = raw_data.get("players", {})
            opponent = _determine_opponent(players, config.player_name)

            table_dir = create_table_dir(table_id, opponent)
            raw_log_path = table_dir / "raw_log.json"
            raw_log_path.write_text(json.dumps(raw_data, indent=2), encoding="utf-8")

            return raw_data, table_dir, opponent
        finally:
            context.close()


def _determine_opponent(players: dict[str, str], player_name: str) -> str:
    """Find the opponent's name from the players dict."""
    if player_name not in players.values():
        raise ValueError(f"PLAYER_NAME '{player_name}' not found in game players: {list(players.values())}. Check your .env configuration.")
    opponents = [name for name in players.values() if name != player_name]
    if not opponents:
        raise ValueError(f"Could not determine opponent: no player other than '{player_name}' found in {players}")
    if len(opponents) > 1:
        raise ValueError(f"Only 2-player games are supported, but found {len(opponents) + 1} players: {list(players.values())}")
    return opponents[0]
