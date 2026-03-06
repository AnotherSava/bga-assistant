"""Tests for CLI argument parsing in bga_tracker.innovation.pipeline."""

import pytest

from bga_tracker.innovation.pipeline import build_parser


class TestBuildParser:
    """Tests for the build_parser() function and CLI argument parsing."""

    def test_run_subcommand_with_url(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["run", "https://boardgamearena.com/10/innovation?table=123"])
        assert args.command == "run"
        assert args.url == "https://boardgamearena.com/10/innovation?table=123"
        assert args.no_open is False
        assert args.skip_fetch is False

    def test_run_subcommand_with_no_open(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["run", "https://example.com/table=1", "--no-open"])
        assert args.command == "run"
        assert args.no_open is True

    def test_run_subcommand_with_skip_fetch(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["run", "https://example.com/table=1", "--skip-fetch"])
        assert args.command == "run"
        assert args.skip_fetch is True

    def test_run_subcommand_with_all_flags(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["run", "https://example.com/table=1", "--no-open", "--skip-fetch"])
        assert args.command == "run"
        assert args.no_open is True
        assert args.skip_fetch is True

    def test_run_subcommand_requires_url(self) -> None:
        parser = build_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["run"])

    def test_serve_subcommand_default_port(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["serve"])
        assert args.command == "serve"
        assert args.port == 8787

    def test_serve_subcommand_custom_port(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["serve", "--port", "9000"])
        assert args.command == "serve"
        assert args.port == 9000

    def test_no_subcommand_sets_command_none(self) -> None:
        parser = build_parser()
        args = parser.parse_args([])
        assert args.command is None
