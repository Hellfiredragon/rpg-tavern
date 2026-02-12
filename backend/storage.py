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


# ── Messages ─────────────────────────────────────────────


def get_messages(slug: str) -> list[dict[str, Any]]:
    """Load messages for an adventure. Returns [] if none exist."""
    path = adventures_dir() / slug / "messages.json"
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def append_messages(slug: str, messages: list[dict[str, Any]]) -> None:
    """Append messages to an adventure's chat log."""
    path = adventures_dir() / slug / "messages.json"
    existing = get_messages(slug)
    existing.extend(messages)
    path.write_text(json.dumps(existing, indent=2))


# ── Story Roles (per-adventure) ──────────────────────────

DEFAULT_NARRATOR_PROMPT = """\
You are the Game Master narrating an RPG adventure.

## Setting
{{description}}

{{#if lore.text}}
## Lorebook
{{lore.text}}

{{/if}}
{{#if chars.summary}}
## Characters
{{chars.summary}}

{{/if}}
## Recent History
{{#last msgs 6}}
{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}

{{/last}}
{{#if turn.narration}}
## Earlier This Turn
{{turn.narration}}

{{/if}}
## Intention to Resolve
{{intention}}

Narrate the outcome of this intention. Use the character's visible states \
to judge success or failure. Write dialog using this strict format:

Name(emotion): Dialog text here.

Where Name is an existing character name. Anything not in this format is \
narration. Only resolve THIS intention — do not control other characters or \
the player. If the intention tries to control others, ignore that part.\
"""

DEFAULT_CHARACTER_INTENTION_PROMPT = """\
You are {{char.name}} in an RPG adventure.

## Your Personality
{{char.description}}

## Your Current States
{{#each char.states}}
- {{description}}
{{/each}}

## Recent History
{{#last msgs 6}}
{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}

{{/last}}
## What Just Happened
{{turn.narration}}

State what YOU want to do next in 1-2 first-person sentences. Do not decide \
the outcome. Do not control other characters or the player. Only describe \
your own intended action or speech.\
"""

DEFAULT_CHARACTER_EXTRACTOR_PROMPT = """\
You are a character state tracker for {{char.name}}.

## All States (with raw values)
{{#each char.all_states}}
- {{category}}/{{label}} = {{value}} ({{level}})
{{/each}}

## Narration
{{narration}}

Output a JSON object with state changes for {{char.name}} ONLY:

```json
{
  "state_changes": [
    {"category": "temporal", "label": "State Label", "value": 8}
  ]
}
```

Categories: "temporal" for emotions/situations, "persistent" for relationships, \
"core" for identity. Values 1-5 are subconscious (character unaware), 6+ are \
conscious. Output valid JSON only.\
"""

DEFAULT_LOREBOOK_EXTRACTOR_PROMPT = """\
You extract world facts from RPG narration.

## Round Narrations
{{turn.round_narrations}}

Output a JSON object with new world facts ONLY (skip things already known):

```json
{
  "lorebook_entries": [
    {"title": "Entry Title", "content": "Description...", "keywords": ["keyword1"]}
  ]
}
```

Only include genuinely new world facts, locations, or items revealed. \
Output valid JSON only.\
"""

DEFAULT_STORY_ROLES: dict[str, Any] = {
    "narrator": {
        "prompt": DEFAULT_NARRATOR_PROMPT,
    },
    "character_intention": {
        "prompt": DEFAULT_CHARACTER_INTENTION_PROMPT,
    },
    "extractor": {
        "prompt": DEFAULT_CHARACTER_EXTRACTOR_PROMPT,
    },
    "lorebook_extractor": {
        "prompt": DEFAULT_LOREBOOK_EXTRACTOR_PROMPT,
    },
    "max_rounds": 3,
    "sandbox": False,
}


def _story_roles_path(slug: str) -> Path:
    return adventures_dir() / slug / "story-roles.json"


def _migrate_story_roles(stored: dict[str, Any]) -> dict[str, Any]:
    """Migrate old story-roles format to new pipeline format.

    Old format had: narrator, character_writer, extractor (each with when/where/prompt).
    New format has: narrator, character_intention, extractor, lorebook_extractor
    (each with prompt only), plus max_rounds and sandbox.
    """
    migrated = False

    # Rename character_writer → character_intention
    if "character_writer" in stored and "character_intention" not in stored:
        stored["character_intention"] = {"prompt": stored["character_writer"].get("prompt", "")}
        del stored["character_writer"]
        migrated = True

    # Remove old when/where fields from roles
    for role_name in ("narrator", "character_intention", "extractor", "lorebook_extractor"):
        if role_name in stored and isinstance(stored[role_name], dict):
            for old_field in ("when", "where"):
                if old_field in stored[role_name]:
                    del stored[role_name][old_field]
                    migrated = True

    # Add missing top-level fields
    if "max_rounds" not in stored:
        stored["max_rounds"] = 3
        migrated = True
    if "sandbox" not in stored:
        stored["sandbox"] = False
        migrated = True

    return stored


