# RPG Tavern

## Stack

- **Runtime:** Bun (not Node) — use Bun APIs (`Bun.serve`, `Bun.file`, etc.) instead of Node equivalents
- **Language:** TypeScript (strict mode)
- **Frontend:** HTMX — no JS framework; the server returns HTML fragments, not JSON
- **Styling:** Plain CSS (no preprocessor, no Tailwind)

## Commands

- `bun run dev` — start server with file watching (auto-reload on changes)
- `bun run start` — start server (production)
- `bun install` — install dependencies

## Project layout

```
src/
  server.ts        # Entry point — Bun.serve(), static files, startup
  routes.ts        # API route handlers
  renderers.ts     # HTML rendering functions
  chat.ts          # Chat persistence — types, JSONL read/write, CRUD
  settings.ts      # Settings persistence
  lorebook.ts      # Lorebook system
  public/          # Static assets served by the backend
    index.html     # HTML structure + dialogs
    app.js         # Client-side JavaScript (tabs, routing, event handlers)
    styles.css     # Base layout + utility CSS
    components.css # Feature component CSS (adventure, lorebook, chat)
    lorebook.html  # Standalone lorebook page
    settings.html  # Standalone settings page
presets/
  lorebooks/       # Built-in read-only template lorebooks (checked into git)
    default/
    template-key-quest/
```

## UI

- **Layout:** Single-page app using 90% of the page width (max 1400px), with a tab bar at the top
- **Tabs:** Adventure | Lorebook | Settings — switching tabs shows/hides panels client-side
- **Dialogs:** "+ New" (entry/folder), "+ Template", "Save as Template", and adventure start/delete use `<dialog>` elements with consistent styling
- Standalone pages (`/lorebook.html`, `/settings.html`) also exist and share the same CSS

## Adventure System

The Chat tab has been redesigned into an **Adventure** tab. Users pick an adventure (lorebook), enter a play view with a location bar and chat. Locations come from the lorebook's `locations/` folder.

### Chat module (`src/chat.ts`)

- **Types:**
  - `ChatMeta` — `{ id, title, createdAt, updatedAt, lorebook, currentLocation, traits }`
  - `ChatMessage` — `{ role: "user"|"assistant"|"system", content, timestamp }`
  - System messages are narration (e.g. location transitions), rendered centered/italic
- **Storage:** `data/chats/<id>.jsonl` — one file per conversation in JSONL format
  - Line 1: `ChatMeta`
  - Lines 2+: `ChatMessage`
  - ID format: `<timestamp>-<3-char-hex>` (e.g. `1738262400000-a3f`)
  - Title: auto-set from first user message, truncated to 50 chars
  - Old JSONL files missing `lorebook`/`currentLocation`/`traits` default to `""`/`""`/`[]` on load
- **Functions:** `generateChatId()`, `createConversation(opts?)`, `listConversations(lorebook?)`, `loadConversation()`, `appendMessage()`, `deleteConversation()`, `changeLocation()`, `updateTraits()`
  - `createConversation` accepts `{ id?, lorebook?, currentLocation?, traits? }`
  - `listConversations` accepts optional lorebook filter
  - `changeLocation(id, locationPath, narration)` — updates meta.currentLocation + appends system message atomically
  - `updateTraits(id, traits)` — rewrites meta line with updated traits array

### Adventure UI

- **Picker state** (`#adventure-picker`): Shows adventure cards with Continue/Save as Template/Delete buttons + template cards with Start button
- **Play state** (`#adventure-play`): Location bar (back button, adventure name, location dropdown) + chat messages + input + active entries panel (right sidebar)
- **Template start flow:** Dialog to name the copy → `POST /api/lorebooks/copy` → `POST /api/chats` → enter play view
- **Save as Template flow:** Dialog to name the template → `POST /api/lorebooks/make-template` → refreshes lorebook selector
- **Location change:** Dropdown change → `PUT /api/adventures/location` → system narration message appended to chat

### API routes

