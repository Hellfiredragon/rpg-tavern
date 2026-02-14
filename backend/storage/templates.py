"""Template CRUD operations (merged presets + user data, copy-on-write)."""

import json
import shutil
from datetime import datetime, timezone
from typing import Any

from .core import preset_templates_dir, slugify, templates_dir


def list_templates() -> list[dict[str, Any]]:
    by_slug: dict[str, dict[str, Any]] = {}
    # Presets first (lower priority)
    if preset_templates_dir().is_dir():
        for path in sorted(preset_templates_dir().glob("*.json")):
            data = json.loads(path.read_text())
            slug = path.stem
            data["slug"] = slug
            data["source"] = "preset"
            by_slug[slug] = data
    # User templates override
    for path in sorted(templates_dir().glob("*.json")):
        data = json.loads(path.read_text())
        slug = path.stem
        data["source"] = "user"
        by_slug[slug] = data
    return list(by_slug.values())


def get_template(slug: str) -> dict[str, Any] | None:
    # Data dir first
    user_path = templates_dir() / f"{slug}.json"
    if user_path.is_file():
        data = json.loads(user_path.read_text())
        data["source"] = "user"
        return data
    # Preset fallback
    preset_path = preset_templates_dir() / f"{slug}.json"
    if preset_path.is_file():
        data = json.loads(preset_path.read_text())
        data["slug"] = slug
        data["source"] = "preset"
        return data
    return None


def create_template(title: str, description: str = "") -> dict[str, Any]:
    slug = slugify(title)
    json_path = templates_dir() / f"{slug}.json"
    # Check collision in both data and presets
    if json_path.exists():
        raise FileExistsError(f"Template '{title}' already exists (slug: {slug})")
    preset_path = preset_templates_dir() / f"{slug}.json"
    if preset_path.is_file():
        raise FileExistsError(f"Template '{title}' already exists as preset (slug: {slug})")
    template = {
        "title": title,
        "slug": slug,
        "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    json_path.write_text(json.dumps(template, indent=2))
    (templates_dir() / slug).mkdir(exist_ok=True)
    template["source"] = "user"
    return template


def update_template(slug: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    template = get_template(slug)
    if template is None:
        return None

    # Copy-on-write: if only in presets, copy to data first
    user_path = templates_dir() / f"{slug}.json"
    if not user_path.is_file():
        # Write preset data to user dir
        copy = {k: v for k, v in template.items() if k != "source"}
        copy["created_at"] = copy.get(
            "created_at", datetime.now(timezone.utc).isoformat()
        )
        user_path.write_text(json.dumps(copy, indent=2))
        (templates_dir() / slug).mkdir(exist_ok=True)

    # Now apply updates
    allowed = {"title", "description", "intro"}
    for key, value in fields.items():
        if key in allowed:
            template[key] = value

    new_slug = slugify(template["title"])
    if new_slug != slug:
        new_json = templates_dir() / f"{new_slug}.json"
        if new_json.exists():
            raise FileExistsError(
                f"Cannot rename: '{template['title']}' already exists (slug: {new_slug})"
            )
        user_path.rename(new_json)
        old_dir = templates_dir() / slug
        if old_dir.is_dir():
            old_dir.rename(templates_dir() / new_slug)
        template["slug"] = new_slug
    else:
        template["slug"] = slug

    save_data = {k: v for k, v in template.items() if k != "source"}
    out_path = templates_dir() / f"{template['slug']}.json"
    out_path.write_text(json.dumps(save_data, indent=2))
    template["source"] = "user"
    return template


def delete_template(slug: str) -> bool:
    json_path = templates_dir() / f"{slug}.json"
    if not json_path.is_file():
        return False
    json_path.unlink()
    child_dir = templates_dir() / slug
    if child_dir.is_dir():
        shutil.rmtree(child_dir)
    return True
