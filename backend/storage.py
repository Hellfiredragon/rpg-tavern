"""File-based JSON storage using a tree of slugified objects.

Templates live in data/templates/ (user-created) with preset fallback from
presets/templates/ (read-only, committed to git).  Adventures live in
data/adventures/ only.
"""

import json
import random
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_data_dir: Path | None = None
_presets_dir: Path | None = None
_name_parts: dict[str, list[str]] | None = None


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
    global _data_dir, _presets_dir, _name_parts
    _data_dir = data_dir
    _data_dir.mkdir(parents=True, exist_ok=True)
    templates_dir().mkdir(exist_ok=True)
    adventures_dir().mkdir(exist_ok=True)
    if presets_dir is None:
        # Default: repo_root/presets
        presets_dir = Path(__file__).parent.parent / "presets"
    _presets_dir = presets_dir
    _name_parts = None  # reset cached name parts


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


# ── Templates (merged: data + presets, copy-on-write) ─────


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
    allowed = {"title", "description"}
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


# ── Adventures (data only) ───────────────────────────────


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


# ── Embark ────────────────────────────────────────────────


def embark_template(
    template_slug: str, adventure_title: str
) -> dict[str, Any] | None:
    """Create a running adventure from a template with a user-chosen title."""
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
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (adventures_dir() / f"{target_slug}.json").write_text(
        json.dumps(adventure, indent=2)
    )
    (adventures_dir() / target_slug).mkdir(exist_ok=True)
    return adventure


# ── Name generation ───────────────────────────────────────


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


# ── Config ────────────────────────────────────────────────

_CONFIG_DEFAULTS: dict[str, Any] = {
    "llm_provider_url": "",
    "llm_api_key": "",
    "llm_model": "",
    "llm_completion_mode": "chat",
    "app_width_percent": 100,
}


def _config_path() -> Path:
    return data_dir() / "config.json"


def get_config() -> dict[str, Any]:
    """Read config, returning defaults merged with stored values."""
    config = dict(_CONFIG_DEFAULTS)
    path = _config_path()
    if path.is_file():
        stored = json.loads(path.read_text())
        config.update(stored)
    return config


def update_config(fields: dict[str, Any]) -> dict[str, Any]:
    """Merge fields into config and persist. Returns full config."""
    config = get_config()
    config.update(fields)
    _config_path().write_text(json.dumps(config, indent=2))
    return config
