"""Tests for bga_tracker.innovation.fetch with mocked Playwright."""

import json
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

# Install mock playwright modules before importing fetch
_mock_pw_sync = ModuleType("playwright.sync_api")
_mock_sync_playwright = MagicMock()
_mock_pw_sync.sync_playwright = _mock_sync_playwright
sys.modules.setdefault("playwright", ModuleType("playwright"))
sys.modules.setdefault("playwright.sync_api", _mock_pw_sync)

from bga_tracker.innovation.fetch import (  # noqa: E402
    LoginRequiredError,
    _determine_opponent,
    fetch_game_data,
)

SAMPLE_URL = "https://boardgamearena.com/10/innovation?table=815951228"

SAMPLE_RAW_DATA = {
    "players": {"111": "TestPlayer", "222": "Opponent"},
    "gamedatas": {"my_hand": []},
    "packets": [],
}


@pytest.fixture
def mock_playwright(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Set up mocked Playwright and Config for fetch tests."""
    import bga_tracker.innovation.paths as paths_mod
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    mock_page = MagicMock()
    mock_page.url = SAMPLE_URL

    mock_context = MagicMock()
    mock_context.pages = [mock_page]

    mock_pw = MagicMock()
    mock_pw.chromium.launch_persistent_context.return_value = mock_context

    mock_sync = MagicMock()
    mock_sync.__enter__ = MagicMock(return_value=mock_pw)
    mock_sync.__exit__ = MagicMock(return_value=False)

    mock_page.evaluate.return_value = json.dumps(SAMPLE_RAW_DATA)

    monkeypatch.setattr(_mock_pw_sync, "sync_playwright", lambda: mock_sync)

    return mock_sync, mock_page, mock_context, tmp_path


class TestFetchGameData:
    @patch("bga_tracker.innovation.fetch.Config")
    def test_successful_fetch(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")

        raw_data, table_dir, opponent = fetch_game_data(SAMPLE_URL)

        assert raw_data == SAMPLE_RAW_DATA
        assert opponent == "Opponent"
        assert table_dir == tmp_path / "815951228 Opponent"
        assert table_dir.is_dir()
        raw_log_path = table_dir / "raw_log.json"
        assert raw_log_path.exists()
        saved_data = json.loads(raw_log_path.read_text())
        assert saved_data == SAMPLE_RAW_DATA

    @patch("bga_tracker.innovation.fetch.Config")
    def test_url_passed_to_page_goto(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")

        fetch_game_data(SAMPLE_URL)

        mock_page.goto.assert_called_once_with(SAMPLE_URL, wait_until="domcontentloaded")

    @patch("bga_tracker.innovation.fetch.Config")
    def test_login_redirect_raises(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")
        mock_page.url = "https://boardgamearena.com/account"

        with pytest.raises(LoginRequiredError, match="Login required"):
            fetch_game_data(SAMPLE_URL)

    @patch("bga_tracker.innovation.fetch.Config")
    def test_url_without_table_after_nav_raises(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")
        mock_page.url = "https://boardgamearena.com/lobby"

        with pytest.raises(LoginRequiredError, match="Login required"):
            fetch_game_data(SAMPLE_URL)

    @patch("bga_tracker.innovation.fetch.Config")
    def test_gameui_timeout_raises_login_error(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")

        class TimeoutError(Exception):
            pass

        mock_page.wait_for_function.side_effect = TimeoutError("Timeout 30000ms exceeded")

        with pytest.raises(LoginRequiredError, match="Timed out waiting for game UI"):
            fetch_game_data(SAMPLE_URL)

    @patch("bga_tracker.innovation.fetch.Config")
    def test_fetch_script_error_raises(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")
        mock_page.evaluate.return_value = json.dumps({"error": True, "msg": "something broke"})

        with pytest.raises(RuntimeError, match="Fetch script error: something broke"):
            fetch_game_data(SAMPLE_URL)

    @patch("bga_tracker.innovation.fetch.Config")
    def test_context_closed_in_finally(self, mock_config_cls: MagicMock, mock_playwright: tuple) -> None:
        mock_sync, mock_page, mock_context, tmp_path = mock_playwright
        mock_config_cls.from_env.return_value = MagicMock(player_name="TestPlayer")
        mock_page.url = "https://boardgamearena.com/account"

        with pytest.raises(LoginRequiredError):
            fetch_game_data(SAMPLE_URL)

        mock_context.close.assert_called_once()

    def test_missing_table_param_raises(self) -> None:
        with pytest.raises(ValueError, match="missing 'table=' parameter"):
            fetch_game_data("https://boardgamearena.com/10/innovation")


class TestDetermineOpponent:
    def test_finds_opponent(self) -> None:
        players = {"111": "Me", "222": "Them"}
        assert _determine_opponent(players, "Me") == "Them"

    def test_player_name_not_in_players_raises(self) -> None:
        players = {"111": "Alice", "222": "Bob"}
        with pytest.raises(ValueError, match="PLAYER_NAME 'Typo' not found in game players"):
            _determine_opponent(players, "Typo")

    def test_no_opponent_raises(self) -> None:
        players = {"111": "Me"}
        with pytest.raises(ValueError, match="Could not determine opponent"):
            _determine_opponent(players, "Me")

    def test_multiple_opponents_raises(self) -> None:
        players = {"111": "Me", "222": "Alice", "333": "Bob"}
        with pytest.raises(ValueError, match="Only 2-player games are supported"):
            _determine_opponent(players, "Me")
