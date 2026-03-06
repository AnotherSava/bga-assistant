"""Tests for bga_tracker.innovation.paths utility functions."""

import pytest

from bga_tracker.innovation.paths import create_table_dir, find_table, parse_bga_url


class TestParseBgaUrl:
    def test_standard_url(self) -> None:
        url = "https://boardgamearena.com/10/innovation?table=815951228"
        assert parse_bga_url(url) == "815951228"

    def test_url_with_multiple_params(self) -> None:
        url = "https://boardgamearena.com/10/innovation?table=123456&other=abc"
        assert parse_bga_url(url) == "123456"

    def test_url_table_param_first(self) -> None:
        url = "https://boardgamearena.com/innovation?table=999&mode=replay"
        assert parse_bga_url(url) == "999"

    def test_missing_table_param_raises(self) -> None:
        url = "https://boardgamearena.com/10/innovation"
        with pytest.raises(ValueError, match="missing 'table=' parameter"):
            parse_bga_url(url)

    def test_empty_query_string_raises(self) -> None:
        url = "https://boardgamearena.com/10/innovation?"
        with pytest.raises(ValueError, match="missing 'table=' parameter"):
            parse_bga_url(url)

    def test_wrong_param_name_raises(self) -> None:
        url = "https://boardgamearena.com/10/innovation?tbl=815951228"
        with pytest.raises(ValueError, match="missing 'table=' parameter"):
            parse_bga_url(url)

    def test_non_numeric_table_id_raises(self) -> None:
        url = "https://boardgamearena.com/10/innovation?table=../../../etc"
        with pytest.raises(ValueError, match="must be numeric"):
            parse_bga_url(url)

    def test_table_id_with_spaces_raises(self) -> None:
        url = "https://boardgamearena.com/10/innovation?table=815%20../../etc"
        with pytest.raises(ValueError, match="must be numeric"):
            parse_bga_url(url)


class TestCreateTableDir:
    def test_creates_directory(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        result = create_table_dir("815951228", "opponent_name")
        assert result == tmp_path / "815951228 opponent_name"
        assert result.is_dir()

    def test_idempotent(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        first = create_table_dir("815951228", "Alice")
        second = create_table_dir("815951228", "Alice")
        assert first == second
        assert first.is_dir()

    def test_different_opponents_create_different_dirs(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        dir_a = create_table_dir("123", "Alice")
        dir_b = create_table_dir("123", "Bob")
        assert dir_a != dir_b
        assert dir_a.is_dir()
        assert dir_b.is_dir()


class TestFindTable:
    def test_single_match(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        (tmp_path / "815951228 Alice").mkdir()
        table_dir, opponent = find_table("815951228")
        assert table_dir == tmp_path / "815951228 Alice"
        assert opponent == "Alice"

    def test_zero_matches_raises(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        with pytest.raises(FileNotFoundError, match="No table directory"):
            find_table("999999")

    def test_multiple_matches_raises(self, tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
        import bga_tracker.innovation.paths as paths_mod
        monkeypatch.setattr(paths_mod, "DATA_DIR", tmp_path)
        (tmp_path / "123 Alice").mkdir()
        (tmp_path / "123 Bob").mkdir()
        with pytest.raises(FileNotFoundError, match="Multiple table directories"):
            find_table("123")
