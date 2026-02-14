# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directives
- ALWAYS treat source code, type definitions, and test files as the authoritative source of truth. If documentation conflicts, follow the code and flag the docs as stale
- NEVER proactively create or update documentation files (e.g., README.md) unless explicitly requested
- ALWAYS check if the added feature needs more tests and add them accordingly
- ALWAYS run the project's test suite and linting tools after any code change — rely on execution results, not documentation
- ALWAYS write the commit message into `.gitmessage` after completing work (including doc-only changes)
- ALWAYS use semantic commit prefixes: `feat(topic):`, `fix(topic):`, `chore(topic):`, `refactor(topic):`, `test(topic):`, `docs(topic):`
- ALWAYS run `scripts/arch.sh` and `scripts/routes.sh` to verify descriptions are current before finishing
- ALWAYS update `backend/demo.py` when data model or storage changes so `--demo` generates valid demo data
- ALWAYS run `git done` when work is done — stages all changes, commits with `.gitmessage`, and pushes. Do NOT ask for confirmation

## Project Overview

RPG Tavern is an LLM-powered RPG engine. Players describe what their characters want to do, and the server uses LLMs to alter world state and narrate the story. Data is stored as files on disk.

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
Run `scripts/routes.sh` to print all backend API and frontend page routes.

Every source file has a header comment describing its purpose:
- **Python:** module docstring (`"""..."""`)
- **TypeScript/TSX:** JSDoc block before imports (`/** ... */`)

- ALWAYS when changing a module's responsibilities, update its header comment
- ALWAYS when adding or changing a route, update the handler's docstring (backend) or the JSDoc route list (frontend).

### Configuration (.env)

All ports/host are configured via `.env` at the project root (see `.env.example`)

### Icons

- ALWAYS use `@fortawesome/fontawesome-free` for all icons. Prefer `fa-solid` style. Usage: `<i className="fa-solid fa-gear" />`. 
- NEVER use inline SVGs or Unicode symbols for icons

### Dev proxy setup

In development, the Vite dev server proxies `/api/*` requests to the backend. In production, the backend serves everything — API routes and static frontend files — from a single port.

