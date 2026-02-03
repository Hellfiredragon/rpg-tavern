# RPG Tavern

## Stack

- **Runtime:** Bun (not Node) — use Bun APIs (`Bun.serve`, `Bun.file`, etc.) instead of Node equivalents
- **Language:** TypeScript (strict mode)
- **Frontend:** React 18 + Vite + react-router-dom 7 — path-based SPA routing, JSON API
- **Styling:** Plain CSS (no preprocessor, no Tailwind)

## Commands

- `bun run dev` — start API server with file watching (port 3001)
- `bun run dev:client` — start Vite dev server (port 5173, proxies `/api` to 3001)
- `bun run build` — Vite production build to `dist/`
- `bun run start` — start production server (serves `dist/` + API on port 3001)
- `bun install` — install dependencies
- `bun test` — run all tests

**Dev workflow:** Two terminals — `bun run dev` + `bun run dev:client` — open `http://localhost:5173`.

**Production workflow:** `bun run build` then `bun run start` — open `http://localhost:3001`.

## Project layout

```
src/
  server.ts          # Entry point — Bun.serve(), static file serving, startup
  routes.ts          # API route handlers (all return JSON)
  chat.ts            # Chat persistence — types, JSONL read/write, CRUD
  settings.ts        # Settings persistence + validation
  lorebook.ts        # Lorebook system
  client/            # React frontend (built by Vite)
    index.html       # Vite entry point
    main.tsx         # React root — createRoot + BrowserRouter + App
    App.tsx          # Route definitions + Layout wrapper
    api.ts           # Typed fetch wrappers for all API endpoints
    types.ts         # TypeScript interfaces for API responses
    styles.css       # Base layout + utility CSS
    components.css   # Feature component CSS (adventure, lorebook, chat)
    components/
      Layout.tsx       # App shell — header, TabNav, Outlet
      TabNav.tsx       # Navigation tabs (Adventure, Lorebook, Settings)
      shared/
        Dialog.tsx     # Reusable <dialog> wrapper with showModal/close
      adventure/
        AdventurePicker.tsx    # Adventure/template card list
        AdventurePlay.tsx      # Chat + location bar + active entries
        ActiveEntriesPanel.tsx # Right sidebar — active lore entries + traits
      lorebook/
        LorebookPicker.tsx  # Lorebook card list (templates + adventures)
        LorebookEditor.tsx  # Two-column editor — tree + entry form
        TreeBrowser.tsx     # Recursive tree rendering with folder expand + HTML5 drag
        EntryForm.tsx       # Entry create/edit form with drop zone inputs
    pages/
      AdventurePage.tsx  # Adventure route — picker or play based on :slug
      LorebookPage.tsx   # Lorebook route — picker or editor based on :slug
      SettingsPage.tsx   # Settings form
vite.config.ts       # Vite config — React plugin, proxy, build output
tsconfig.json        # Server TypeScript config (excludes src/client)
tsconfig.client.json # Client TypeScript config (React JSX, DOM libs)
dist/                # Vite build output (gitignored)
presets/
  lorebooks/         # Built-in read-only template lorebooks (checked into git)
    default/
    template-key-quest/
```

## UI

- **Layout:** Single-page app using 90% of the page width (max 1400px), with a tab bar at the top
- **Tabs:** Adventure | Lorebook | Settings — `<NavLink>` components with active class
- **Dialogs:** "+ New" (entry/folder), "+ Template", "Save as Template", and adventure start/delete use `<Dialog>` component wrapping `<dialog>` with `showModal()`/`close()` via ref + useEffect
- **Components:** Functional components with hooks (`useState`, `useEffect`, `useParams`, `useNavigate`)

## Routing

Path-based client-side routing via react-router-dom. Browser back/forward buttons work, and URLs are shareable/bookmarkable.

### URL scheme

| Path | View |
|------|------|
| `/` | Redirects to `/adventure` |
| `/adventure` | Adventure tab, picker |
| `/adventure/:slug` | Adventure tab, playing that adventure (resumed via `/api/adventures/resume`) |
| `/lorebook` | Lorebook tab, picker |
| `/lorebook/:slug` | Lorebook tab, editing that lorebook (restored via `/api/lorebooks/meta`) |
| `/settings` | Settings tab |

### Implementation

- `App.tsx` defines all `<Route>` elements inside a `<Layout>` wrapper
- `Layout.tsx` renders header + `<TabNav>` + `<Outlet>`
- Page components read `useParams().slug` to determine picker vs detail view
- Navigation uses `useNavigate()` for programmatic routing
- Server returns `index.html` for all non-API, non-asset paths (SPA fallback)

