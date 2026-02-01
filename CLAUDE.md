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
  server.ts        # Entry point — Bun.serve(), routing, API handlers
  chat.ts          # Chat persistence — types, JSONL read/write, CRUD
  settings.ts      # Settings persistence
  lorebook.ts      # Lorebook system
  public/          # Static assets served by the backend
    index.html     # Tabbed SPA (Chat, Lorebook, Settings)
    lorebook.html  # Standalone lorebook page
    settings.html  # Standalone settings page
    styles.css
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
  - `ChatMeta` — `{ id, title, createdAt, updatedAt, lorebook, currentLocation }`
  - `ChatMessage` — `{ role: "user"|"assistant"|"system", content, timestamp }`
  - System messages are narration (e.g. location transitions), rendered centered/italic
- **Storage:** `data/chats/<id>.jsonl` — one file per conversation in JSONL format
  - Line 1: `ChatMeta`
  - Lines 2+: `ChatMessage`
  - ID format: `<timestamp>-<3-char-hex>` (e.g. `1738262400000-a3f`)
  - Title: auto-set from first user message, truncated to 50 chars
  - Old JSONL files missing `lorebook`/`currentLocation` default to `""` on load
- **Functions:** `generateChatId()`, `createConversation(opts?)`, `listConversations(lorebook?)`, `loadConversation()`, `appendMessage()`, `deleteConversation()`, `changeLocation()`
  - `createConversation` accepts `{ id?, lorebook?, currentLocation? }`
  - `listConversations` accepts optional lorebook filter
  - `changeLocation(id, locationPath, narration)` — updates meta.currentLocation + appends system message atomically

### Adventure UI

- **Picker state** (`#adventure-picker`): Shows adventure cards with Continue/Save as Template/Delete buttons + template cards with Start button
- **Play state** (`#adventure-play`): Location bar (back button, adventure name, location dropdown) + chat messages + input
- **Template start flow:** Dialog to name the copy → `POST /api/lorebooks/copy` → `POST /api/chats` → enter play view
- **Save as Template flow:** Dialog to name the template → `POST /api/lorebooks/make-template` → refreshes lorebook selector
- **Location change:** Dropdown change → `PUT /api/adventures/location` → system narration message appended to chat

### API routes

- `GET /api/adventures` — returns adventure picker HTML (user lorebooks + templates)
- `GET /api/adventures/resume?lorebook=` — returns JSON `{ lorebook, chatId, name, location }` for the latest conversation of a lorebook (404 if none). Used by the router to restore adventure play from a URL.
- `GET /api/adventures/locations?lorebook=` — returns `<option>` elements for the location dropdown
- `PUT /api/adventures/location` — JSON `{ chatId, location }` → loads location entry, appends narration, returns narration HTML + `X-Location` header
- `GET /api/chats?lorebook=` — returns chat list HTML, optional lorebook filter
- `POST /api/chats` — JSON `{ lorebook?, location? }` → create conversation bound to lorebook → `X-Chat-Id` header
- `GET /api/chats/messages?id=` — load conversation messages as HTML (supports system messages)
- `POST /api/chat` — JSON `{ message, chatId?, lorebook? }` → auto-creates conversation with lorebook if no chatId
- **Current behavior:** Assistant always responds with "Hello World" (placeholder for future LLM integration)

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

- **Template** = lorebook with `template: true`. Shown and editable in the **Lorebook tab**.
- **Adventure** = non-template lorebook + conversations. Shown and playable in the **Adventure tab**.
- Every non-template lorebook is an adventure (1:1). No orphan non-template lorebooks.
- Adventures are created by copying a template (which creates a new non-template lorebook + conversation).
- Adventures can be saved back as templates ("Save as Template" button in the adventure picker).
- On startup, `migrateOrphanLorebooks()` converts any non-template lorebook with zero conversations into a template.

## Lorebook

