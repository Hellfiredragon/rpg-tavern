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

Example path: `adventures/the-cursed-tavern`

### Title Collision

Two objects cannot have slugs that collide within the same parent folder. Creation fails if the slug already exists at that level.

### Example Tree

```
data/
  adventures/                        # Child folder of root
    the-cursed-tavern.json           # Adventure object data
    the-cursed-tavern/               # Children of this adventure
    dragons-hollow.json
    dragons-hollow/
    the-lost-caravan.json
    the-lost-caravan/
```

## Adventure

An adventure is an object under `adventures/`.

### Fields

| Field | Type | Description |
|---|---|---|
| `title` | string | Display name |
| `description` | string | Adventure premise |
| `variant` | `"template"` \| `"running"` | Template (editing) or running (active play) |
| `template_path` | string? | Running only — path to source template (e.g., `adventures/the-cursed-tavern`) |
| `created_at` | string | ISO 8601 timestamp |

### Variants

- **Template** (default) — for editing; test chat won't save
- **Running** — active play with persistent chat; created via "Embark" from a template

Embarking copies the template into a new running adventure. If the slug collides with an existing object, a numeric suffix is appended (`the-cursed-tavern-2`, `-3`, etc.).
