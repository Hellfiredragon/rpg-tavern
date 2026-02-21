# Agent Instructions

> Always read this file first. Load additional rule files based on the task context.
> Never assume what exists in the codebase — run the discovery scripts first.

---

## Directives
- ALWAYS treat source code, type definitions, and test files as the authoritative source of truth. If documentation conflicts, follow the code and flag the docs as stale
- NEVER proactively create or update documentation files (e.g., README.md) unless explicitly requested
- ALWAYS check if the added feature needs more tests and add them accordingly
- ALWAYS run the project's test suite after any code change — rely on execution results, not documentation
- ALWAYS write the commit message into `.gitmessage` after completing work (including doc-only changes)
- ALWAYS use semantic commit prefixes: `feat(topic):`, `fix(topic):`, `chore(topic):`, `refactor(topic):`, `test(topic):`, `docs(topic):`
- ALWAYS run `git done` when work is done — stages all changes, commits with `.gitmessage`, and pushes. Do NOT ask for confirmation
- ALWAYS document new helper scripts in the Scripts section of this file

## Load Context Rules

| You are working on…                        | Load this file                  |
|--------------------------------------------|---------------------------------|
| Python, FastAPI, data models, DB, tests    | `docs/agent/backend.md`         |
| React, Vite, components, frontend state    | `docs/agent/frontend.md`        |
| MCP tools, world state mutation            | `docs/agent/mcp.md`             |
| LLM pipeline, prompts, stages, extractors  | `docs/agent/pipeline.md`        |

Load **all relevant files** for cross-cutting tasks. They are additive.

---

## Discover the Codebase First

```bash
bash scripts/agent/list_modules.sh       # Python files and their purpose
bash scripts/agent/list_routes.sh        # FastAPI routes
bash scripts/agent/list_mcp_tools.sh     # MCP tools available to the pipeline
bash scripts/agent/list_frontend.sh      # React pages and components
```

---

## Vision

An LLM-driven RPG engine where language models participate as **actors** in a structured, stateful world. The engine is a pipeline of specialised prompt stages — not a single generation call. The world has memory. Characters have state. Consequences persist.

The player writes intent. The world responds with consequence.

---

## Architecture Overview

```
Persona Intent             ← Player writes intention (optional thought first)
     │
     ├──────────────────────────────────────────┐  parallel
     ▼                                          ▼
Narrator                                 Persona Extractor
Resolves persona intention               Updates persona state → MCP
     │
     ▼
NPC Activation             ← NPCs in current location, ordered by chattiness
     │                        Named/nicknamed NPCs activate unconditionally
     │                        Others roll against chattiness score
     ▼
For each activated NPC:
  NPC Intent               ← NPC declares intention (sees own past + narrations)
     │
     ├──────────────────────────────────────────┐  parallel
     ▼                                          ▼
  Narrator                              Character Extractor
  Resolves NPC intention                Updates NPC state → MCP
     │
     ▼
  Lore Extractor           ← Extracts world facts from new narration → MCP
```

Each stage is a discrete, scoped LLM call. The orchestrator injects context; stages do not query state themselves. Only MCP tools may mutate world state.

See `docs/agent/pipeline.md` for full stage behaviour.

---

## Updating This File

Update `agent.md` when:
- The high-level architecture changes
- A new context rule file is added
- The discovery script set changes

Update the **context rule files** when stage behaviour, tech constraints, or MCP contracts change.

Never update any of these files for: refactors, renamed files, new endpoints, bug fixes, performance changes. **Code is the source of truth for implementation. These files govern behaviour.**