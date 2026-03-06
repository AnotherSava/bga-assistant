"""Tests for bga_tracker.innovation.server (POST /extract endpoint)."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from bga_tracker.innovation.server import app

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _fixture_tables():
    """Yield (table_id, opponent, fixture_dir) for each available fixture."""
    for d in sorted(FIXTURES_DIR.glob("* *")):
        parts = d.name.split(" ", 1)
        if len(parts) == 2 and (d / "game_log.json").exists():
            yield parts[0], parts[1], d


TABLE_PARAMS = list(_fixture_tables())


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def first_fixture():
    """Return (table_id, opponent, fixture_dir) for the first available fixture."""
    if not TABLE_PARAMS:
        pytest.skip("No fixtures available")
    return TABLE_PARAMS[0]


def _make_extract_payload(table_id: str, players: dict[str, str]) -> dict:
    """Build a minimal /extract request payload."""
    return {
        "url": f"https://boardgamearena.com/10/innovation?table={table_id}",
        "raw_data": {
            "players": players,
            "gamedatas": {},
            "packets": [],
        },
    }


def test_extract_success(client: TestClient, first_fixture: tuple, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /extract processes raw data and returns summary path."""
    import bga_tracker.innovation.paths as paths_mod

    table_id, opponent, fixture_dir = first_fixture
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    game_log_data = json.loads((fixture_dir / "game_log.json").read_text(encoding="utf-8"))
    players = game_log_data["players"]

    payload = _make_extract_payload(table_id, players)

    with patch("bga_tracker.innovation.pipeline.process_raw_log", return_value=game_log_data):
        response = client.post("/extract", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "summary.html" in body["summary_path"]

    # Verify files were created in the table directory
    table_dir = Path(body["table_dir"])
    assert (table_dir / "raw_log.json").exists()
    assert (table_dir / "game_log.json").exists()
    assert (table_dir / "game_state.json").exists()
    assert (table_dir / "summary.html").exists()


def test_extract_invalid_url(client: TestClient) -> None:
    """POST /extract with missing table= parameter returns 400."""
    payload = {
        "url": "https://boardgamearena.com/10/innovation",
        "raw_data": {"players": {}, "gamedatas": {}, "packets": []},
    }
    response = client.post("/extract", json=payload)
    assert response.status_code == 400
    assert "table=" in response.json()["detail"].lower()


def test_extract_missing_body_fields(client: TestClient) -> None:
    """POST /extract with missing required fields returns 422."""
    response = client.post("/extract", json={"url": "https://example.com"})
    assert response.status_code == 422


def test_extract_player_not_in_game(client: TestClient, first_fixture: tuple, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /extract when PLAYER_NAME is not in the game's players returns 400."""
    import bga_tracker.innovation.paths as paths_mod

    table_id, _, _ = first_fixture
    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    # Use players that don't include the configured PLAYER_NAME
    payload = _make_extract_payload(table_id, {"1": "Alice", "2": "Bob"})

    response = client.post("/extract", json=payload)
    assert response.status_code == 400
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.parametrize("table_id,opponent,fixture_dir", TABLE_PARAMS, ids=[p[0] for p in TABLE_PARAMS])
def test_extract_produces_expected_output(table_id: str, opponent: str, fixture_dir: Path, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /extract produces game_state.json matching fixture for each test game."""
    import bga_tracker.innovation.paths as paths_mod

    monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)

    game_log_data = json.loads((fixture_dir / "game_log.json").read_text(encoding="utf-8"))
    players = game_log_data["players"]

    payload = _make_extract_payload(table_id, players)

    with patch("bga_tracker.innovation.pipeline.process_raw_log", return_value=game_log_data):
        response = client.post("/extract", json=payload)

    assert response.status_code == 200
    table_dir = Path(response.json()["table_dir"])

    expected_state = (fixture_dir / "game_state.json").read_text(encoding="utf-8").rstrip("\n")
    actual_state = (table_dir / "game_state.json").read_text(encoding="utf-8").rstrip("\n")
    assert actual_state == expected_state


def test_cors_allows_chrome_extension_origin(client: TestClient) -> None:
    """CORS headers allow chrome-extension:// origins."""
    response = client.options(
        "/extract",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnop",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "chrome-extension://abcdefghijklmnop"


def test_cors_rejects_disallowed_origin(client: TestClient) -> None:
    """CORS headers do not allow arbitrary external origins."""
    response = client.options(
        "/extract",
        headers={
            "Origin": "https://evil.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") != "https://evil.com"