## Adventure System

The Chat tab has been redesigned into an **Adventure** tab. Users pick an adventure (lorebook), enter a play view with a location bar and chat. Locations come from the lorebook's `locations/` folder.

### Chat module (`src/chat.ts`)

- **Types:**
  - `ChatMeta` — `{ id, title, createdAt, updatedAt, lorebook, currentLocation, traits, summonedCharacters }` (summonedCharacters is deprecated — character location now tracked on entries)
  - `ChatMessage` — `{ role: "user"|"assistant"|"system", content, timestamp }`
  - System messages are narration (e.g. location transitions), rendered centered/italic
- **Storage:** `data/chats/<id>.jsonl` — one file per conversation in JSONL format
  - Line 1: `ChatMeta`
  - Lines 2+: `ChatMessage`
  - ID format: `<timestamp>-<3-char-hex>` (e.g. `1738262400000-a3f`)
  - Title: auto-set from first user message, truncated to 50 chars
  - Old JSONL files missing `lorebook`/`currentLocation`/`traits`/`summonedCharacters` default to `""`/`""`/`[]`/`[]` on load
- **Functions:** `generateChatId()`, `createConversation(opts?)`, `listConversations(lorebook?)`, `loadConversation()`, `appendMessage()`, `deleteConversation()`, `changeLocation()`, `updateTraits()`
  - `createConversation` accepts `{ id?, lorebook?, currentLocation?, traits?, summonedCharacters? }`
  - `listConversations` accepts optional lorebook filter
  - `changeLocation(id, locationPath, narration)` — updates meta.currentLocation, clears summonedCharacters, appends system message atomically
  - `updateTraits(id, traits)` — rewrites meta line with updated traits array

### Adventure UI

- **Picker** (`AdventurePicker`): Shows adventure cards with Continue/Save as Template/Delete buttons + template cards with Start button
- **Play** (`AdventurePlay`): Location bar (back button, adventure name, location dropdown, Play/Edit toggle) + chat messages + input + active entries panel (right sidebar). Edit mode renders `LorebookEditor` inline for direct lorebook editing during play.
- **Template start flow:** Dialog to name the copy → `POST /api/lorebooks/copy` → `POST /api/chats` → navigate to `/adventure/:slug`
- **Save as Template flow:** Dialog to name the template → `POST /api/lorebooks/make-template` → refreshes picker
- **Location change:** Dropdown change → `PUT /api/adventures/location` → system narration message appended to chat

### API routes

All routes return JSON. Error responses use `{ error: "message" }` with appropriate status codes.

- `GET /api/adventures` → `{ adventures: [{slug, name, latestChatId, currentLocation, locationName, updatedAt}], templates: [{slug, name, preset}] }`
- `DELETE /api/adventures?lorebook=` → `{ ok: true }`
- `GET /api/adventures/resume?lorebook=` → `{ lorebook, chatId, name, location }` (404 if none)
- `GET /api/adventures/locations?lorebook=` → `[{ path, name }]`
- `PUT /api/adventures/location` — JSON `{ chatId, location }` → `{ location, narration }`
- `GET /api/adventures/active-entries?chatId=` → `{ traits, entries }`
- `PUT /api/adventures/traits` — JSON `{ chatId, traits }` → `{ traits, entries }`
- `PUT /api/adventures/goal` — JSON `{ lorebook, path, completed, chatId? }` → `{ traits, entries }` or `{ ok: true }`
- `GET /api/chats?lorebook=` → `ChatMeta[]`
- `POST /api/chats` — JSON `{ lorebook?, location? }` → `{ chatId }`
- `GET /api/chats/messages?id=` → `{ meta, messages }`
- `POST /api/chat` — JSON `{ message, chatId?, lorebook? }` → `{ chatId, messages, location, isNew }`
- **Location detection (dummy LLM):** `POST /api/chat` parses movement intent from user messages (e.g. "go to X", "enter X", "walk to X"). If a destination is detected and a lorebook is attached:
  - Matches against existing location entries (case-insensitive, partial matching)
  - If no match, creates a new lorebook entry under `locations/<slugified-name>.json` with a generated description
  - Calls `changeLocation()` to update the conversation, clear summoned characters, and append system narration
  - Returns `{ chatId, messages: [user, system, assistant], location, isNew }`
