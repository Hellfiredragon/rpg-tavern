# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RPG Tavern is an LLM-powered RPG engine. Players connect, describe what their characters want to do, and the server uses LLMs to alter world state and narrate the story. Data is stored as files on disk.

## Tech Stack

- **Backend:** Python 3.12+ with FastAPI, managed by **uv**
- **Frontend:** React 19 + TypeScript with Vite, managed by **bun**
- Backend serves the built frontend as static files from `backend/static/`

## Commands

### Development

```bash
uv run main.py              # Start backend + frontend in watch mode
uv run main.py --demo       # Same, but wipe and recreate demo templates first
uv run main.py --data-dir /tmp/rpg  # Use a custom data directory
```

### Backend only

```bash
uv run uvicorn backend.app:app --reload --port 13013   # Start backend with hot-reload
uv add <package>                                        # Add a Python dependency
```

### Tests

```bash
uv run pytest                       # Run all tests
uv run pytest tests/test_storage.py # Run a single test file
uv run pytest -k test_create        # Run tests matching a pattern
```

### Frontend only

```bash
cd frontend && bun run dev       # Vite dev server (proxies /api → backend)
cd frontend && bun run build     # Build to backend/static/
cd frontend && bun run lint      # ESLint
```

## Architecture

Run `scripts/arch.sh` to print the file tree with descriptions extracted from source headers.

Every source file has a header comment describing its purpose:
- **Python:** module docstring (`"""..."""`)
- **TypeScript/TSX:** JSDoc block before imports (`/** ... */`)

When changing a module's responsibilities, update its header comment.

### Configuration (.env)

All ports/host are configured via `.env` at the project root (see `.env.example`). Key vars: `HOST`, `BACKEND_PORT`, `FRONTEND_PORT`, `DATA_DIR`.

### Icons

Use **Font Awesome Free** (`@fortawesome/fontawesome-free`) for all icons. Prefer `fa-solid` style. Usage: `<i className="fa-solid fa-gear" />`. Do not use inline SVGs or Unicode symbols for icons. The CSS is imported in `main.tsx`.

### Frontend Routes

| Route | Page |
|-------|------|
| `/` | Quest Board |
| `/global-settings` | Standalone Global Settings |
| `/tmpl/{slug}` | Template (default tab: chat) |
| `/tmpl/{slug}/{tab}` | Template with specific tab |
| `/advn/{slug}` | Adventure (default tab: chat) |
| `/advn/{slug}/{tab}` | Adventure with specific tab |

Valid tabs: `chat`, `personas` (adventures only), `characters` (adventures only), `world`, `settings`, `global-settings`, `global-personas`. The tab bar is split into left (adventure-specific) and right (global) groups. The active tab is reflected in the URL via `history.replaceState` and restored on page load.

### UI Settings

All UI-related settings belong in Global Settings under the "UI Settings" section, stored in `data/config.json` via `GET/PATCH /api/settings`.

### Dev proxy setup

In development, the Vite dev server proxies `/api/*` requests to the backend. In production, the backend serves everything — API routes and static frontend files — from a single port.

## Workflow

- After completing a piece of work, write the commit message into `.gitmessage` — this includes doc-only changes (CLAUDE.md, etc.)
- **Commit messages** use semantic prefixes: `feat(topic):`, `fix(topic):`, `chore(topic):`, `refactor(topic):`, `test(topic):`, `docs(topic):`
- Keep TODOS.md updated when completing items listed there
- When changing a module's responsibilities, update its file header comment
- Run `scripts/arch.sh` to verify architecture descriptions are current
- Update `backend/demo.py` when data model or storage changes so `--demo` generates valid, representative demo data
- Run `git done` when work is done — this stages all changes, commits with `.gitmessage`, and pushes