- **Module:** `src/lorebook.ts` — `LorebookEntry` type, `LorebookMeta` type, tree scanning, CRUD, matching engine, lorebook management, templates
- **Storage:** `data/lorebooks/<lorebook-slug>/` — each top-level directory is one lorebook. Inside each lorebook:
  - `_lorebook.json` — metadata file with `{ "name": "Display Name", "template"?: true }`
  - Nested JSON files — each `.json` file (except `_lorebook.json`) is one entry
  - Directories organize entries into categories
  - Example layout:
    ```
    data/lorebooks/
      default/
        _lorebook.json       # { "name": "Default Lorebook", "template": true }
        people/
          gabrielle.json
        locations/
          tavern.json
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
- **Templates:** Lorebooks with `"template": true` in metadata. Shown as cards in the Lorebook tab picker with Edit and Delete buttons, plus a "+ Template" button. Built-in templates are seeded at startup via `seedTemplates()`.
  - **Key Quest template** (`template-key-quest`): A story where the player asks three NPCs who has the key and where to open a locked room to get the treasure. Contains 7 entries (3 characters, 1 item, 3 locations).
- **Migration:** On startup, `ensureDefaultLorebook()` migrates legacy flat files into a `default/` subdirectory (as a template). `migrateOrphanLorebooks()` converts non-template lorebooks with no conversations into templates.
- **All CRUD functions** take `lorebook: string` as their first argument (the lorebook slug)
- **Functions:** `saveLorebookMeta(slug, meta)` — writes updated `_lorebook.json` for an existing lorebook
- **UI:** Lorebook tab in index.html (also standalone at `/lorebook.html`) — two-step layout mirroring the Adventure tab:
  - **Picker** (`#lorebook-picker`): Card-based list of lorebooks. Adventures (non-template) get an Edit button. Templates get Edit + Delete buttons. Includes "+ Template" button.
  - **Editor** (`#lorebook-edit`): Header bar (back button + lorebook name) + tree browser with per-folder "+ New" buttons + entry editor panel.
- **API routes:**
  - Lorebook management (under `/api/lorebooks`):
    - `GET /api/lorebooks` — returns lorebook picker HTML (card-based list + "+ Template" button)
    - `GET /api/lorebooks/meta?slug=` — returns JSON `{ slug, name, template }` for a lorebook (404 if not found). Used by router to restore lorebook editor from URL.
    - `POST /api/lorebooks` — create template (JSON `{ slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `POST /api/lorebooks/copy` — copy a lorebook as non-template (JSON `{ source, slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `POST /api/lorebooks/make-template` — copy a lorebook as template (JSON `{ source, slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `DELETE /api/lorebooks?slug=...` — delete any lorebook → `HX-Trigger: refreshLorebooks`
  - Lorebook entries (under `/api/lorebook/`, use `?path=` and `?lorebook=` query params):
    - `GET /api/lorebook/tree?lorebook=...` — returns tree HTML fragment with per-folder "+ New" buttons
    - `GET /api/lorebook/entry?path=...&lorebook=...` — returns entry editor form
    - `POST /api/lorebook/entry?path=...&lorebook=...` — create entry (JSON body, returns HTML)
    - `PUT /api/lorebook/entry?path=...&lorebook=...` — update entry (JSON body, returns HTML)
    - `DELETE /api/lorebook/entry?path=...&lorebook=...` — delete entry
    - `POST /api/lorebook/folder?lorebook=...` — create folder (form data with `path`)
    - `DELETE /api/lorebook/folder?path=...&lorebook=...` — delete folder
- **Matching:** `findMatchingEntries(lorebook, text)` — returns enabled entries matching via keywords or regex, sorted by priority desc
- **Locations:** `listLocationEntries(lorebook)` — returns entries whose path starts with `locations/`, sorted by name. Used by the adventure system for the location dropdown.
- **Integration:** Called by adventure system for location data; future chat system will inject lore context into LLM prompts

## Conventions

- After completing a unit of work, provide a commit message the user can use.
- API routes live under `/api/` and return **HTML fragments** (not JSON) for HTMX to swap in.
  - Exception: `GET /api/settings` returns JSON for programmatic access (API key masked).
- All user-supplied strings must be escaped with `escapeHtml()` before embedding in HTML responses.
- Static files are served from `src/public/`. Any unmatched path falls back to `index.html`.
- Default port is **3001** (override via `PORT` env var).
- The `data/` directory is gitignored and stores runtime data (settings, etc.).

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
- **Completed modules:** Lorebook (full CRUD + matching + templates + location listing), Settings (persistence + validation), Chat (persistence + adventure-centric multi-conversation CRUD + location changes), Adventure system (picker + play view + location bar)
- **Next up:** Phase 1.1 — LLM streaming integration, Phase 1.3 — Character cards, Phase 1.4 — Prompt construction
