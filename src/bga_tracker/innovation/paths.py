"""Shared path constants and directory lookup for Innovation tools."""

from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bga_tracker import PROJECT_ROOT

DATA_DIR = PROJECT_ROOT / "data"
ASSETS_DIR = PROJECT_ROOT / "assets"
CARD_INFO_PATH = ASSETS_DIR / "card_info.json"
TEMPLATE_DIR = PROJECT_ROOT / "templates" / "innovation"


def parse_bga_url(url: str) -> str:
    """Extract the table ID from a BGA game URL's table= query parameter."""
    query_params = parse_qs(urlparse(url).query)
    if "table" not in query_params:
        raise ValueError(f"URL missing 'table=' parameter: {url}")
    table_id = query_params["table"][0]
    if not table_id.isdigit():
        raise ValueError(f"Invalid table ID (must be numeric): {table_id!r}")
    return table_id


def _sanitize_name(name: str) -> str:
    """Remove path separators and traversal sequences from a name."""
    sanitized = name.replace("/", "_").replace("\\", "_").replace("\0", "_")
    # Collapse any ".." sequences that could traverse directories
    while ".." in sanitized:
        sanitized = sanitized.replace("..", "_")
    return sanitized


def create_table_dir(table_id: str, opponent: str) -> Path:
    """Create and return data/<TABLE_ID> <opponent>/ directory."""
    safe_opponent = _sanitize_name(opponent)
    table_dir = DATA_DIR / f"{table_id} {safe_opponent}"
    # Verify the resolved path is still under DATA_DIR
    resolved = table_dir.resolve()
    if not resolved.is_relative_to(DATA_DIR.resolve()):
        raise ValueError(f"Opponent name '{opponent}' would create a path outside the data directory")
    table_dir.mkdir(parents=True, exist_ok=True)
    return table_dir


def find_table(table_id: str) -> tuple[Path, str]:
    """Find table data directory and opponent name from 'TABLE_ID opponent' folder."""
    matches = [m for m in DATA_DIR.glob(f"{table_id} *") if m.is_dir()]
    if len(matches) == 0:
        raise FileNotFoundError(f"No table directory for '{table_id}' in {DATA_DIR}")
    if len(matches) > 1:
        raise FileNotFoundError(f"Multiple table directories for '{table_id}' in {DATA_DIR}: {[m.name for m in matches]}")
    table_dir = matches[0]
    opponent = table_dir.name.split(" ", 1)[1]
    return table_dir, opponent