def get_story_roles(slug: str) -> dict[str, Any]:
    """Read per-adventure story role settings. Returns defaults if missing."""
    path = _story_roles_path(slug)
    if not path.is_file():
        return json.loads(json.dumps(DEFAULT_STORY_ROLES))  # deep copy
    stored = json.loads(path.read_text())
    stored = _migrate_story_roles(stored)
    # Merge with defaults so new roles get default values
    result = json.loads(json.dumps(DEFAULT_STORY_ROLES))
    for key, value in stored.items():
        if key in result and isinstance(value, dict) and isinstance(result[key], dict):
            result[key].update(value)
        else:
            result[key] = value
    return result


def update_story_roles(slug: str, roles: dict[str, Any]) -> dict[str, Any]:
    """Merge partial role updates and persist. Returns full roles."""
    current = get_story_roles(slug)
    role_names = {"narrator", "character_intention", "extractor", "lorebook_extractor"}
    top_level_fields = {"max_rounds", "sandbox"}

    for key, value in roles.items():
        if key in role_names and isinstance(value, dict):
            if key not in current:
                current[key] = {}
            for field, fval in value.items():
                if field == "prompt":
                    current[key][field] = fval
        elif key in top_level_fields:
            current[key] = value

    path = _story_roles_path(slug)
    path.write_text(json.dumps(current, indent=2))
    return current


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
    # Write default story roles for the new adventure
    _story_roles_path(target_slug).write_text(
        json.dumps(DEFAULT_STORY_ROLES, indent=2)
    )
    # Write empty characters list
    _characters_path(target_slug).write_text(json.dumps([], indent=2))
    # Write empty lorebook
    _lorebook_path(target_slug).write_text(json.dumps([], indent=2))
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


# ── Lorebook ──────────────────────────────────────────────


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


# ── Characters ────────────────────────────────────────────


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
    "llm_connections": [],
    "story_roles": {
        "narrator": "",
        "character_intention": "",
        "extractor": "",
    },
    "app_width_percent": 100,
    "help_panel_width_percent": 25,
}


def _config_path() -> Path:
    return data_dir() / "config.json"


def get_config() -> dict[str, Any]:
    """Read config, returning defaults merged with stored values."""
    config: dict[str, Any] = {
        "llm_connections": list(_CONFIG_DEFAULTS["llm_connections"]),
        "story_roles": dict(_CONFIG_DEFAULTS["story_roles"]),
        "app_width_percent": _CONFIG_DEFAULTS["app_width_percent"],
        "help_panel_width_percent": _CONFIG_DEFAULTS["help_panel_width_percent"],
    }
    path = _config_path()
    if path.is_file():
        stored = json.loads(path.read_text())
        if "llm_connections" in stored:
            config["llm_connections"] = stored["llm_connections"]
        if "story_roles" in stored:
            roles = stored["story_roles"]
            # Migrate: character_writer → character_intention
            if "character_writer" in roles and "character_intention" not in roles:
                roles["character_intention"] = roles.pop("character_writer")
            elif "character_writer" in roles:
                del roles["character_writer"]
            config["story_roles"].update(roles)
        if "app_width_percent" in stored:
            config["app_width_percent"] = stored["app_width_percent"]
        if "help_panel_width_percent" in stored:
            config["help_panel_width_percent"] = stored["help_panel_width_percent"]
    return config


def update_config(fields: dict[str, Any]) -> dict[str, Any]:
    """Merge fields into config and persist. Returns full config."""
    config = get_config()
    if "llm_connections" in fields:
        config["llm_connections"] = fields["llm_connections"]
    if "story_roles" in fields:
        config["story_roles"].update(fields["story_roles"])
    if "app_width_percent" in fields:
        config["app_width_percent"] = fields["app_width_percent"]
    if "help_panel_width_percent" in fields:
        config["help_panel_width_percent"] = fields["help_panel_width_percent"]
    _config_path().write_text(json.dumps(config, indent=2))
    return config
