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
| `intro` | string | Optional intro text — written as first narrator message on embark |
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
| `/templates/<slug>` | Edit a template (tabs: Chat/World/Settings/Global Settings) |
| `/adventures/<slug>` | View a running adventure (tabs: Chat/World/Settings/Global Settings) |

Global Settings (LLM connections, story role assignments, display) is a tab within every template/adventure view, not a separate page.

## Config

App settings are stored in `data/config.json` (not under presets — no merging layer).

### Structure

```json
{
  "llm_connections": [ ... ],
  "story_roles": { "narrator": "", "character_intention": "", "extractor": "" },
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
| `narrator` | Resolves intentions into narration + dialog |
| `character_intention` | Generates character intentions |
| `extractor` | Updates character states after each resolution |

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

Each adventure has per-role settings stored in `data/adventures/<slug>/story-roles.json`. These configure the **Handlebars prompt template** for each role, plus pipeline settings.

### Storage

```
data/adventures/<slug>/story-roles.json
```

Written automatically on embark with default values.

### Model

```json
{
  "narrator": { "prompt": "You are the Game Master..." },
  "character_intention": { "prompt": "You are {{char.name}}..." },
  "extractor": { "prompt": "You are a character state tracker..." },
  "lorebook_extractor": { "prompt": "You extract world facts..." },
  "max_rounds": 3,
  "sandbox": false
}
```

| Field | Type | Description |
|---|---|---|
| `narrator.prompt` | string | Handlebars template for resolving intentions |
| `character_intention.prompt` | string | Handlebars template for character intentions |
| `extractor.prompt` | string | Handlebars template for character state extraction |
| `lorebook_extractor.prompt` | string | Handlebars template for lorebook extraction |
| `max_rounds` | number | Maximum character intention/resolution rounds per turn |
| `sandbox` | boolean | Show character intention messages in chat |

### Handlebars Template Variables

Variables use nested object paths (e.g. `{{char.name}}`).

| Variable | Type | Description |
|---|---|---|
| `title` | string | Adventure title |
| `description` | string | Adventure premise |
| `message` | string | Current player message |
| `history` | string | Pre-formatted history (`> ` prefix for player lines) |
| `intention` | string | Current intention being resolved (narrator) |
| `narration` | string | Narrator response text |
| `msgs` | array | Message objects for `{{#each}}` (.role, .text, .ts, .is_player, .is_narrator) |
| `char.name` | string | Current character name |
| `char.description` | string | Current character personality |
| `char.states` | string | Visible states (≥6) for current character |
| `char.all_states` | string | All states with raw values (extractor only) |
| `chars.list` | array | Character objects with .name, .descriptions |
| `chars.summary` | string | Pre-formatted character states |
| `chars.active` | array | Active characters this round |
| `chars.active_summary` | string | Active characters summary |
| `turn.narration` | string | All narration this turn so far |
| `turn.round_narrations` | string | All narrations from current round |
| `lore.text` | string | Pre-formatted matched lorebook entries |
| `lore.entries` | array | Matched lorebook entry objects |

### Chat Pipeline (Intention/Resolution)

1. Load adventure, global config, per-adventure story roles, message history, characters, lorebook
2. **Player resolution** — narrator resolves the player's intention → segments
3. **Character extractor** — for each character named in narration, update states
4. **Round loop** (up to `max_rounds`):
   - Activate characters (name matching + chattiness roll)
   - Each active character generates an **intention** (1 LLM call)
   - Narrator **resolves** the intention → segments (1 LLM call)
   - Character extractor updates that character's states (1 LLM call)
5. **Lorebook extractor** — extract new world facts from all narrations
6. **Tick** all character states
7. Combine all segments into one narrator message, persist all messages
8. Return `{"messages": [player_msg, ...intention_msgs?, narrator_msg]}`

Global `config.json` `story_roles` maps role → connection name. Per-adventure `story-roles.json` has prompt templates and pipeline settings.

### Endpoints

```
GET   /api/adventures/{slug}/story-roles
PATCH /api/adventures/{slug}/story-roles   (partial update, same merge pattern as PATCH /settings)
```

## Characters

Each adventure has characters with internal states that influence their behavior in the story. Characters are managed in the World tab.

### Storage

```
data/adventures/<slug>/characters.json   # Array of character objects
```

Written automatically on embark as an empty array `[]`.

### Character Model

```json
{
  "name": "Gareth",
  "slug": "gareth",
  "nicknames": ["Cap", "Captain"],
  "chattiness": 70,
  "states": {
    "core": [{ "label": "Loyal to the King", "value": 18 }],
    "persistent": [{ "label": "Loves Elena", "value": 12 }],
    "temporal": [{ "label": "Angry", "value": 4 }]
  },
  "overflow_pending": false
}
```

### State Categories

| Category | Max Slots | Max Value | Tick Rate | Description |
|----------|-----------|-----------|-----------|-------------|
| core | 3 | 30 | +2/round | Rarely change, life crisis if challenged |
| persistent | 10 | 20 | +1/round | Current beliefs, relationships |
| temporal | 10 | — | -1/round | Short-lived emotions, situations (promotes to persistent at 20+) |

### Value Thresholds

| Range | Level | Description Template |
|-------|-------|---------------------|
| < 6 | silent | (not mentioned in prompts) |
| 6-10 | urge | "feels an urge related to {label}" |
| 11-16 | driver | "{label} drives their actions" |
| 17-20 | important | "{label} is very important to them" |
| 21+ | overflow | "{label} is their absolute focus" |

### Tick & Promotion Rules

- **Per round**: after chat pipeline phases complete, all characters are ticked
- **Value capping**: core states cap at 30, persistent states cap at 20 (applied after tick)
- **Temporal tick**: -1 per round (states decay toward removal)
- **Removal**: any state reaching value 0 is removed
- **Temporal -> persistent promotion**: temporal state reaching value 20+ moves to persistent (if slots available)
- **Category overflow**: if a category exceeds max slots, `overflow_pending` is set to true

### Endpoints

```
GET    /api/adventures/{slug}/characters           — list all characters
POST   /api/adventures/{slug}/characters           — create { "name": "Gareth" }
GET    /api/adventures/{slug}/characters/{cslug}   — get single character
PATCH  /api/adventures/{slug}/characters/{cslug}   — update states, nicknames, chattiness
DELETE /api/adventures/{slug}/characters/{cslug}   — remove character
```

### Character Activation

Each round (within a turn), characters are evaluated for activation:
1. **Name/nickname match** — if the character's name or any nickname appears (case-insensitive) in the narration or player message, the character is always activated
2. **Chattiness roll** — otherwise, `random(0, 100) < chattiness` determines spontaneous activation

Active characters each generate an intention and have it resolved by the narrator.

### State Visibility ("Subconscious" Model)

- **Values 0-5 (silent):** Hidden from character + narrator. Only extractor sees them.
- **Values 6+ (visible):** Shown to character intention LLM + narrator with threshold descriptions.
- **All values:** Visible to extractor with raw numeric values for precise tracking.

### Prompt Context

Characters are included in the Handlebars prompt context:
- `chars.list` / `chars.summary` — all characters with visible states (for narrator)
- `char.name` / `char.states` — single character's visible states (for intentions)
- `char.all_states` — all states with raw values (for extractor)

## Lorebook

Per-adventure lorebook for world knowledge that's injected into prompts when keywords match.

### Storage

```
data/adventures/<slug>/lorebook.json   # Array of lorebook entry objects
```

Written automatically on embark as an empty array `[]`.

### Entry Model

```json
{
  "title": "The Dragon Fafnir",
  "content": "A young mountain dragon, barely a century old...",
  "keywords": ["fafnir", "dragon", "mountain"]
}
```

### Keyword Matching

Before building prompts each turn, the player message + last 5 messages are scanned for case-insensitive keyword substring matches. Matched entries are deduplicated and injected as `{{lore.text}}` (pre-formatted) and `{{lore.entries}}` (array).

### Endpoints

```
GET    /api/adventures/{slug}/lorebook
POST   /api/adventures/{slug}/lorebook
PATCH  /api/adventures/{slug}/lorebook/{index}
DELETE /api/adventures/{slug}/lorebook/{index}
```

## Extractors

Two extractors run during the pipeline. Both use best-effort JSON parsing (markdown fences stripped, invalid JSON logged and skipped).

### Character Extractor

Runs after each narrator resolution. Updates states for a single character.

```json
{
  "state_changes": [
    {"category": "temporal", "label": "Impressed", "value": 8}
  ]
}
```

State changes update existing states by label match or add new ones. Values are capped per category.

### Lorebook Extractor

Runs once per turn. Adds new world facts.

```json
{
  "lorebook_entries": [
    {"title": "Hidden Passage", "content": "...", "keywords": ["passage"]}
  ]
}
```

New entries are deduplicated by title (case-insensitive).

## Messages

Chat messages are stored per-adventure in a separate file to keep adventure metadata small.

### Storage

```
data/adventures/<slug>/messages.json   # Array of message objects
```

### Message Model

| Field | Type | Description |
|---|---|---|
| `role` | `"player"` \| `"narrator"` \| `"intention"` | Who sent the message |
| `text` | string | Message content (plain text for prompt history) |
| `segments` | array? | Structured narration/dialog segments (narrator only) |
| `character` | string? | Character name (intention messages only) |
| `ts` | string | ISO 8601 timestamp |

### Segment Model

| Field | Type | Description |
|---|---|---|
| `type` | `"narration"` \| `"dialog"` | Segment type |
| `text` | string | Content |
| `character` | string? | Character name (dialog only) |
| `emotion` | string? | Emotion tag (dialog only) |

Players describe **intent** — what their character wants to do. The narrator (LLM) decides what actually happens in context of the world. Intention messages are only visible in sandbox mode.

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

See "Chat Pipeline (Intention/Resolution)" under Story Roles above.
