# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directives
- ALWAYS treat source code, type definitions, and test files as the authoritative source of truth. If documentation conflicts, follow the code and flag the docs as stale
- NEVER proactively create or update documentation files (e.g., README.md) unless explicitly requested
- ALWAYS check if the added feature needs more tests and add them accordingly
- ALWAYS run the project's test suite after any code change — rely on execution results, not documentation
- ALWAYS write the commit message into `.gitmessage` after completing work (including doc-only changes)
- ALWAYS use semantic commit prefixes: `feat(topic):`, `fix(topic):`, `chore(topic):`, `refactor(topic):`, `test(topic):`, `docs(topic):`
- ALWAYS run `git done` when work is done — stages all changes, commits with `.gitmessage`, and pushes. Do NOT ask for confirmation
- ALWAYS document new helper scripts in the Scripts section of this file

## Project Overview

RPG Tavern is an LLM-powered RPG engine PoC. A FastAPI HTTP backend orchestrates an RPG
pipeline using KoboldCpp for text generation and an MCP server for lorebook lookup.

```
HTTP Backend (FastAPI)
  └─ Pipeline
       ├─ KoboldCpp (localhost:5001) → narration
       ├─ KoboldCpp → key extraction (JSON)
       └─ MCP Client → MCP Server
                          └─ lookup_lorebook(keys) → entries

MCP Server (FastMCP, stdio)
  └─ lorebook.json → lookup tool
```

## Tech Stack

- **Backend:** Python 3.12+ with FastAPI + MCP, managed by **uv**
- KoboldCpp for LLM text generation (localhost:5001)
- FastMCP for lorebook MCP server (stdio transport)

## Commands

### Backend

```bash
uv run uvicorn backend.app:app --reload   # Start backend with hot-reload
uv run python -m backend.mcp_server       # Run MCP server on stdio
uv add <package>                          # Add a Python dependency
```

### Tests

```bash
uv run pytest                       # Run all tests
uv run pytest -k test_look_around   # Run tests matching a pattern
```

## Architecture

Every Python source file has a module docstring (`"""..."""`) describing its purpose.
- ALWAYS update the module docstring when changing a module's responsibilities.

### MCP Integration

- MCP server lives in `backend/mcp_server.py` — exposes `lookup_lorebook` tool
- Lorebook loaded from `data/lorebook.json` (or injected via `set_lorebook()` for tests)
- FastMCP returns one `TextContent` per result entry, each containing a JSON-encoded dict
- In tests: use `mcp.shared.memory.create_connected_server_and_client_session` for in-process MCP

### Pipeline flow

1. Build narration prompt (system context + lorebook key hints + player input)
2. Call `llm.generate()` → narration text
3. Build extraction prompt (narration + key list) → call `llm.generate()` → parse JSON array
4. Call MCP `lookup_lorebook` with extracted keys → activated lore entries
