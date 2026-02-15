"""File-based JSON storage using a tree of slugified objects.

Data layout:
  data/
    templates/           User-created and preset-overridden templates
    adventures/          Running adventures (each with child JSON files)
      <slug>.json        Adventure metadata (title, description, player_name, active_persona)
      <slug>/            Child resources:
        messages.json    Chat message history
        characters.json  NPC character list with states
        personas.json    Adventure-local persona overrides
        lorebook.json    World knowledge entries
        story-roles.json Per-adventure prompt templates + pipeline settings
    personas.json        Global personas
    config.json          App settings (LLM connections, story role defaults, display)
  presets/
    templates/           Built-in read-only templates (merged at read time)
    adventure-names.txt  Name generation word lists (periods + epithets)

Slug rules: title → Unicode normalize → strip non-ASCII → lowercase →
replace non-alnum runs with hyphen → strip leading/trailing hyphens.

Preset merging: list_templates() and get_template() merge preset + user data;
user data wins on slug collision. Copy-on-write: updating a preset copies it
to data/templates/ first. Deleting a user override reveals the preset.

Config: get_config() returns defaults merged with stored values.
update_config() applies partial updates — llm_connections replaced wholesale,
story_roles merged key-by-key, scalars overwritten.
"""

# Re-export all public symbols so `from backend import storage` keeps working.

from .core import (  # noqa: F401
    adventures_dir,
    data_dir,
    init_storage,
    preset_templates_dir,
    presets_dir,
    slugify,
    templates_dir,
)

from .templates import (  # noqa: F401
    create_template,
    delete_template,
    get_template,
    list_templates,
    update_template,
)

from .adventures import (  # noqa: F401
    delete_adventure,
    embark_template,
    generate_adventure_name,
    get_adventure,
    list_adventures,
    touch_adventure,
    update_adventure,
)

from .messages import (  # noqa: F401
    append_messages,
    delete_message,
    get_messages,
)

from .characters import (  # noqa: F401
    get_adventure_personas,
    get_character,
    get_characters,
    get_global_personas,
    get_merged_personas,
    save_adventure_personas,
    save_characters,
    save_global_personas,
)

from .lorebook import (  # noqa: F401
    get_lorebook,
    save_lorebook,
)

from .story_roles import (  # noqa: F401
    DEFAULT_CHARACTER_EXTRACTOR_PROMPT,
    DEFAULT_CHARACTER_INTENTION_PROMPT,
    DEFAULT_LOREBOOK_EXTRACTOR_PROMPT,
    DEFAULT_NARRATOR_PROMPT,
    DEFAULT_STORY_ROLES,
    get_story_roles,
    update_story_roles,
)

from .config import (  # noqa: F401
    get_config,
    update_config,
)
