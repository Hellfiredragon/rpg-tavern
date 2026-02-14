"""Lorebook entry storage per adventure."""

import json
from pathlib import Path
from typing import Any

from .core import adventures_dir


def _lorebook_path(slug: str) -> Path:
    return adventures_dir() / slug / "lorebook.json"


def get_lorebook(slug: str) -> list[dict[str, Any]]:
    """Load lorebook entries for an adventure. Returns [] if missing."""
    path = _lorebook_path(slug)
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def save_lorebook(slug: str, entries: list[dict[str, Any]]) -> None:
    """Write lorebook entries for an adventure."""
    path = _lorebook_path(slug)
    path.write_text(json.dumps(entries, indent=2))