- `GET /api/adventures` — returns adventure picker HTML (user lorebooks + templates)
- `GET /api/adventures/resume?lorebook=` — returns JSON `{ lorebook, chatId, name, location }` for the latest conversation of a lorebook (404 if none). Used by the router to restore adventure play from a URL.
- `GET /api/adventures/locations?lorebook=` — returns `<option>` elements for the location dropdown
- `PUT /api/adventures/location` — JSON `{ chatId, location }` → loads location entry, appends narration, returns narration HTML + `X-Location` header + `HX-Trigger: refreshActiveEntries`
- `GET /api/adventures/active-entries?chatId=` — returns HTML panel of currently active lorebook entries based on context (location, chat text, traits)
- `PUT /api/adventures/traits` — JSON `{ chatId, traits }` → updates player traits and returns updated active entries HTML
- `GET /api/chats?lorebook=` — returns chat list HTML, optional lorebook filter
- `POST /api/chats` — JSON `{ lorebook?, location? }` → create conversation bound to lorebook → `X-Chat-Id` header
- `GET /api/chats/messages?id=` — load conversation messages as HTML (supports system messages)
- `POST /api/chat` — JSON `{ message, chatId?, lorebook? }` → auto-creates conversation with lorebook if no chatId
- **Location detection (dummy LLM):** `POST /api/chat` parses movement intent from user messages (e.g. "go to X", "enter X", "walk to X"). If a destination is detected and a lorebook is attached:
  - Matches against existing location entries (case-insensitive, partial matching)
  - If no match, creates a new lorebook entry under `locations/<slugified-name>.json` with a generated description
  - Calls `changeLocation()` to update the conversation and append system narration
  - Returns system narration HTML + assistant HTML + `X-Location` header
  - Client reads `X-Location` from the response and refreshes the location dropdown
- **Current behavior:** When no location change is detected, assistant responds with "Hello World" (placeholder for future LLM integration). When a location change is detected, assistant responds with "You arrive at \<location\>."

## Routing

Hash-based client-side routing. The browser back/forward buttons work, and URLs are shareable/bookmarkable.

### URL scheme

| Hash | View |
|------|------|
| `#adventure` (or empty) | Adventure tab, picker |
| `#adventure/<slug>` | Adventure tab, playing that adventure (resumed via `/api/adventures/resume`) |
| `#lorebook` | Lorebook tab, picker |
| `#lorebook/<slug>` | Lorebook tab, editing that lorebook (restored via `/api/lorebooks/meta`) |
| `#settings` | Settings tab |

### Implementation

- `navigateTo(hash, skipPush)` — core router function. Parses hash, calls `switchTab()`, then transitions to the correct view. `skipPush=true` prevents pushing a new history entry (used by popstate and initial load).
- `switchTab(tabName)` — toggles CSS classes on tabs/panels only, no side effects.
- `popstate` listener calls `navigateTo(location.hash, true)`.
- Initial page load calls `navigateTo(location.hash, true)` to restore state from the URL.
- Tab clicks call `navigateTo('#' + tabName, false)` which pushes history.
- Lorebook picker/editor transitions push `#lorebook/<slug>` or `#lorebook`.
- Adventure play/picker transitions push `#adventure/<slug>` or `#adventure`.

## Settings

