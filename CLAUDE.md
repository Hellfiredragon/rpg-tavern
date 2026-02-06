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
  server.ts          # Entry point — Bun.serve(), static file serving, startup migrations
  routes.ts          # API route handlers (all return JSON), SSE pipeline integration
  chat.ts            # Chat persistence — types, JSONL read/write, CRUD, message deletion
  settings.ts        # Settings persistence + validation + backend/pipeline config
  lorebook.ts        # Lorebook system
  backends.ts        # LLM backend abstraction — types, Semaphore, registry, factory
  backend-kobold.ts  # KoboldCpp text completion implementation
  backend-openai.ts  # OpenAI-compatible chat completion implementation
  events.ts          # EventBus for pipeline events, active pipeline registry
  pipeline.ts        # Multi-step pipeline executor, prompt construction for narrator/character
  extractor.ts       # Extractor tool definitions, tool execution, git-backed lorebook mutations
  git.ts             # isomorphic-git wrapper — init, commit, revert for lorebook versioning
  client/            # React frontend (built by Vite)
    index.html       # Vite entry point
    main.tsx         # React root — createRoot + BrowserRouter + App
    App.tsx          # Route definitions + Layout wrapper
    api.ts           # Typed fetch wrappers for all API endpoints
    types.ts         # TypeScript interfaces for API responses + pipeline events
    styles.css       # Base layout + utility CSS
    components.css   # Feature component CSS (adventure, lorebook, chat, pipeline)
    hooks/
      useSSE.ts        # SSE stream reader for pipeline events
    components/
      Layout.tsx       # App shell — header, gear icon, Outlet
      shared/
        Dialog.tsx     # Reusable <dialog> wrapper with showModal/close
      adventure/
        AdventurePicker.tsx     # Unified adventure + template card list
        AdventurePlay.tsx       # Chat + SSE streaming + source badges + msg delete
        TemplateView.tsx        # Template detail — location bar + LorebookEditor
        ActiveEntriesPanel.tsx  # Right sidebar — active lore entries + traits
        ExtractorIndicator.tsx  # Spinner shown when extractor is running
      lorebook/
        LorebookEditor.tsx  # Two-column editor — tree + entry form
        TreeBrowser.tsx     # Recursive tree rendering with folder expand + HTML5 drag
        EntryForm.tsx       # Entry create/edit form with drop zone inputs
    pages/
      AdventurePage.tsx  # Unified route — picker, adventure play, or template view
      SettingsPage.tsx   # Settings form + backend config + pipeline config
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

- **Layout:** Single-page app using 90% of the page width (max 1400px), with a header containing the app title and a gear icon link to settings
- **Navigation:** No tabs. Adventures are the sole main view. Settings accessed via gear icon in header (shows back arrow when on settings page).
- **Dialogs:** "+ New" (entry/folder), "+ Template", "Copy Template", "Save as Template", and adventure start/delete use `<Dialog>` component wrapping `<dialog>` with `showModal()`/`close()` via ref + useEffect
- **Components:** Functional components with hooks (`useState`, `useEffect`, `useParams`, `useNavigate`)

## Routing

Path-based client-side routing via react-router-dom. Browser back/forward buttons work, and URLs are shareable/bookmarkable.

### URL scheme

| Path | View |
|------|------|
| `/` | Redirects to `/adventure` |
| `/adventure` | Unified picker (adventures + templates) |
| `/adventure/:slug` | Detail view — auto-detects adventure vs template |
| `/adventure/:slug/*` | Detail view with deep-linked entry in editor |
| `/adventure/:slug/settings` | Settings page (preserves adventure context) |
| `/settings` | Settings page (global, from picker) |

### Implementation

- `App.tsx` defines all `<Route>` elements inside a `<Layout>` wrapper
- `Layout.tsx` renders header + gear icon + `<Outlet>` (no tabs)
- `AdventurePage` reads `useParams().slug` and fetches lorebook meta to determine mode: picker (no slug), adventure (non-template), or template (template=true)
- Navigation uses `useNavigate()` for programmatic routing
- Server returns `index.html` for all non-API, non-asset paths (SPA fallback)

