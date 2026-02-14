"""Storage initialization, path helpers, and slug utilities."""

import re
import unicodedata
from pathlib import Path

_data_dir: Path | None = None
_presets_dir: Path | None = None


def slugify(title: str) -> str:
    """Convert a title to a filesystem-safe slug.

    "The Cursed Tavern" → "the-cursed-tavern"
    """
    text = unicodedata.normalize("NFKD", title)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"['\"]", "", text)  # strip apostrophes/quotes before hyphenation
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or "untitled"


def init_storage(data_dir: Path, presets_dir: Path | None = None) -> None:
    global _data_dir, _presets_dir
    from . import adventures as _adv_mod

    _data_dir = data_dir
    _data_dir.mkdir(parents=True, exist_ok=True)
    templates_dir().mkdir(exist_ok=True)
    adventures_dir().mkdir(exist_ok=True)
    if presets_dir is None:
        # Default: repo_root/presets
        presets_dir = Path(__file__).parent.parent.parent / "presets"
    _presets_dir = presets_dir
    _adv_mod._name_parts = None  # reset cached name parts


def data_dir() -> Path:
    assert _data_dir is not None, "Call init_storage() before using storage"
    return _data_dir


def presets_dir() -> Path:
    assert _presets_dir is not None, "Call init_storage() before using storage"
    return _presets_dir


def templates_dir() -> Path:
    return data_dir() / "templates"


def adventures_dir() -> Path:
    return data_dir() / "adventures"


def preset_templates_dir() -> Path:
    return presets_dir() / "templates"