- **Summon detection (dummy LLM):** `POST /api/chat` also parses summon intent (e.g. "call Marta", "summon the blacksmith"). If detected and a lorebook + current location exist:
  - Matches character name against character entries (name + keywords, case-insensitive)
  - Updates the character entry's `currentLocation` field to the player's current location via `saveEntry()`
  - Appends system narration about the character arriving
  - If character not found, falls through to normal response
- **Current behavior:** When no location/summon is detected, assistant responds with "Hello World" (placeholder for future LLM integration). When a location change is detected, assistant responds with "You arrive at \<location\>." When a summon is detected, assistant responds with "\<character\> has joined you."

## Settings

- **Module:** `src/settings.ts` — `Settings` type, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings()`, `validateSettings()`
- **Persistence:** `data/settings.json` (project root) — created on first save, gitignored (contains API keys)
- **UI:** `SettingsPage.tsx` — controlled form with feedback messages
- **API routes:**
  - `GET /api/settings` → Settings JSON (API key masked)
  - `PUT /api/settings` → `{ ok: true, settings }` or `{ error }` on 400

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
        goals/
          find-key.json
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
  - **Key Quest template** (`template-key-quest`): A story where the player asks three NPCs who has the key and where to open a locked room to get the treasure. Contains 8 entries (3 characters, 1 item, 3 locations, 1 goal).
- **Templates:** Lorebooks with `"template": true` in metadata. Shown as cards in the Lorebook tab picker with Edit buttons, plus a "+ Template" button. User-created templates also get a Delete button.
- **Migration:** On startup, `migrateOrphanLorebooks()` converts non-template, non-preset lorebooks with no conversations into templates.
- **All CRUD functions** take `lorebook: string` as their first argument (the lorebook slug)
- **Functions:** `saveLorebookMeta(slug, meta)` — writes updated `_lorebook.json` for an existing lorebook
- **UI:** Lorebook tab — two-step layout showing templates only:
  - **Picker** (`LorebookPicker`): Card-based list of templates. User templates get Edit + Delete buttons. Preset templates get View + Copy buttons. Includes "+ Template" button.
  - **Editor** (`LorebookEditor`): Two-column grid — `TreeBrowser` sidebar + `EntryForm` editor. Manages selected entry path, new entry/folder dialogs. Also used inline in adventure play view (Edit mode).
- **API routes:**
  - Lorebook management (under `/api/lorebooks`):
    - `GET /api/lorebooks` → `{ templates: [{slug, name, preset}] }` (templates only, no adventures)
    - `GET /api/lorebooks/meta?slug=` → `{ slug, name, template, preset }` (404 if not found)
    - `POST /api/lorebooks` — JSON `{ slug, name }` → `{ ok: true }`
    - `POST /api/lorebooks/copy` — JSON `{ source, slug, name }` → `{ ok: true }`
    - `POST /api/lorebooks/make-template` — JSON `{ source, slug, name }` → `{ ok: true }`
    - `DELETE /api/lorebooks?slug=...` → `{ ok: true }` (403 for presets)
  - Lorebook entries (under `/api/lorebook/`, use `?path=` and `?lorebook=` query params):
    - `GET /api/lorebook/tree?lorebook=` → `{ nodes: TreeNode[], readonly }`
    - `GET /api/lorebook/entry?path=&lorebook=` → `{ path, entry, isNew, readonly }`
    - `POST /api/lorebook/entry?path=&lorebook=` → `{ ok: true, entry }`
    - `PUT /api/lorebook/entry?path=&lorebook=` → `{ ok: true, entry }`
    - `DELETE /api/lorebook/entry?path=&lorebook=` → `{ ok: true }`
    - `POST /api/lorebook/folder?lorebook=` — JSON `{ path }` → `{ ok: true }`
    - `DELETE /api/lorebook/folder?path=&lorebook=` → `{ ok: true }`
    - `PUT /api/lorebook/entry/move?lorebook=` — JSON `{ path, destination }` → `{ ok: true, newPath }`
- **Drag & Drop:** HTML5 native `draggable` on tree entry links. Two drop target types: (1) tree folders/root — moves the entry via `PUT /api/lorebook/entry/move`, (2) form fields (`homeLocation`, `characters`) — sets/appends the dragged path as the field value. Uses `application/lorebook-path` custom MIME type in `dataTransfer`. A `useRef` tracks the currently-dragged path for `dragOver` validation (since `getData()` is unavailable during `dragover`). Read-only preset lorebooks disable dragging. Entry paths are displayed below names in the tree.
- **Matching:** `findMatchingEntries(lorebook, text)` — returns enabled entries matching via keywords or regex, sorted by priority desc
- **Locations:** `listLocationEntries(lorebook)` — returns entries whose path starts with `locations/`, sorted by name. Used by the adventure system for the location dropdown.
- **Entry types:** `getEntryType(path)` returns `"character" | "location" | "item" | "goal" | "other"` based on folder prefix. The base `LorebookEntry` has optional type-specific fields:
  - **Location-specific** (`locations/*`):
    - **`characters`** — `string[]`: character paths that can appear here (template hint for the `characters` list)
  - **Character-specific** (`characters/*`):
    - **`homeLocation`** — `string`: starting location path
    - **`currentLocation`** — `string`: where the character is NOW (dynamic in adventures, falls back to homeLocation)
    - **`state`** — `string[]`: status tags, e.g. `["friendly", "injured", "has-given-key"]`
    - **`goals`** — `string[]`: refs to goal entry paths, e.g. `["goals/find-key"]`
  - **Item-specific** (`items/*`):
    - **`location`** — `string`: where the item is (location path, character path, or `"player"`)
  - **Goal-specific** (`goals/*`):
    - **`requirements`** — `string[]`: freeform descriptions for LLM context
    - **`completed`** — `boolean`: whether the goal is done (default false)
  - **All entries:**
    - **`contexts`** — `string[]`: entry paths or `trait:` refs. AND logic. Empty = always context-eligible. Used for "other" entries via fixed-point iteration.
- **Context-Aware Activation:** `findActiveEntries(lorebook, context)` — returns entries that should be active given the current context:
  - **`ActivationContext`** — `{ text, currentLocation, traits }` — recent chat text, current location path, player traits
  - **`ActiveEntry`** — includes type-specific fields: `state`, `currentLocation`, `location`, `completed`, `requirements`
  - **Algorithm:**
    1. **Seed:** current location entry is always active
    2. **Characters:** activate if `entry.currentLocation === playerLocation` (fall back to `homeLocation` if `currentLocation` is unset)
    3. **Items:** activate if `entry.location === playerLocation` OR `entry.location === "player"` OR `entry.location` matches an active character path
    4. **Goals:** activate if `!completed` (incomplete goals are always shown)
    5. **Other entries:** keyword/regex/context matching (fixed-point iteration)
    6. Re-check items after fixed-point (new active characters may have items)
    7. Location entries are exclusive — only the current location is active
  - **Character summoning:** Detected via `POST /api/chat` summon patterns ("call X", "summon X"). Instead of ChatMeta tracking, the character entry's `currentLocation` is updated via `saveEntry()`.
  - **Chained activation:** Location → characters at that location → items held by active characters → goals (always). Chains never end at a location entry.
  - **Player traits:** Stored in `ChatMeta.traits`. Referenced as `trait:<name>` in contexts. Managed via the active entries panel UI.
  - **Goal system:** Goals in `goals/` folder. Incomplete goals always appear in active entries. Completion toggled via `PUT /api/adventures/goal`. Completed goals disappear from active list.
  - **UI:** `ActiveEntriesPanel` — right-side panel in adventure play view shows active entries grouped by category (locations, characters, items, goals) + trait management. Goals have completion checkboxes. Characters show state tags and current location. Items show their location.
  - **EntryForm** — type-specific fields: characters get homeLocation/currentLocation/state/goals drop zones; locations get characters drop zone; items get location drop zone; goals get requirements input + completed checkbox.
  - **Key Quest example:** village-square has 3 characters. All characters have `currentLocation: locations/village-square`. iron-key has `location: characters/blacksmith`. find-key goal has requirements and `completed: false`.
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
- API routes live under `/api/` and return **JSON** (not HTML). All responses use `Response.json()`.
- Static files are served from `dist/` in production (Vite build output). In dev mode, Vite serves the frontend.
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
- **Completed modules:** Lorebook (full CRUD + matching + templates + location listing + context-aware activation + character–location relationships), Settings (persistence + validation), Chat (persistence + adventure-centric multi-conversation CRUD + location changes + player traits + summoned characters), Adventure system (picker + play view + location bar + active entries panel + summon detection)
- **Frontend:** Converted from HTMX + vanilla JS to React 18 + Vite + react-router-dom 7
- **Next up:** Phase 1.1 — LLM streaming integration, Phase 1.3 — Character cards, Phase 1.4 — Prompt construction
