# MCP Rules

> Load when: creating, modifying, or calling MCP tools; working on world state mutation of any kind.

---

## Core Principle

**MCP tools are the only sanctioned way to mutate world state.**

This includes: lorebook entries, character state, persona state, location, relationships, and any other persisted game fact. No pipeline stage, no API handler, no background task may write to world state through any other path.

This constraint exists so that all state changes are structured, validated, auditable, and decoupled from prompt output.

---

## Before You Start

Always check what tools already exist:
```bash
bash scripts/agent/list_mcp_tools.sh
```

Do not create a new tool if an existing one covers the need.

---

## Designing a Tool

- One tool, one responsibility. Do not create a general-purpose "update world" tool.
- Tool arguments must be a typed pydantic model. No raw dicts, no `**kwargs`.
- Tools must validate their inputs and raise structured errors — never silently fail or partially apply state.
- Tool names are stable API surface. Rename only with deliberate intent and update `AGENT.md` if the contract scope changes.
- Tools should be idempotent where possible. A re-run of the same tool call should not produce inconsistent state.

---

## Tool Categories (expected)

| Category             | Responsibility                                      |
|----------------------|-----------------------------------------------------|
| Lorebook             | Create, update, delete world facts and lore entries |
| Character State      | Update character attributes, status, inventory      |
| Persona State        | Update player persona attributes and active persona |
| Location             | Transition player/NPC to a new location             |
| Relationships        | Update relationship state between characters        |

Check `list_mcp_tools.sh` for the live list. This table reflects intent, not implementation.

---

## Calling Tools from the Pipeline

- The **Lore Extractor**, **Character Extractor**, and **Persona Extractor** stages call MCP tools.
- NPC and Narrator stages are **read-only** with respect to world state.
- The orchestrator may call MCP tools directly for setup or transition operations outside the narrative pipeline.
- Tool calls from pipeline stages must be logged with the stage name and turn ID for traceability.
