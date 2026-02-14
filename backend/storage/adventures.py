"""Adventure CRUD, embark, and name generation."""

import json
import random
import shutil
from datetime import datetime, timezone
from typing import Any

from .core import adventures_dir, presets_dir, slugify

_name_parts: dict[str, list[str]] | None = None


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


def delete_adventure(slug: str) -> bool:
    json_path = adventures_dir() / f"{slug}.json"
    if not json_path.is_file():
        return False
    json_path.unlink()
    child_dir = adventures_dir() / slug
    if child_dir.is_dir():
        shutil.rmtree(child_dir)
    return True


def update_adventure(slug: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Update mutable adventure fields (player_name, active_persona). Returns updated adventure."""
    adventure = get_adventure(slug)
    if adventure is None:
        return None
    allowed = {"player_name", "active_persona"}
    for key, value in fields.items():
        if key in allowed:
            adventure[key] = value
    path = adventures_dir() / f"{slug}.json"
    path.write_text(json.dumps(adventure, indent=2))
    return adventure


def embark_template(
    template_slug: str, adventure_title: str, player_name: str = ""
) -> dict[str, Any] | None:
    """Create a running adventure from a template with a user-chosen title."""
    from .characters import _characters_path, _personas_adventure_path
    from .config import get_config
    from .lorebook import _lorebook_path
    from .story_roles import DEFAULT_STORY_ROLES, _story_roles_path
    from .templates import get_template

    template = get_template(template_slug)
    if template is None:
        return None

    base_slug = slugify(adventure_title)
    target_slug = base_slug
    counter = 2
    while (adventures_dir() / f"{target_slug}.json").exists():
        target_slug = f"{base_slug}-{counter}"
        counter += 1

    adventure = {
        "title": adventure_title,
        "slug": target_slug,
        "description": template["description"],
        "template_slug": template_slug,
        "player_name": player_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (adventures_dir() / f"{target_slug}.json").write_text(
        json.dumps(adventure, indent=2)
    )
    (adventures_dir() / target_slug).mkdir(exist_ok=True)
    # Write default story roles for the new adventure, copying global connection assignments
    initial_roles = json.loads(json.dumps(DEFAULT_STORY_ROLES))
    config = get_config()
    global_conns = config.get("story_roles", {})
    for role_name in ("narrator", "character_intention", "extractor", "lorebook_extractor"):
        if role_name in initial_roles and global_conns.get(role_name):
            initial_roles[role_name]["connection"] = global_conns[role_name]
    _story_roles_path(target_slug).write_text(
        json.dumps(initial_roles, indent=2)
    )
    # Write empty characters list
    _characters_path(target_slug).write_text(json.dumps([], indent=2))
    # Write empty lorebook
    _lorebook_path(target_slug).write_text(json.dumps([], indent=2))
    # Write empty personas
    _personas_adventure_path(target_slug).write_text(json.dumps([], indent=2))
    # Write intro as first narrator message if set
    intro = template.get("intro", "")
    if intro:
        intro_msg = {
            "role": "narrator",
            "text": intro,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        (adventures_dir() / target_slug / "messages.json").write_text(
            json.dumps([intro_msg], indent=2)
        )
    return adventure


def _load_name_parts() -> dict[str, list[str]]:
    global _name_parts
    if _name_parts is not None:
        return _name_parts

    path = presets_dir() / "adventure-names.txt"
    sections: dict[str, list[str]] = {}
    current: str | None = None
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line.startswith("# "):
                current = line[2:].strip().lower()
                sections[current] = []
            elif line and current is not None:
                sections[current].append(line)
    _name_parts = sections
    return _name_parts


def generate_adventure_name(template_title: str) -> str:
    parts = _load_name_parts()
    periods = parts.get("periods", ["Day of"])
    epithets = parts.get("epithets", ["the Unknown"])
    period = random.choice(periods)
    epithet = random.choice(epithets)
    return f"{template_title} in the {period} the {epithet}"