- **Module:** `src/settings.ts` — `Settings` type, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings()`
- **Persistence:** `data/settings.json` (project root) — created on first save, gitignored (contains API keys)
- **UI:** Settings tab in index.html, also standalone at `/settings.html`
- **API routes:**
  - `GET /api/settings` — returns JSON (API key masked)
  - `GET /api/settings/form` — returns pre-filled HTML form fragment
  - `PUT /api/settings` — validates & saves, returns HTML feedback + updated form

## Unified Lorebook / Adventure Model

- **Preset** = built-in lorebook in `presets/lorebooks/`. Always available, read-only. Cannot be modified or deleted.
- **Template** = lorebook with `template: true`. Shown and editable in the **Lorebook tab**. Presets are templates. User-created templates can be edited and deleted.
- **Adventure** = non-template lorebook + conversations. Shown and playable in the **Adventure tab**.
- Every non-template lorebook is an adventure (1:1). No orphan non-template lorebooks.
- Adventures are created by copying a template (including presets, which creates a new non-template lorebook + conversation in `data/`).
- Adventures can be saved back as templates ("Save as Template" button in the adventure picker).
- On startup, `migrateOrphanLorebooks()` converts any non-template, non-preset lorebook with zero conversations into a template.

## Lorebook

- **Module:** `src/lorebook.ts` — `LorebookEntry` type, `LorebookMeta` type, tree scanning, CRUD, matching engine, lorebook management, presets
- **Storage:** Lorebooks are resolved from two directories:
  - `data/lorebooks/<slug>/` — user-created lorebooks (runtime data, gitignored)
  - `presets/lorebooks/<slug>/` — built-in read-only templates (checked into git)
  - User data dir takes priority: if a slug exists in both, the data dir version is used
  - Each lorebook directory contains:
    - `_lorebook.json` — metadata file with `{ "name": "Display Name", "template"?: true }`
    - Nested JSON files — each `.json` file (except `_lorebook.json`) is one entry
    - Directories organize entries into categories
  - Example preset layout:
    ```
    presets/lorebooks/
      default/
        _lorebook.json       # { "name": "Default Lorebook", "template": true }
      template-key-quest/
        _lorebook.json       # { "name": "Key Quest", "template": true }
        characters/
          old-sage.json
          blacksmith.json
          innkeeper.json
        items/
          iron-key.json
        locations/
          village-square.json
          cellar.json
          treasure-room.json
    ```
- **Presets:** Built-in lorebooks in `presets/lorebooks/` are read-only. They are always available and cannot be modified or deleted via the UI or API.
  - `isPresetLorebook(slug)` — returns true if a slug exists in the presets directory
  - `isReadOnlyPreset(slug)` — returns true if it's a preset AND there's no user-data override
  - Write functions (`saveEntry`, `deleteEntry`, `createFolder`, `deleteFolder`, `deleteLorebook`, `saveLorebookMeta`) call `assertNotPreset()` which throws if the lorebook is a read-only preset
  - `copyLorebook(source, dest, name)` can copy FROM a preset (source resolves via both dirs) but always writes TO the data dir
  - `listLorebooks()` returns `{ slug, meta, preset: boolean }[]` — scans data dir first, then presets (skipping slugs already in data dir)
  - UI: preset template cards show View button (read-only editor) + Copy button (creates editable user template); no Delete button. Tree/entry forms are rendered in read-only mode for presets.
  - **Key Quest template** (`template-key-quest`): A story where the player asks three NPCs who has the key and where to open a locked room to get the treasure. Contains 7 entries (3 characters, 1 item, 3 locations).
- **Templates:** Lorebooks with `"template": true` in metadata. Shown as cards in the Lorebook tab picker with Edit buttons, plus a "+ Template" button. User-created templates also get a Delete button.
- **Migration:** On startup, `migrateOrphanLorebooks()` converts non-template, non-preset lorebooks with no conversations into templates.
- **All CRUD functions** take `lorebook: string` as their first argument (the lorebook slug)
- **Functions:** `saveLorebookMeta(slug, meta)` — writes updated `_lorebook.json` for an existing lorebook
- **UI:** Lorebook tab in index.html (also standalone at `/lorebook.html`) — two-step layout mirroring the Adventure tab:
  - **Picker** (`#lorebook-picker`): Card-based list of lorebooks. Adventures (non-template) get an Edit button. User templates get Edit + Delete buttons. Preset templates get View + Copy buttons. Includes "+ Template" button.
  - **Editor** (`#lorebook-edit`): Header bar (back button + lorebook name) + tree browser with per-folder "+ New" buttons + entry editor panel.