## Adventure System

The Chat tab has been redesigned into an **Adventure** tab. Users pick an adventure (lorebook), enter a play view with a location bar and chat. Locations come from the lorebook's `locations/` folder.

### Chat module (`src/chat.ts`)

- **Types:**
  - `ChatMeta` — `{ id, title, createdAt, updatedAt, lorebook, currentLocation, traits, summonedCharacters }` (summonedCharacters is deprecated — character location now tracked on entries)
  - `ChatMessage` — `{ id?, role: "user"|"assistant"|"system", source?: "narrator"|"character"|"extractor"|"system", content, timestamp, commits?: string[] }`
    - `id` — unique message ID (`msg-<timestamp>-<3hex>`). Legacy messages without IDs get `msg-legacy-<lineIndex>` on load.
    - `source` — which pipeline step generated the message. Used for source badges in the UI.
    - `commits` — git SHAs from extractor lorebook mutations. Used for revert-on-delete.
  - System messages are narration (e.g. location transitions), rendered centered/italic
- **Storage:** `data/chats/<id>.jsonl` — one file per conversation in JSONL format
  - Line 1: `ChatMeta`
  - Lines 2+: `ChatMessage`
  - ID format: `<timestamp>-<3-char-hex>` (e.g. `1738262400000-a3f`)
  - Title: auto-set from first user message, truncated to 50 chars
  - Old JSONL files missing `lorebook`/`currentLocation`/`traits`/`summonedCharacters` default to `""`/`""`/`[]`/`[]` on load
- **Functions:** `generateChatId()`, `generateMessageId()`, `createConversation(opts?)`, `listConversations(lorebook?)`, `loadConversation()`, `appendMessage()`, `deleteConversation()`, `deleteMessage()`, `changeLocation()`, `updateTraits()`
  - `createConversation` accepts `{ id?, lorebook?, currentLocation?, traits?, summonedCharacters? }`
  - `listConversations` accepts optional lorebook filter
  - `changeLocation(id, locationPath, narration)` — updates meta.currentLocation, clears summonedCharacters, appends system message atomically
  - `updateTraits(id, traits)` — rewrites meta line with updated traits array

### Adventure UI

- **Picker** (`AdventurePicker`): Unified view showing adventure cards (Continue/Save as Template/Delete) + template cards (Start/View or Edit/Copy or Delete). Includes "+ Template" button for creating new templates.
- **Play** (`AdventurePlay`): Location bar (back button, adventure name, location dropdown, Play/Edit toggle) + character dialog partners bar (shows active characters at current location) + chat messages + input + active entries panel (right sidebar). Edit mode renders `LorebookEditor` inline (hideHeader) with deep-linked entry path support.
- **Template View** (`TemplateView`): Location bar (back button, template name, Start Adventure button) + `LorebookEditor` inline. Used for viewing/editing templates from the adventure URL.
- **Template start flow:** Dialog to name the copy → `POST /api/lorebooks/copy` → `POST /api/chats` → navigate to `/adventure/:slug`
- **Save as Template flow:** Dialog to name the template → `POST /api/lorebooks/make-template` → refreshes picker
- **New Template flow:** Dialog to name → `POST /api/lorebooks` → navigate to `/adventure/:slug` (template view)
- **Copy Template flow:** Dialog to name → `POST /api/lorebooks/make-template` → navigate to `/adventure/:slug`
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
- `POST /api/chat` — JSON `{ message, chatId?, lorebook?, stream? }` → SSE stream (if `stream: true`) or JSON `{ chatId, messages, location, isNew }`
- `DELETE /api/chats/message?chatId=&messageId=` → `{ ok: true }` — deletes message and reverts any associated git commits
- `POST /api/chat/cancel` — JSON `{ chatId }` → `{ ok: true }` — cancels in-flight pipeline generation
- **LLM Pipeline (when backends configured):** `POST /api/chat` with `stream: true` returns an SSE stream with events:
  - `step_start` — pipeline step beginning (narrator/character/extractor)
  - `step_token` — streaming token from current step
  - `step_complete` — step finished with final message
  - `extractor_background` — extractor running asynchronously (started/completed/failed)
  - `extractor_tool_call` — extractor executing a lorebook mutation tool
  - `pipeline_complete` — all steps done, includes final messages and location
  - `pipeline_error` — error in pipeline step (includes `category` for classified errors: auth/rate_limit/server/network)
  - `pipeline_cancelled` — pipeline was cancelled via abort/stop button
