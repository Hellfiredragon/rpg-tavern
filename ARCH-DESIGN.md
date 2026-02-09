# Architecture Design

## Object Tree Storage

All game data is stored as a tree of objects on disk, rooted at the data directory (like a filesystem).

### Object Structure

Each object has:
- A **title** — the human-readable name (e.g., "The Cursed Tavern")
- A **slug** derived from the title (e.g., `the-cursed-tavern`) — the on-disk name
- A **JSON file** at `<parent>/<slug>.json` storing the object's data (including the original title)
- A **child folder** at `<parent>/<slug>/` containing child objects

### Slug Rules

Title → slug conversion: Unicode normalized, non-ASCII stripped, lowercased, non-alphanumeric runs replaced with a single hyphen, leading/trailing hyphens removed.

| Title | Slug |
|---|---|
| Hello World | `hello-world` |
| Dragon's Hollow | `dragons-hollow` |
| The Cursed Tavern | `the-cursed-tavern` |

### Path References

Objects are referenced by their **path** from the data root — not by IDs or UUIDs.

Example path: `templates/the-cursed-tavern`

### Title Collision

Two objects cannot have slugs that collide within the same parent folder. Creation fails if the slug already exists at that level.

## Directory Split

Templates and running adventures live in separate directories:

```
data/
  templates/                       # User-created templates
    dragons-hollow.json
    dragons-hollow/
  adventures/                      # Running adventures
    day-of-the-crimson-moon-the-cursed-tavern.json
    day-of-the-crimson-moon-the-cursed-tavern/
```

## Presets (copy-on-write)

Built-in content lives in `presets/` (committed to git). At runtime, preset templates are merged with user templates — user data wins on slug collision.

```
presets/
  templates/
    the-cursed-tavern.json         # Built-in preset template
    the-cursed-tavern/
  adventure-names.txt              # Name generation word lists
```

**Read behavior:** `list_templates()` and `get_template()` merge preset + user data. Presets have `source: "preset"`, user templates have `source: "user"`.

**Write behavior (copy-on-write):** When a preset template is updated, it is first copied to `data/templates/` before applying changes. The preset file is never modified.

**Delete behavior:** Deleting a user override reveals the preset underneath. Preset templates cannot be deleted (only overridden).

## Template

A template is an object under `templates/` (either `data/templates/` or `presets/templates/`).

### Fields

| Field | Type | Description |
|---|---|---|
| `title` | string | Display name |
| `slug` | string | Filesystem slug |
| `description` | string | Adventure premise |
| `source` | `"preset"` \| `"user"` | In-memory only — not stored on disk |
| `created_at` | string | ISO 8601 timestamp (user templates only) |

## Adventure

A running adventure is an object under `data/adventures/`.

### Fields

| Field | Type | Description |
|---|---|---|
| `title` | string | User-chosen adventure name |
| `slug` | string | Filesystem slug |
| `description` | string | Copied from template |
| `template_slug` | string | Slug of source template |
| `created_at` | string | ISO 8601 timestamp |

### Embarking

Embarking creates a running adventure from a template. The user picks a name (with a random suggestion like "Day of the Crimson Moon: The Cursed Tavern"). If the adventure slug collides, a numeric suffix is appended (`my-adventure-2`, `-3`, etc.).

### Name Generation

`adventure-names.txt` has two `#`-headed sections: "Periods" and "Epithets". Generated name format: `"{period} the {epithet}: {template_title}"`.

## URL Routes

| Route | View |
|---|---|
| `/` | Quest board |
| `/templates/<slug>` | Edit a template |
| `/adventures/<slug>` | View a running adventure |
| `/settings` | App settings (LLM connection, display) |

## Config

App settings are stored in `data/config.json` (not under presets — no merging layer).

### Structure

```json
{
  "llm_connections": [ ... ],
  "story_roles": { "narrator": "", "character_writer": "", "extractor": "" },
  "app_width_percent": 100
}
```

### LLM Connections

An array of named LLM connection objects. Replaced wholesale on update.

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | | Unique display name for this connection |
| `provider_url` | string | | LLM provider base URL (e.g. `https://api.openai.com/v1`) |
| `api_key` | string | | API key for the provider |
| `model` | string | | Model name (e.g. `gpt-4o`) |
| `completion_mode` | `"chat"` \| `"text"` | `"chat"` | Completion endpoint style |

### Story Roles

Maps story-telling roles to connection names. Merged key-by-key on partial updates.

| Role | Description |
|---|---|
| `narrator` | Narrates the story and describes world events |
| `character_writer` | Writes NPC dialogue and character actions |
| `extractor` | Extracts structured data from narrative text |

Empty string means "not assigned".

### Display

| Field | Type | Default | Description |
|---|---|---|---|
| `app_width_percent` | number | `100` | Max width of the main content area (50–100%) |

### Merge semantics

`get_config()` returns defaults merged with stored values. `update_config(fields)` applies partial updates:

- `llm_connections` (array) — replaced wholesale
- `story_roles` (dict) — merged key-by-key
- `app_width_percent` (scalar) — overwritten
