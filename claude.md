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
  public/          # Static assets served by the backend
    index.html     # Tabbed SPA (Chat, Lorebook, Settings)
    lorebook.html  # Standalone lorebook page
    settings.html  # Standalone settings page
    styles.css
```

## UI

- **Layout:** Single-page app using 90% of the page width (max 1400px), with a tab bar at the top
- **Tabs:** Chat | Lorebook | Settings — switching tabs shows/hides panels client-side
- **Dialogs:** Both "+ New" (entry/folder) and "+ Lorebook" use `<dialog>` elements with consistent styling
- Standalone pages (`/lorebook.html`, `/settings.html`) also exist and share the same CSS

## Chat

- **UI:** Message list with user/assistant bubbles, text input + send button
- **API route:** `POST /api/chat` — accepts JSON `{ message }`, returns HTML fragment with assistant response
- **Current behavior:** Always responds with "Hello World" (placeholder for future LLM integration)

## Settings

- **Module:** `src/settings.ts` — `Settings` type, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings()`
- **Persistence:** `data/settings.json` (project root) — created on first save, gitignored (contains API keys)
- **UI:** Settings tab in index.html, also standalone at `/settings.html`
- **API routes:**
  - `GET /api/settings` — returns JSON (API key masked)
  - `GET /api/settings/form` — returns pre-filled HTML form fragment
  - `PUT /api/settings` — validates & saves, returns HTML feedback + updated form

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
        _lorebook.json       # { "name": "Default Lorebook" }
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
- **Templates:** Lorebooks with `"template": true` in metadata. Shown in a separate dropdown in the UI. Users click "Use Template" to copy a template into a new user lorebook. Built-in templates are seeded at startup via `seedTemplates()`.
  - **Key Quest template** (`template-key-quest`): A story where the player asks three NPCs who has the key and where to open a locked room to get the treasure. Contains 7 entries (3 characters, 1 item, 3 locations).
- **Migration:** On startup, `ensureDefaultLorebook()` migrates legacy flat files into a `default/` subdirectory
- **All CRUD functions** take `lorebook: string` as their first argument (the lorebook slug)
- **UI:** Lorebook tab in index.html (also standalone at `/lorebook.html`) — two-panel layout with lorebook selector dropdown, template selector dropdown, tree browser with per-folder "+ New" buttons, and entry editor. Both "+ Lorebook" and "Use Template" use `<dialog>` elements.
- **API routes:**
  - Lorebook management (under `/api/lorebooks`):
    - `GET /api/lorebooks` — returns lorebook selector HTML (user lorebooks dropdown + "+ Lorebook" button, template dropdown + "Use Template" button)
    - `POST /api/lorebooks` — create lorebook (JSON `{ slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `POST /api/lorebooks/copy` — copy a lorebook (JSON `{ source, slug, name }`) → `HX-Trigger: refreshLorebooks`
    - `DELETE /api/lorebooks?slug=...` — delete lorebook (rejects `default`) → `HX-Trigger: refreshLorebooks`
  - Lorebook entries (under `/api/lorebook/`, use `?path=` and `?lorebook=` query params):
    - `GET /api/lorebook/tree?lorebook=...` — returns tree HTML fragment with per-folder "+ New" buttons
    - `GET /api/lorebook/entry?path=...&lorebook=...` — returns entry editor form
    - `POST /api/lorebook/entry?path=...&lorebook=...` — create entry (JSON body, returns HTML)
    - `PUT /api/lorebook/entry?path=...&lorebook=...` — update entry (JSON body, returns HTML)
    - `DELETE /api/lorebook/entry?path=...&lorebook=...` — delete entry
    - `POST /api/lorebook/folder?lorebook=...` — create folder (form data with `path`)
    - `DELETE /api/lorebook/folder?path=...&lorebook=...` — delete folder
- **Matching:** `findMatchingEntries(lorebook, text)` — returns enabled entries matching via keywords or regex, sorted by priority desc
- **Integration:** Called by future chat system to inject lore context into LLM prompts

## Conventions

- API routes live under `/api/` and return **HTML fragments** (not JSON) for HTMX to swap in.
  - Exception: `GET /api/settings` returns JSON for programmatic access (API key masked).
- All user-supplied strings must be escaped with `escapeHtml()` before embedding in HTML responses.
- Static files are served from `src/public/`. Any unmatched path falls back to `index.html`.
- Default port is **3001** (override via `PORT` env var).
- The `data/` directory is gitignored and stores runtime data (settings, etc.).
