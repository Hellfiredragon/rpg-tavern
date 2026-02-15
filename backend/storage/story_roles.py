"""Per-adventure story role settings (prompt templates + pipeline config)."""

import json
from pathlib import Path
from typing import Any

from .core import adventures_dir

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
{{#last msgs 20}}
{{#if is_player}}> {{text}}{{else}}{{#if is_dialog}}{{character}}({{emotion}}): {{text}}{{else}}{{text}}{{/if}}{{/if}}

{{/last}}
{{#if turn.narration}}
## Earlier This Turn
{{turn.narration}}

{{/if}}
## Intention to Resolve
{{intention}}

Narrate the outcome of this intention in the third person. Begin by \
describing what the player character ({{player_name}}) does, then show \
how the world reacts. Use character states to inform success or failure — \
strong states make related actions easier, weak or absent states make them \
harder.

Write dialog in this exact format:
Name(emotion): Dialog text here.

Where Name is an existing character name (including {{player_name}}). \
Everything else is narration. You may write dialog for the acting character. \
Do not invent new independent actions for other characters — only describe \
their reactions and the environment. Keep narration concise.\
"""

DEFAULT_CHARACTER_INTENTION_PROMPT = """\
You are {{char.name}} in an RPG adventure. The player character is \
{{player_name}}.

## Your Personality
{{char.description}}

## Your Current States
{{#each char.states}}
- {{description}}
{{/each}}

## Recent History
{{#last msgs 20}}
{{#if is_player}}> {{text}}{{else}}{{#if is_dialog}}{{character}}({{emotion}}): {{text}}{{else}}{{text}}{{/if}}{{/if}}

{{/last}}
## What Just Happened
{{turn.narration}}

State what YOU want to do next in 1-2 first-person sentences. Do not decide \
the outcome — the Game Master will narrate what happens. Do not control \
other characters or {{player_name}}. Only describe your own intended action \
or speech.\
"""

DEFAULT_CHARACTER_EXTRACTOR_PROMPT = """\
You are a character state tracker for {{char.name}} in an adventure where \
the player character is {{player_name}}.

## All States (with raw values)
{{#each char.all_states}}
- {{category}}/{{label}} = {{value}} ({{level}})
{{/each}}

## Narration
{{narration}}

Output a JSON object with state changes for {{char.name}} ONLY based on \
the narration above:

```json
{
  "state_changes": [
    {"category": "temporal", "label": "State Label", "value": 8}
  ]
}
```

Categories: "temporal" for emotions/situations, "persistent" for relationships, \
"core" for identity. Values 1-5 are subconscious (character unaware), 6+ are \
conscious. Only include states that actually changed. Output valid JSON only.\
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
        "connection": "",
    },
    "character_intention": {
        "prompt": DEFAULT_CHARACTER_INTENTION_PROMPT,
        "connection": "",
    },
    "extractor": {
        "prompt": DEFAULT_CHARACTER_EXTRACTOR_PROMPT,
        "connection": "",
    },
    "lorebook_extractor": {
        "prompt": DEFAULT_LOREBOOK_EXTRACTOR_PROMPT,
        "connection": "",
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
                if field in ("prompt", "connection"):
                    current[key][field] = fval
        elif key in top_level_fields:
            current[key] = value

    path = _story_roles_path(slug)
    path.write_text(json.dumps(current, indent=2))
    return current
