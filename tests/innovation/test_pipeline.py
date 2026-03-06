"""Tests for bga_tracker.innovation.pipeline (--skip-fetch mode).

Exercises the process_log → track → format chain end-to-end using fixture
data, without a browser.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from bga_tracker.innovation.pipeline import run_pipeline

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _fixture_tables():
    """Yield (table_id, opponent, fixture_dir) for each available fixture."""
    for d in sorted(FIXTURES_DIR.glob("* *")):
        parts = d.name.split(" ", 1)
        if len(parts) == 2 and (d / "game_log.json").exists():
            yield parts[0], parts[1], d


TABLE_PARAMS = list(_fixture_tables())


@pytest.mark.parametrize("table_id,opponent,fixture_dir", TABLE_PARAMS, ids=[p[0] for p in TABLE_PARAMS])
def test_skip_fetch_produces_expected_output(table_id: str, opponent: str, fixture_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--skip-fetch pipeline produces game_state.json and summary.html matching fixtures."""
    import bga_tracker.innovation.paths as paths_mod

    # Set up a temp data directory with game_log.json copied from fixtures
    table_dir = tmp_path / f"{table_id} {opponent}"
    table_dir.mkdir()
    game_log_src = fixture_dir / "game_log.json"
    (table_dir / "game_log.json").write_text(game_log_src.read_text(encoding="utf-8"), encoding="utf-8")

    # Point DATA_DIR to tmp_path so find_table() locates our copy
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    url = f"https://boardgamearena.com/10/innovation?table={table_id}"
    run_pipeline(url, no_open=True, skip_fetch=True)

    # Verify game_state.json matches fixture
    expected_state = (fixture_dir / "game_state.json").read_text(encoding="utf-8").rstrip("\n")
    actual_state = (table_dir / "game_state.json").read_text(encoding="utf-8").rstrip("\n")
    assert actual_state == expected_state

    # Verify summary.html matches fixture
    expected_html = (fixture_dir / "summary.html").read_text(encoding="utf-8").rstrip("\n")
    actual_html = (table_dir / "summary.html").read_text(encoding="utf-8").rstrip("\n")
    assert actual_html == expected_html


def test_skip_fetch_no_data_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--skip-fetch with no existing table directory raises FileNotFoundError."""
    import bga_tracker.innovation.paths as paths_mod
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    url = "https://boardgamearena.com/10/innovation?table=999999999"
    with pytest.raises(FileNotFoundError):
        run_pipeline(url, no_open=True, skip_fetch=True)


def test_pipeline_cli_no_open(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify --no-open prevents webbrowser.open from being called."""
    import bga_tracker.innovation.paths as paths_mod

    # Use first fixture
    if not TABLE_PARAMS:
        pytest.skip("No fixtures available")
    table_id, opponent, fixture_dir = TABLE_PARAMS[0]

    table_dir = tmp_path / f"{table_id} {opponent}"
    table_dir.mkdir()
    (table_dir / "game_log.json").write_text((fixture_dir / "game_log.json").read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    with patch("bga_tracker.innovation.pipeline.webbrowser.open") as mock_open:
        url = f"https://boardgamearena.com/10/innovation?table={table_id}"
        run_pipeline(url, no_open=True, skip_fetch=True)
        mock_open.assert_not_called()


def test_pipeline_opens_browser_when_no_open_false(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify no_open=False calls webbrowser.open with the summary path."""
    import bga_tracker.innovation.paths as paths_mod

    if not TABLE_PARAMS:
        pytest.skip("No fixtures available")
    table_id, opponent, fixture_dir = TABLE_PARAMS[0]

    table_dir = tmp_path / f"{table_id} {opponent}"
    table_dir.mkdir()
    (table_dir / "game_log.json").write_text((fixture_dir / "game_log.json").read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    with patch("bga_tracker.innovation.pipeline.webbrowser.open") as mock_open:
        url = f"https://boardgamearena.com/10/innovation?table={table_id}"
        run_pipeline(url, no_open=False, skip_fetch=True)
        mock_open.assert_called_once()
        called_uri = mock_open.call_args[0][0]
        assert "summary.html" in called_uri


def test_skip_fetch_with_sanitized_opponent_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--skip-fetch uses real opponent name from log data, not sanitized directory name."""
    import bga_tracker.innovation.paths as paths_mod

    if not TABLE_PARAMS:
        pytest.skip("No fixtures available")
    table_id, _original_opponent, fixture_dir = TABLE_PARAMS[0]

    # Read the fixture game_log to find the real opponent name
    game_log_text = (fixture_dir / "game_log.json").read_text(encoding="utf-8")
    game_log_data = json.loads(game_log_text)
    real_opponent = [name for name in game_log_data["players"].values() if name != "AnotherSava"][0]

    # Create a directory with a "sanitized" opponent name (simulating slash replacement)
    sanitized_opponent = real_opponent.replace("a", "_")  # Mangle the name
    table_dir = tmp_path / f"{table_id} {sanitized_opponent}"
    table_dir.mkdir()
    (table_dir / "game_log.json").write_text(game_log_text, encoding="utf-8")

    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    url = f"https://boardgamearena.com/10/innovation?table={table_id}"
    # This should succeed because the pipeline reads the real opponent name from
    # the game_log.json players dict, not from the sanitized directory name
    run_pipeline(url, no_open=True, skip_fetch=True)

    assert (table_dir / "game_state.json").exists()
    assert (table_dir / "summary.html").exists()


def test_skip_fetch_empty_table_dir_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """--skip-fetch with existing table dir but no data files raises FileNotFoundError."""
    import bga_tracker.innovation.paths as paths_mod
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    table_dir = tmp_path / "999999999 SomeOpponent"
    table_dir.mkdir()

    url = "https://boardgamearena.com/10/innovation?table=999999999"
    with pytest.raises(FileNotFoundError, match="No raw_log.json or game_log.json"):
        run_pipeline(url, no_open=True, skip_fetch=True)


def test_pipeline_fetch_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pipeline with skip_fetch=False calls fetch_game_data and processes the result."""
    import bga_tracker.innovation.paths as paths_mod

    if not TABLE_PARAMS:
        pytest.skip("No fixtures available")
    table_id, opponent, fixture_dir = TABLE_PARAMS[0]

    # Prepare a temp table dir with game_log.json (for process_raw_log output comparison)
    table_dir = tmp_path / f"{table_id} {opponent}"
    table_dir.mkdir()

    # Read fixture game_log to use as the mock raw data that process_raw_log will receive
    game_log_data = json.loads((fixture_dir / "game_log.json").read_text(encoding="utf-8"))

    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    # Mock fetch_game_data to return the game_log as raw_data (process_raw_log will pass it through)
    # and mock process_raw_log to return the game_log directly (since it's already processed)
    with patch("bga_tracker.innovation.pipeline.fetch_game_data") as mock_fetch, \
         patch("bga_tracker.innovation.pipeline.process_raw_log") as mock_process, \
         patch("bga_tracker.innovation.pipeline.webbrowser.open"):
        mock_fetch.return_value = ({"raw": "data"}, table_dir, opponent)
        mock_process.return_value = game_log_data

        url = f"https://boardgamearena.com/10/innovation?table={table_id}"
        run_pipeline(url, no_open=True, skip_fetch=False)

        mock_fetch.assert_called_once_with(url)
        mock_process.assert_called_once_with({"raw": "data"})

    # Verify outputs were created
    assert (table_dir / "game_log.json").exists()
    assert (table_dir / "game_state.json").exists()
    assert (table_dir / "summary.html").exists()
