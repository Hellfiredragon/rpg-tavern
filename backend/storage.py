"""File-based JSON storage using a tree of slugified objects."""

import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_data_dir: Path | None = None


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


def init_storage(data_dir: Path) -> None:
    global _data_dir
    _data_dir = data_dir
    _data_dir.mkdir(parents=True, exist_ok=True)
    adventures_dir().mkdir(exist_ok=True)


def data_dir() -> Path:
    assert _data_dir is not None, "Call init_storage() before using storage"
    return _data_dir


def adventures_dir() -> Path:
    return data_dir() / "adventures"


# ── Adventures ───────────────────────────────────────────────


def list_adventures() -> list[dict[str, Any]]:
    results = []
    for path in sorted(adventures_dir().glob("*.json")):
        results.append(json.loads(path.read_text()))
    return results


def get_adventure(slug: str) -> dict[str, Any] | None:
    path = adventures_dir() / f"{slug}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text())


def create_adventure(
    title: str, description: str = "", variant: str = "template"
) -> dict[str, Any]:
    slug = slugify(title)
    json_path = adventures_dir() / f"{slug}.json"
    if json_path.exists():
        raise FileExistsError(f"Adventure '{title}' already exists (slug: {slug})")
    adventure = {
        "title": title,
        "slug": slug,
        "description": description,
        "variant": variant,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    json_path.write_text(json.dumps(adventure, indent=2))
    (adventures_dir() / slug).mkdir(exist_ok=True)
    return adventure


def update_adventure(slug: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    adventure = get_adventure(slug)
    if adventure is None:
        return None

    allowed = {"title", "description", "variant"}
    for key, value in fields.items():
        if key in allowed:
            adventure[key] = value

    new_slug = slugify(adventure["title"])
    if new_slug != slug:
        # Title changed — rename on disk
        new_json = adventures_dir() / f"{new_slug}.json"
        if new_json.exists():
            raise FileExistsError(
                f"Cannot rename: '{adventure['title']}' already exists (slug: {new_slug})"
            )
        (adventures_dir() / f"{slug}.json").rename(new_json)
        old_dir = adventures_dir() / slug
        if old_dir.is_dir():
            old_dir.rename(adventures_dir() / new_slug)
        adventure["slug"] = new_slug
    else:
        adventure["slug"] = slug

    json_path = adventures_dir() / f"{adventure['slug']}.json"
    json_path.write_text(json.dumps(adventure, indent=2))
    return adventure


def embark_adventure(slug: str) -> dict[str, Any] | None:
    """Copy a template adventure into a new running adventure."""
    template = get_adventure(slug)
    if template is None:
        return None

    base_slug = slugify(template["title"])
    target_slug = base_slug
    counter = 2
    while (adventures_dir() / f"{target_slug}.json").exists():
        target_slug = f"{base_slug}-{counter}"
        counter += 1

    running = {
        "title": template["title"],
        "slug": target_slug,
        "description": template["description"],
        "variant": "running",
        "template_path": f"adventures/{slug}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (adventures_dir() / f"{target_slug}.json").write_text(
        json.dumps(running, indent=2)
    )
    (adventures_dir() / target_slug).mkdir(exist_ok=True)
    return running


def delete_adventure(slug: str) -> bool:
    json_path = adventures_dir() / f"{slug}.json"
    if not json_path.is_file():
        return False
    json_path.unlink()
    child_dir = adventures_dir() / slug
    if child_dir.is_dir():
        shutil.rmtree(child_dir)
    return True
