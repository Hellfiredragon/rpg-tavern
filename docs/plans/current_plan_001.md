# Plan 001 — Extend Broken Compass to Real Systems (LLM stays stubbed)


## Goal

Make the pipeline integration test use real systems end-to-end — real state
mutation, real NPC activation, real visibility filtering, real MCP writes —
while keeping the LLM stubbed via `StubLLM`.


## Steps

Steps must be done in order. Do not start a step until the previous one passes all tests.

### Step 1 — State change schema + storage methods

**What:** Add pydantic models for extractor output and storage methods to apply
state changes to characters and personas.

**New in `rpg_tavern/models.py`:**
```python
class StateChange(BaseModel):
    category: Literal["temporal", "persistent", "core"]
    label: str
    value: int  # clamped 0–10 on write

class ExtractorResult(BaseModel):
    state_changes: list[StateChange]
```

**New in `rpg_tavern/storage.py`:**
- `apply_character_state_changes(slug, char_id, changes: list[StateChange])`
- `apply_persona_state_changes(slug, persona_id, changes: list[StateChange])`
- State entries are upserted by `label` within `category`. Value clamped to 0–10.

**Tests:** colocated unit tests in `tests/test_models.py` and `tests/test_storage.py`
covering upsert, clamping, and category isolation.

### Step 2 — Wire extractors to storage

**What:** Make both extractor stages actually apply their output. Track which
character IDs appeared in `cue` beats during expansion and run
`character_extractor` once per character.

**Orchestrator changes:**
1. During beat expansion, collect `char_ids_spoken: set[str]` from `cue` beats.
2. After beat expansion, parse `persona_extractor` output → apply state changes.
3. For each `char_id` in `char_ids_spoken`, call `character_extractor` LLM →
   parse → apply state changes.

**Updated stub in test — turn 2 gains a `character_extractor` entry:**
```python
BRUNOLF_EXTRACTOR_T2 = json.dumps({"state_changes": [
    {"category": "temporal", "label": "Cautious", "value": 3},
]})

stub_t2 = StubLLM({
    "narrator":            [NARRATOR_T2],
    "character_dialog":    [BRUNOLF_DIALOG_T2_A, BRUNOLF_DIALOG_T2_B],
    "character_extractor": [BRUNOLF_EXTRACTOR_T2],
    "persona_extractor":   [EXTRACTOR_EMPTY],
    "lore_extractor":      [LORE_T2],
})
```

**New test assertions:**
```python
brunolf = next(c for c in storage.get_characters("broken-compass") if c.id == "brunolf")
cautious = next(s for s in brunolf.states if s["label"] == "Cautious")
assert cautious["value"] == 3
```

### Step 3 — Message visibility matrix

**What:** Build a `filter_messages(messages, stage, own_id, current_turn_id)`
function enforcing the visibility rules from `pipeline.md`. Each stage receives
only what it is allowed to see.

**Rules to implement:**

| Stage | Sees |
|---|---|
| Narrator | all past narration + dialog; current intention only |
| Character/Persona Dialog | all past narration + dialog; no intentions |
| Persona/Character Extractor | past narration + dialog before this round; own last intention |
| NPC Intent | own past intentions; all past narration + dialog |
| Lore Extractor | current round narration + dialog only |

**New module:** `rpg_tavern/pipeline/visibility.py`
**Tests:** `tests/pipeline/test_visibility.py` — parametrised per stage, verifying
excluded types are absent.

### Step 4 — NPC activation + intent stage

**What:** Implement the NPC loop that runs after the player's round within the
same turn. Extend the test with Turn 3 (Isolde activates).

**New function:** `activate_npcs(characters, rng) -> list[Character]`
- Baked NPCs (flag on `Character`) always activate.
- Others: activate if `rng.randint(0, 100) < chattiness`.

**Orchestrator NPC loop (after player round):**
1. Call `activate_npcs` with seeded RNG.
2. For each activated NPC:
   a. Call `npc_intent` LLM → append `owner=char_id, type=intention`.
   b. Call `narrator` LLM → expand beat script.
   c. Run `character_extractor` for characters that appeared in beats.
   d. Run `lore_extractor` on this NPC round's narration + dialog.

**`run_turn` signature gains `rng` parameter:**
```python
async def run_turn(*, ..., rng: random.Random | None = None) -> list[Message]
```
Defaults to `random.Random()` in production; tests pass `random.Random(42)` for
determinism.

