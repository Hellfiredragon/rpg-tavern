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

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique display name for this connection |
| `provider_url` | string | LLM provider base URL (e.g. `http://localhost:5001`) |
| `api_key` | string | API key (optional — KoboldCpp doesn't require one) |

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

## Story Roles (per-adventure)

Each adventure has per-role settings stored in `data/adventures/<slug>/story-roles.json`. These configure **when** each role triggers, **where** it acts, and the **Handlebars prompt template** used to build the LLM prompt.

### Storage

```
data/adventures/<slug>/story-roles.json
```

Written automatically on embark with default values.

### Model

```json
{
  "narrator": {
    "when": "on_player_message",
    "where": "chat",
    "prompt": "{{description}}\n\n{{#each messages}}..."
  },
  "character_writer": { "when": "disabled", "where": "chat", "prompt": "" },
  "extractor": { "when": "disabled", "where": "chat", "prompt": "" }
}
```

| Field | Values | Description |
|---|---|---|
| `when` | `on_player_message`, `after_narration`, `disabled` | Trigger event |
| `where` | `chat` | Context (future: `world`) |
| `prompt` | string | Handlebars template |

### Handlebars Template Variables

| Variable | Type | Available | Description |
|---|---|---|---|
| `description` | string | always | Adventure premise |
| `title` | string | always | Adventure title |
| `message` | string | always | Current player message |
| `history` | string | always | Pre-formatted history (`> ` prefix for player lines) |
| `messages` | array | always | Message objects for `{{#each}}` |
| `messages.[].role` | string | — | `"player"` or `"narrator"` |
| `messages.[].text` | string | — | Content |
| `messages.[].ts` | string | — | ISO timestamp |
| `messages.[].is_player` | boolean | — | Convenience flag |
| `messages.[].is_narrator` | boolean | — | Convenience flag |
| `narration` | string | `after_narration` only | Narrator's response from current turn |

### Chat Pipeline

1. Load adventure, global config, per-adventure story roles, message history
2. Store player message
3. **Phase 1** — run roles with `when: "on_player_message"` in order: narrator → character_writer → extractor
4. **Phase 2** — run roles with `when: "after_narration"` in same order
5. Each role: resolve connection from global config → render Handlebars prompt → call LLM → append response
6. Persist all new messages, return them

Global `config.json` `story_roles` maps role → connection name. Per-adventure `story-roles.json` adds trigger + prompt config.

### Endpoints

```
GET   /api/adventures/{slug}/story-roles
PATCH /api/adventures/{slug}/story-roles   (partial update, same merge pattern as PATCH /settings)
```

## Messages

Chat messages are stored per-adventure in a separate file to keep adventure metadata small.

### Storage

```
data/adventures/<slug>/messages.json   # Array of message objects
```

### Message Model

| Field | Type | Description |
|---|---|---|
| `role` | `"player"` \| `"narrator"` | Who sent the message |
| `text` | string | Message content |
| `ts` | string | ISO 8601 timestamp |

Players describe **intent** — what their character wants to do. The narrator (LLM) decides what actually happens in context of the world.

## Chat

### Endpoints

```
GET  /api/adventures/{slug}/messages
Returns: [ { "role": "player", "text": "...", "ts": "..." }, ... ]

POST /api/adventures/{slug}/chat
Body: { "message": "I look around the tavern" }
Returns: { "messages": [ player_msg, narrator_msg ] }
```

### Prompt Building

The prompt is built from the adventure description + full message history + new player intent:

```
{description}

> {player message 1}

{narrator response 1}

> {player message 2}

{narrator response 2}

> {new player intent}

```

The `> ` prefix marks player lines; bare text is narration. The prompt ends with the new intent, cueing the LLM to narrate.

### Flow

1. Load adventure (404 if missing)
2. Load config → find narrator role's connection name → find matching connection
3. Load message history from `messages.json`
4. Build prompt from description + history + new intent
5. POST to `{provider_url}/api/v1/generate` with `{"prompt": prompt}` (KoboldCpp format)
6. Persist both player message and narrator reply to `messages.json`
7. Return `{"messages": [player_msg, narrator_msg]}`