- **API routes:**
  - Lorebook management (under `/api/lorebooks`):
    - `GET /api/lorebooks` — returns lorebook picker HTML (card-based list + "+ Template" button)
    - `GET /api/lorebooks/meta?slug=` — returns JSON `{ slug, name, template, preset }` for a lorebook (404 if not found). Used by router to restore lorebook editor from URL.
    - `POST /api/lorebooks` — create template (JSON `{ slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `POST /api/lorebooks/copy` — copy a lorebook as non-template (JSON `{ source, slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `POST /api/lorebooks/make-template` — copy a lorebook as template (JSON `{ source, slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `DELETE /api/lorebooks?slug=...` — delete a lorebook (403 for presets) → `HX-Trigger: refreshLorebooks`
  - Lorebook entries (under `/api/lorebook/`, use `?path=` and `?lorebook=` query params):
    - `GET /api/lorebook/tree?lorebook=...` — returns tree HTML fragment (read-only for presets: no "+ New" or delete buttons)
    - `GET /api/lorebook/entry?path=...&lorebook=...` — returns entry editor form (read-only with disabled inputs for presets)
    - `POST /api/lorebook/entry?path=...&lorebook=...` — create entry (403 for presets)
    - `PUT /api/lorebook/entry?path=...&lorebook=...` — update entry (403 for presets)
    - `DELETE /api/lorebook/entry?path=...&lorebook=...` — delete entry (403 for presets)
    - `POST /api/lorebook/folder?lorebook=...` — create folder (403 for presets)
    - `DELETE /api/lorebook/folder?path=...&lorebook=...` — delete folder (403 for presets)
- **Matching:** `findMatchingEntries(lorebook, text)` — returns enabled entries matching via keywords or regex, sorted by priority desc
- **Locations:** `listLocationEntries(lorebook)` — returns entries whose path starts with `locations/`, sorted by name. Used by the adventure system for the location dropdown.
- **Context-Aware Activation:** `findActiveEntries(lorebook, context)` — returns entries that should be active given the current context. Uses a fixed-point algorithm:
  - **`LorebookEntry.contexts`** — `string[]` field: entry paths (e.g. `locations/village-square`) or trait refs (e.g. `trait:warrior`). All must be satisfied for the entry to activate (AND logic). Empty = always context-eligible.
  - **`ActivationContext`** — `{ text, currentLocation, traits }` — recent chat text, current location path, and player traits
  - **Algorithm:** (1) Seed active set with current location entry. (2) Location entries (`locations/*`) are exclusive — only the current location is active; other locations never activate via keywords. (3) For each inactive non-location entry, check if all context gates are satisfied (paths in active set, traits in context). (4) If context-eligible, check keyword/regex match against text. (5) If matched, add to active set. (6) Repeat until no new activations (fixed point).
  - **Chained activation:** Current location → characters/items whose context is satisfied → more items whose context is now satisfied. Chains never end at a location entry.
  - **Player traits:** Stored in `ChatMeta.traits`. Referenced as `trait:<name>` in contexts. Managed via the active entries panel UI.
  - **UI:** Right-side panel in adventure play view shows active entries grouped by category + trait management (pills with add/remove).
  - **Key Quest example:** village-square (always eligible) → characters activate when at village-square + keyword match → iron-key activates when blacksmith is active → treasure-room activates when iron-key is active.
- **Integration:** Called by adventure system for location data and active lore context; future chat system will inject lore context into LLM prompts

### Context Activation — Improvement Ideas

1. **Context inheritance** — folders define default contexts for contained entries
2. **Negative contexts** — `!path` means active everywhere except that context
3. **Weighted contexts** — priority modifiers for soft activation
4. **Time-based contexts** — activate after N messages or at story beats
5. **Context visualization** — graph view of entry dependencies
6. **Auto-context suggestion** — suggest contexts based on keyword overlap
7. **Context groups** — named groups referenced as a unit
8. **Activation history** — show when entries became active/inactive

## Conventions

- After completing a unit of work, provide a commit message the user can use.
- **Commit messages** use semantic prefixes: `feat(topic):`, `fix(topic):`, `chore(topic):`, `refactor(topic):`, `test(topic):`, `docs(topic):`.
- API routes live under `/api/` and return **HTML fragments** (not JSON) for HTMX to swap in.
  - Exception: `GET /api/settings` returns JSON for programmatic access (API key masked).
- All user-supplied strings must be escaped with `escapeHtml()` before embedding in HTML responses.
- Static files are served from `src/public/`. Any unmatched path falls back to `index.html`.
- Default port is **3001** (override via `PORT` env var).
- The `data/` directory is gitignored and stores runtime data (settings, etc.).
- The `presets/` directory is checked into git and stores read-only built-in templates.
- **File size guideline:** Source files should target <500 lines. Prefer meaningful splits over forced ones — natural code groupings matter more than hitting a number.

## Progress Tracking

- **TODOS.md** contains the full feature roadmap organized into 10 phases (modeled after SillyTavern). After completing a feature, check off the corresponding item (`- [x]`). When starting a new phase, note it at the top of TODOS.md.
- **This file (CLAUDE.md)** is the living architecture doc. When adding new modules, API routes, data models, or conventions, update the relevant sections above. When a section becomes outdated (e.g. chat is no longer a placeholder), rewrite it to reflect reality.

### What to update and when

| Event | Update CLAUDE.md | Update TODOS.md |
|---|---|---|
| New source file added | Add to Project layout | — |
| New API route added | Add to the relevant module section | — |
| New data model / type | Document under its module section | — |
| Feature completed | Update module description to reflect new behavior | Check off (`- [x]`) the item |
| Phase started | — | Note current phase at top of file |
| Convention changed | Update Conventions section | — |
| New module created | Add a new top-level section | — |

### Current Status

- **Phase:** Phase 1 — Core Chat MVP in progress
- **Completed modules:** Lorebook (full CRUD + matching + templates + location listing + context-aware activation), Settings (persistence + validation), Chat (persistence + adventure-centric multi-conversation CRUD + location changes + player traits), Adventure system (picker + play view + location bar + active entries panel)
- **Next up:** Phase 1.1 — LLM streaming integration, Phase 1.3 — Character cards, Phase 1.4 — Prompt construction
