"""Configuration for Innovation game state tools.

Reads settings from .env file and environment variables. Provides a Config
dataclass with validated fields and sensible defaults.
"""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

from bga_tracker import PROJECT_ROOT

_SECTION_KEYS = [
    "HAND_OPPONENT", "HAND_ME", "SCORE_OPPONENT", "SCORE_ME",
    "ACHIEVEMENTS", "BASE_DECK", "CITIES_DECK", "BASE_LIST", "CITIES_LIST",
]
_SECTION_DEFAULTS = {k: f"1.{i+1}" for i, k in enumerate(_SECTION_KEYS)}

_VALID_VISIBILITY = {"show", "hide", "none"}
_VALID_VISIBILITY_UNKNOWN = {"show", "hide", "none", "unknown"}
_VALID_LAYOUT = {"wide", "tall"}


def _parse_section_positions() -> dict[str, tuple[int, float]]:
    """Parse SECTION_* env vars into {key: (column, position)} dict."""
    positions = {}
    for key in _SECTION_KEYS:
        val = os.environ.get(f"SECTION_{key}", _SECTION_DEFAULTS[key])
        parts = val.split(".", 1)
        positions[key] = (int(parts[0]), float(val))
    return positions


@dataclass
class Config:
    """Innovation tool configuration."""

    player_name: str
    base_deck: str = "show"
    cities_deck: str = "hide"
    base_list: str = "none"
    cities_list: str = "none"
    base_layout: str = "wide"
    cities_layout: str = "wide"
    achievements: str = "show"
    ach_layout: str = "wide"
    section_positions: dict[str, tuple[int, float]] = field(default_factory=lambda: {k: (1, float(f"1.{i+1}")) for i, k in enumerate(_SECTION_KEYS)})

    def __post_init__(self) -> None:
        if not self.player_name:
            raise ValueError("player_name is required")
        self.base_deck = self._validate(self.base_deck, _VALID_VISIBILITY, "base_deck")
        self.cities_deck = self._validate(self.cities_deck, _VALID_VISIBILITY, "cities_deck")
        self.base_list = self._validate(self.base_list, _VALID_VISIBILITY_UNKNOWN, "base_list")
        self.cities_list = self._validate(self.cities_list, _VALID_VISIBILITY_UNKNOWN, "cities_list")
        self.base_layout = self._validate(self.base_layout, _VALID_LAYOUT, "base_layout")
        self.cities_layout = self._validate(self.cities_layout, _VALID_LAYOUT, "cities_layout")
        self.achievements = self._validate(self.achievements, _VALID_VISIBILITY, "achievements")
        self.ach_layout = self._validate(self.ach_layout, _VALID_LAYOUT, "ach_layout")

    @staticmethod
    def _validate(value: str, valid: set[str], field_name: str) -> str:
        normalized = value.lower()
        if normalized not in valid:
            raise ValueError(f"Invalid {field_name}={value!r}, expected one of {sorted(valid)}")
        return normalized

    @classmethod
    def from_env(cls) -> "Config":
        """Load config from .env file and environment variables."""
        load_dotenv(PROJECT_ROOT / ".env")
        player_name = os.environ.get("PLAYER_NAME", "")
        return cls(
            player_name=player_name,
            base_deck=os.environ.get("DEFAULT_BASE_DECK", "show"),
            cities_deck=os.environ.get("DEFAULT_CITIES_DECK", "hide"),
            base_list=os.environ.get("DEFAULT_BASE_LIST", "none"),
            cities_list=os.environ.get("DEFAULT_CITIES_LIST", "none"),
            base_layout=os.environ.get("DEFAULT_BASE_LAYOUT", "wide"),
            cities_layout=os.environ.get("DEFAULT_CITIES_LAYOUT", "wide"),
            achievements=os.environ.get("DEFAULT_ACHIEVEMENTS", "show"),
            ach_layout=os.environ.get("DEFAULT_ACH_LAYOUT", "wide"),
            section_positions=_parse_section_positions(),
        )