**Turn 3 stub additions:**
```python
INTENTION_T3 = "I sit quietly and watch the room."

ISOLDE_INTENT    = "The sellsword knows about the road. I'll approach him."
NARRATOR_T3_PLAYER = json.dumps([
    {"type": "narration", "content": "You settle back and nurse your drink."},
])
NARRATOR_T3_ISOLDE = json.dumps([
    {"type": "narration", "content": "The merchant sets down her cup and crosses the room."},
    {"type": "cue", "character": "isolde", "mood": "desperate",
     "context": "Isolde approaches and sizes up the sellsword."},
    {"type": "narration", "content": "She stops beside you."},
    {"type": "cue", "character": "isolde", "mood": "desperate",
     "context": "Isolde names her destination and offers payment."},
])
ISOLDE_DIALOG_A  = "You look like someone who knows how to use that."
ISOLDE_DIALOG_B  = "I need to reach Estfeld by tomorrow night. I can pay well."
ISOLDE_EXTRACTOR = json.dumps({"state_changes": [
    {"category": "temporal", "label": "Frightened", "value": 6},
    {"category": "temporal", "label": "Desperate",  "value": 5},
]})

stub_t3 = StubLLM({
    "narrator":            [NARRATOR_T3_PLAYER, NARRATOR_T3_ISOLDE],
    "npc_intent":          [ISOLDE_INTENT],
    "character_dialog":    [ISOLDE_DIALOG_A, ISOLDE_DIALOG_B],
    "character_extractor": [ISOLDE_EXTRACTOR],
    "persona_extractor":   [EXTRACTOR_EMPTY],
    "lore_extractor":      [LORE_EMPTY, LORE_EMPTY],   # player round + Isolde round
})
```

**New test assertions:**
```python
# Isolde's intent message in stream
assert any(m.owner == "isolde" and m.type == "intention" for m in all_messages)

# Isolde's state applied — Frightened is manifest (≥6)
isolde = next(c for c in storage.get_characters("broken-compass") if c.id == "isolde")
frightened = next(s for s in isolde.states if s["label"] == "Frightened")
assert frightened["value"] == 6
```

### Step 5 — Context injection (states → narrator prompt)

**What:** Pass character and persona states into the narrator prompt, gated by
the manifest threshold (value ≥ 6 → visible to narrator).

**Orchestrator changes:**
- Before each narrator call, load characters + persona from storage.
- Build `chars_context`: name + description + manifest states (value ≥ 6) per character.
- Build `persona_context`: name + description + manifest states.
- Inject both into `_narrator_prompt`.

After Step 4, Isolde's `Frightened=6` becomes manifest, so the narrator for
turn 4 would receive it. No new test assertions needed here — this affects only
prompt content, which the stub ignores.

### Step 6 — MCP layer for state writes

**What:** Enforce the `pipeline.md` rule that all state mutation goes through MCP
tools, not direct storage calls. Implement a minimal in-process MCP server.

**New module:** `rpg_tavern/mcp_server.py`
Three tools:

| Tool | Args | Effect |
|---|---|---|
| `update_character_state` | `adventure_slug, char_id, changes` | calls `storage.apply_character_state_changes` |
| `update_persona_state` | `adventure_slug, persona_id, changes` | calls `storage.apply_persona_state_changes` |
| `store_lorebook_entry` | `adventure_slug, key, content` | calls `storage.append_lorebook_entries` |

**Orchestrator changes:**
- Replace direct storage calls in extractor stages with MCP tool calls.
- MCP server is injected into `run_turn` (same pattern as `llm`).

**For tests:** MCP server runs in-process, backed by the same `Storage` instance.
All existing state assertions continue to pass unchanged.


## Dependency Order

```
Step 1  (models + storage state)
  └─ Step 2  (wire extractors)
       └─ Step 4  (NPC loop)         ← also needs Step 3
Step 3  (visibility matrix)
  └─ Step 4  (NPC loop)
       └─ Step 5  (context injection)
            └─ Step 6  (MCP layer)
```


## Status

- [x] Step 1 — State change schema + storage methods
- [x] Step 2 — Wire extractors to storage
- [x] Step 3 — Message visibility matrix
- [x] Step 4 — NPC activation + intent stage
- [x] Step 5 — Context injection
- [x] Step 6 — MCP layer
