"""Character and persona file storage."""

import json
from pathlib import Path
from typing import Any

from .core import adventures_dir, data_dir


def _characters_path(slug: str) -> Path:
    return adventures_dir() / slug / "characters.json"


def get_characters(slug: str) -> list[dict[str, Any]]:
    """Load characters for an adventure. Returns [] if missing."""
    path = _characters_path(slug)
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def save_characters(slug: str, characters: list[dict[str, Any]]) -> None:
    """Write characters list for an adventure."""
    path = _characters_path(slug)
    path.write_text(json.dumps(characters, indent=2))


def get_character(slug: str, char_slug: str) -> dict[str, Any] | None:
    """Find a single character by slug. Returns None if not found."""
    for char in get_characters(slug):
        if char["slug"] == char_slug:
            return char
    return None


def _personas_global_path() -> Path:
    return data_dir() / "personas.json"


def _personas_adventure_path(slug: str) -> Path:
    return adventures_dir() / slug / "personas.json"


def get_global_personas() -> list[dict[str, Any]]:
    """Read global personas. Returns [] if missing."""
    path = _personas_global_path()
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def save_global_personas(personas: list[dict[str, Any]]) -> None:
    """Write global personas."""
    _personas_global_path().write_text(json.dumps(personas, indent=2))


def get_adventure_personas(slug: str) -> list[dict[str, Any]]:
    """Read adventure-local personas. Returns [] if missing."""
    path = _personas_adventure_path(slug)
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def save_adventure_personas(slug: str, personas: list[dict[str, Any]]) -> None:
    """Write adventure-local personas."""
    path = _personas_adventure_path(slug)
    path.write_text(json.dumps(personas, indent=2))


def get_merged_personas(slug: str) -> list[dict[str, Any]]:
    """Merge global + adventure-local personas. Adventure-local wins by slug.

    Returns list with in-memory `source` field ("global" or "adventure").
    """
    by_slug: dict[str, dict[str, Any]] = {}
    for p in get_global_personas():
        entry = dict(p)
        entry["source"] = "global"
        by_slug[p["slug"]] = entry
    for p in get_adventure_personas(slug):
        entry = dict(p)
        entry["source"] = "adventure"
        by_slug[p["slug"]] = entry
    return list(by_slug.values())