- **Dummy LLM fallback (no backends):** When no backends are configured, falls back to regex-based dummy responses:
  - Location detection: parses movement intent ("go to X", "enter X"), resolves/creates location entries
  - Summon detection: parses summon intent ("call X", "summon X"), updates character locations
  - Default response: "Hello World" placeholder

## Settings

- **Module:** `src/settings.ts` — `Settings` type, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings()`, `validateSettings()`
- **Settings type:** `{ general: { appName, temperature }, llm (legacy), backends: BackendConfig[], pipeline: PipelineConfig }`
- **BackendConfig:** `{ id, name, type: "koboldcpp"|"openai", url, apiKey, model, streaming, maxConcurrent }`
- **PipelineConfig:** `{ steps: [{ role: "narrator"|"character"|"extractor", backendId, enabled }] }`
- **Persistence:** `data/settings.json` (project root) — created on first save, gitignored (contains API keys)
- **Migration:** Old settings without `backends`/`pipeline` get defaults. If `backends` empty but `llm.apiKey` set, auto-migrates to one OpenAI backend. Temperature migrated from `llm.temperature` to `general.temperature`.
- **UI:** `SettingsPage.tsx` — General settings (app name + temperature), Backends list (add/remove/configure), Pipeline step assignment with descriptions. Legacy LLM section removed from UI (kept in data model for backward compat).
- **Adventure-scoped URL:** When on an adventure, gear icon links to `/adventure/:slug/settings`; back returns to the adventure. Global settings at `/settings`.
- **API routes:**
  - `GET /api/settings` → Settings JSON (API keys masked with `••••••••`)
  - `PUT /api/settings` → `{ ok: true, settings }` or `{ error }` on 400 — preserves real API keys when masked placeholder is sent, re-initializes backends

## LLM Pipeline

Multi-step pipeline: **Narrator** (story continuation) → **Character** (in-character dialog) → **Extractor** (tool-based lore extraction).

### Backend Abstraction (`src/backends.ts`)

- **Types:** `BackendConfig`, `CompletionRequest` (with `signal?: AbortSignal`), `CompletionResponse`, `LLMBackend` interface
- **Error classification:** `LLMError` class with `category` field (`auth | rate_limit | server | network | unknown`), `classifyHTTPError()` helper. Both backends wrap fetch in try/catch for network errors and classify HTTP status codes.
- **Semaphore:** Queue-based concurrency limiter per backend (`maxConcurrent` slots)
- **Registry:** `initBackendsFromConfig()`, `getBackend(id)`, `getSemaphore(id)`, `listBackendIds()`
- **Implementations:**
  - `backend-kobold.ts` — KoboldCpp text completion. Flattens messages into single prompt with role prefixes. Supports SSE streaming. Parses `<tool_calls>` tags for extractor.
  - `backend-openai.ts` — OpenAI-compatible chat completion. Native function calling for tools. Assembles streamed tool call chunks.

### Event System (`src/events.ts`)

- `PipelineEvent` union type (step_start, step_token, step_complete, extractor_background, pipeline_complete, pipeline_error, pipeline_cancelled)
- `EventBus` — publish/subscribe for pipeline events
- Active pipeline registry: `createPipelineRun(chatId)` → `{ bus, abort }`, `getPipelineRun(chatId)`, `cancelPipelineRun(chatId)`, `removePipelineRun(chatId)`

### Pipeline Executor (`src/pipeline.ts`)

- `executePipeline(chatId, lorebook, userMessage, config, bus, signal?)` — runs enabled steps sequentially, checks `signal.aborted` before each step and during streaming
- **Narrator prompt:** World context (active entries, location, characters, items, goals, traits) + instruction to narrate without dialog + recent history
- **Character prompt:** Character descriptions + narrator output + instruction to generate in-character dialog
- **Extractor:** Runs via `executeExtractorStep()` — can be async (different backend) or sync (same backend)
- **Concurrency:** Same backend = sequential via semaphore. Different backends = extractor can be detached.

### Extractor (`src/extractor.ts`)

- **Tool definitions:** `create_entry`, `update_entry`, `delete_entry`, `move_character`, `update_item_location`, `complete_goal`, `update_character_state`, `update_traits`
- Each tool maps to lorebook CRUD + `commitChange()` for git versioning
- Tool calls from the LLM are validated and executed sequentially
- Commits are stored on the extractor's `ChatMessage.commits` for revert-on-delete

### Git Layer (`src/git.ts`)

- Uses `isomorphic-git` for lorebook versioning (adventure lorebooks only, not templates/presets)
- `initRepo(slug)` — `git.init` + stage all + initial commit. No-op if `.git` exists.
- `commitChange(slug, message)` — stage all + commit. Returns SHA or null if no changes.
- `revertCommits(slug, SHAs)` — for each SHA, restore parent state for affected files + commit revert.
- **Startup:** `initGitRepos()` initializes repos for existing non-template lorebooks
- **Integration:** Called after `copyLorebook()` in adventure creation, after each extractor tool execution

## Unified Lorebook / Adventure Model

- **Preset** = built-in lorebook in `presets/lorebooks/`. Always available, read-only. Cannot be modified or deleted.
- **Template** = lorebook with `template: true`. Shown in the unified adventure picker. Presets are templates. User-created templates can be edited and deleted.
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
- **Templates:** Lorebooks with `"template": true` in metadata. Shown as cards in the unified adventure picker with Start/Edit buttons, plus a "+ Template" button. User-created templates also get a Delete button. Presets get View/Copy buttons.
- **Migration:** On startup, `migrateOrphanLorebooks()` converts non-template, non-preset lorebooks with no conversations into templates.
- **All CRUD functions** take `lorebook: string` as their first argument (the lorebook slug)
- **Functions:** `saveLorebookMeta(slug, meta)` — writes updated `_lorebook.json` for an existing lorebook
- **UI:** No separate Lorebook tab. Templates are managed from the unified adventure picker and viewed/edited via `/adventure/:slug` (TemplateView).
  - **Editor** (`LorebookEditor`): Two-column grid — `TreeBrowser` sidebar + `EntryForm` editor. Manages selected entry path, new entry/folder dialogs. Supports `hideHeader` prop for inline use in AdventurePlay and TemplateView. Used inline in adventure play view (Edit mode) and template detail view.
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

- **Phase:** Phase 1 — Core Chat MVP, LLM pipeline complete (Phase 1.1 done)
- **Completed modules:** Lorebook (full CRUD + matching + templates + context-aware activation), Settings (persistence + validation + backend/pipeline config, legacy LLM section removed), Chat (persistence + multi-conversation CRUD + message deletion with git revert), Adventure system (picker + play view + location bar + character dialog partners + active entries), LLM Pipeline (multi-backend abstraction + narrator/character/extractor steps + SSE streaming + git-backed lorebook mutations + abort/cancel + classified error handling)
- **Frontend:** React 18 + Vite + react-router-dom 7. SSE streaming with token-by-token rendering, source badges, extractor indicator, message deletion, stop button, error display. Adventure-scoped settings URL.
- **Dependencies:** `isomorphic-git` for lorebook versioning
- **Next up:** Phase 1.3 — Character cards, Phase 2 — Message actions (edit, regenerate, swipe)
