# Pipeline Rules

> Load when: working on any LLM prompt stage, the orchestrator, context injection, NPC logic, or extraction logic.

---

## Core Principle

The pipeline is a sequence of **narrow, specialised LLM calls**. Each stage has one job. No stage does everything. Stages are composable and independently replaceable.

Every LLM call produces exactly one **output**. The stream is the shared record of the adventure; each stage receives a filtered view of it.

The Narrator's output is a **beat script** — a structured list of narration segments and dialog cues. The orchestrator expands the script: narration beats are appended directly as `narration` messages; dialog cues trigger one **Character Dialog** LLM call each, appending a `dialog` message. Every other stage produces a single message directly.

---

## Message Stream

An adventure is a sequence of messages. Every pipeline stage reads from and appends to this stream. Messages are never edited or deleted — the stream is append-only.

### Message Structure

```
owner        — who produced this message
             system | narrator | <persona_id> | <character_id>
type         — what kind of content it carries
             narration | dialog | intention | thought | scene_marker
turn_id      — which player turn produced it (increments each time the player submits)
seq          — position within the turn (increments per message, including dialog)
content      — the message text
mood         — (dialog only) emotional register of the speaker, e.g. "tensed", "warm", "cautious"
```

### Message Types

**`narration`** — action, atmosphere, and scene description. Produced by the Narrator (from its beat script). Never contains spoken words — dialog is always a separate `dialog` message owned by the speaker.

**`dialog`** — spoken words, owned by the character or persona who speaks them. Produced by the Character Dialog stage, one message per cue. Carries a `mood` field that captures the speaker's emotional register at the moment of speaking (e.g. `tensed`, `warm`, `suspicious`). Public — heard by everyone in the scene.

**`intention`** — what a persona or character declares they want to do. Never shown to other characters during play. Player sees their own; others only in Debug/Sandbox mode.

**`thought`** — internal reasoning or feelings, formed before an intention. Optional per turn. Strictly private — never passed to any other character's stage. The player sees their own persona's thoughts. Characters see their own.

**`scene_marker`** — a system-generated boundary event injected by the orchestrator. Not produced by an LLM. Signals structural changes: location switch, time skip, scene open/close. Visible to the Narrator so it can shift tone. Not visible to personas or NPCs.

**`system`** — injected context (world state, lore, instructions). Never part of the narrative. Stripped from any player-facing view.

---

## Message Visibility Matrix

✓ = visible &nbsp; ✗ = not visible &nbsp; ◐ = own only

| Stage                       | `scene_marker` | `narration`      | `dialog`         | `intention`      | `thought` |
|-----------------------------|----------------|------------------|------------------|------------------|-----------|
| **Persona Intent**          | ✗              | ✓ all past       | ✓ all past       | ◐ own past       | ◐ own     |
| **NPC Intent** (per NPC)    | ✗              | ✓ all past       | ✓ all past       | ◐ own past       | ◐ own     |
| **Narrator**                | ✓              | ✓ all past       | ✓ all past       | ✓ resolving only | ✗         |
| **Character Dialog**        | ✗              | ✓ all past       | ✓ all past       | ✗                | ✗         |
| **Persona Extractor**       | ✗              | ✓ all past       | ✓ all past       | ◐ last own only  | ◐ own     |
| **Character Extractor**     | ✗              | ✓ all past       | ✓ all past       | ◐ last own only  | ◐ own     |
| **Lore Extractor**          | ✗              | ✓ current only   | ✓ current only   | ✗                | ✗         |

**Key rules:**

- **NPCs see their own past intentions but no others'.** They know what they themselves have previously declared, and what the world has narrated — nothing about what any other character intends.
- **The Narrator sees exactly one intention per call** — the one it is currently resolving. Called once per intention, building on the growing narration history within the turn.
- **The Narrator never sees thoughts.** It narrates observable outcomes, not inner states.
- **Dialog is public.** All stages treat past `dialog` messages the same as past `narration` — everyone heard what was said.
- **Character Dialog receives no intentions.** It receives only the narration/dialog history and the cue from the Narrator's beat script (character id, mood, context hint). It does not see the current intention being resolved.
- **Extractors do not see the current round's messages.** They run in parallel with the Narrator beat-script expansion and receive only past narrations and dialogs (before this round). State is determined by intention + world history — the current round's messages will be available to extractors in the *next* round.
- **The Lore Extractor sees only the current round's narration and dialog** — the new messages just produced. It never re-processes past rounds.
- **Thoughts are always private** to their owner. No stage receives another character's thoughts.
- **Player visibility (UI):** narrations + dialogs + own intentions + own thoughts in normal mode. All intentions visible in Debug/Sandbox mode only.

### State Visibility Threshold

Character and persona states have a visibility level (integer). This level gates which stages can see a given state entry:

- **Level < 6 (subconscious / latent):** injected into Extractor stages only. Not visible to the character's own Intent stage or to the Narrator.
- **Level ≥ 6 (manifest):** injected into the character's Intent stage and the Narrator, in addition to Extractor stages.

This allows internal state (e.g. a slowly building rage, a hidden curse) to influence extraction without leaking into narrative prompts prematurely.

---

## Turn Structure

A **turn** begins when the player submits an intention and ends when the pipeline returns to waiting for the player. The Narrator fires once per intention (persona + each activated NPC), producing a beat script the orchestrator expands into interleaved narration and dialog messages.

```
TURN START
│
├─ 1. [Scene Marker?]
│     If a location switch or scene boundary was triggered, the orchestrator
│     injects a scene_marker before the turn begins.
│
├─ 2. Persona Intent
│     Player chooses active persona and writes an intention (optionally a thought first).
│     Produces: thought? + intention (owner = persona)
│
├─ 3. Narrator  ──────────────────────────────────────┐  parallel
│     Resolves the persona intention.                  │
│     Produces: beat script (narration beats +         │
│               dialog cues for any NPC who speaks)    │
│     Orchestrator expands the script:                 ▼
│       • narration beat → narrator/narration message  Persona Extractor
│       • dialog cue    → Character Dialog LLM call    Updates persona state
│                         → <character_id>/dialog msg  via MCP.
│     (beats appended in script order; seq assigned    Produces: system message
│      as each message lands in the stream)            (internal)
│
├─ 4. NPC Activation Order
│     Determine which NPCs act and in what order:
│       a. Baked NPCs first (scripted, story-critical — always activate)
│       b. Remaining NPCs ordered by chattiness score, descending
│       c. Each non-baked NPC rolls against their chattiness score —
│          below threshold → skips this turn, produces no message
│
└─ 5. For each activated NPC (in order):
       │
       ├─ NPC Intent
       │   NPC sees own past intentions, narrations, and dialogs.
       │   Produces: thought? + intention (owner = character)
       │
       ├─ Narrator  ──────────────────────────────────────┐  parallel
       │   Resolves this NPC's intention.                  │
       │   Produces: beat script (narration beats +        │
       │             dialog cues for the NPC and any       │
       │             bystanders who react)                  │
       │   Orchestrator expands beats as above.            ▼
       │                                          Character Extractor
       │                                          Updates NPC state via MCP.
       │                                          Produces: system message
       │                                          (internal)
       │
       └─ Lore Extractor
           Reads all narration + dialog from the current round.
           Extracts new or changed world facts → writes via MCP.
           Produces: system message (internal)

TURN END — wait for player
```

---

## Stage Contracts

### Persona Intent
- Receives: own past intentions, own thoughts, all past narrations, injected persona state
- Produces: `thought` (optional) + `intention`
- Writes: nothing

### NPC Intent
- Receives: own past intentions, own thoughts, all past narrations (including this turn's so far), injected character state
- Produces: `thought` (optional) + `intention`
- Writes: nothing

### Narrator
- Receives: scene markers, all past narrations and dialogs, the single intention being resolved, injected world state (location, relevant lore), injected character list for the scene
- Produces: a **beat script** — a structured JSON array of beats, in scene order:
  ```json
  [
    { "type": "narration", "content": "<atmospheric prose, no spoken words>" },
    { "type": "cue", "character": "<character_id>", "mood": "<emotion>", "context": "<what prompts this speech>" },
    { "type": "narration", "content": "<continues scene>" }
  ]
  ```
- Writes: nothing
- Called once per intention. The orchestrator expands the beat script into stream messages: narration beats are appended as `narrator/narration`; each cue triggers one Character Dialog call whose result is appended as `<character_id>/dialog` before the next beat is processed.
- The Narrator must not write spoken words in narration beats. Any character speech must be a `cue` beat — even single interjections.

### Character Dialog
- Receives: all past narrations and dialogs, the cue from the Narrator's beat script (`character_id`, `mood`, `context`), injected character state (manifest states only)
- Produces: one `dialog` message — `owner=<character_id>`, `type=dialog`, `mood=<from cue>`, `content=<spoken words only>`
- Writes: nothing
- Fired once per `cue` beat, sequentially, in script order. Each call sees the messages appended by previous beats in the same script expansion (so a character's second line of dialog knows what they just said on their first line).
- Must produce only the spoken words — no stage directions, no attribution ("he said"), no action. The surrounding narration beats provide that context.

### Persona Extractor
- Receives: own last intention, own thoughts, all past narrations and dialogs (not including current round)
- Produces: `system` (internal summary of changes)
- Writes: persona state via MCP (mana, wounds, morality, status effects, inventory, …)
- Runs in parallel with the Narrator. State is driven by what the persona *intended*, grounded in the world history leading up to this moment — not by what the narrator ultimately resolves. A failed theft still costs morality; an attempted spell still drains mana.

### Character Extractor
- Receives: own last intention, own thoughts, all past narrations and dialogs (not including current round)
- Produces: `system` (internal summary of changes)
- Writes: character state via MCP (mood, wounds, magical state, …)
- Runs in parallel with the Narrator beat-script expansion. Same principle as the Persona Extractor — intent drives state change, not narrated outcome.

### Lore Extractor
- Receives: all narration and dialog messages from the current round (every beat the Narrator just produced and expanded), injected current lorebook snapshot
- Produces: `system` (internal summary of extracted facts)
- Writes: lorebook via MCP
- Scoped strictly to the current round. Never re-processes past rounds. Extracts only facts that are new or changed.

---

## Prompt Design Rules

- Each stage has its own system prompt. System prompts are not shared between stages.
- System prompts define role and constraints. World state and the filtered message view are injected alongside.
- Do not merge two stages into one prompt to save on API calls. Separation is intentional.
- Every LLM call returns exactly one output. The output type is fixed per stage.
- The Narrator returns a structured beat script (JSON). Character Dialog returns free-form prose (spoken words only). All other stages return structured pydantic models.
- Chain-of-thought scratch-work is permitted inside a stage but must not appear in the returned output.

### Context Injection — Template Variables

Prompts are Handlebars templates. Available variables per stage:

| Variable                      | Description                                              |
|-------------------------------|----------------------------------------------------------|
| `{{player_name}}`             | Active persona name, or `"the adventurer"` if unset     |
| `{{player.description}}`      | Active persona description                               |
| `{{player.states}}`           | Active persona states (array of dicts, level flags)      |
| `{{char.name}}`               | Current character's name (character stages only)         |
| `{{chars.summary}}`           | Narrative summary of all characters in scene             |
| `{{turn.narration}}`          | Current turn's narration (where available)               |
| `{{lore.text}}`               | Lorebook entries relevant to the current context         |
| `{{msgs}}`                    | Filtered message stream (narration, dialog, intention, thought per visibility rules) |

Use `{{#last msgs 20}}` to limit message history passed to a prompt.

State arrays (`char.states`, `char.all_states`, `player.states`) are arrays of dicts with level flags: `is_subconscious`, `is_manifest`, etc. Subconscious states (level < 6) are injected into extractor prompts only — not into intent or narrator prompts.

---

## Scene Markers

Scene markers are injected by the orchestrator, not produced by an LLM. They are structural signals, not narrative content.

```
type: scene_marker
subtype: location_change | time_skip | scene_open | scene_close
payload: { from, to } for location_change; { duration } for time_skip
```

On `location_change`:
- The orchestrator injects the marker before the next turn begins.
- The NPC roster is reloaded for the new location.
- The Narrator receives the marker and knows to establish the new setting in its next narration.
- Location state is updated via MCP before the turn runs.

---

## Orchestrator Responsibilities

- Inject scene markers when location or scene state changes.
- Fetch all required world state before each stage runs.
- Build the correctly filtered message view for each stage per the visibility matrix.
- Assign `turn_id` (increments per player submission) and `seq` (increments per appended message within a turn) before appending any message to the stream.
- Expand Narrator beat scripts in order: append each `narration` beat immediately; for each `cue` beat, fire one Character Dialog LLM call and append the returned `dialog` message before advancing to the next beat.
- Run the Narrator beat-script expansion and the paired Extractor in parallel where indicated. The Extractor does not wait for the expansion to complete — it runs on the pre-round state.
- Execute MCP writes after the paired Narrator expansion completes — never before.
- Log every stage input and output with `turn_id` + `seq` for debugging.

---

## Suggested Additions (not yet implemented — evaluate before building)

**Stream summarisation** — the message stream grows without bound. After N turns, a background summariser compresses old narrations into a compact lore entry injected as system context. Without this, context windows will eventually be exhausted on long adventures.

**Whispered intentions** — an intention with a `target` field, directed at one character. The Narrator sees it; all other NPCs do not. Useful for private conversations or secret actions.

**Out-of-character (OOC) messages** — a player-only message type handled by the orchestrator directly ("end scene", "rewind last NPC"). Never enters the LLM context. Keeps meta-control out of the narrative stream.

**Confidence scores on extractions** — extractors return a confidence value per mutation. Low-confidence writes are flagged for player review rather than applied silently. Prevents hallucinated facts from becoming canon.

**NPC silence as signal** — if all non-baked NPCs skip in a turn, the orchestrator could inject a scene marker or nudge the Narrator to acknowledge the quiet, rather than producing no NPC output at all.

---

## Failure Handling

- If any stage fails (LLM error, parse error, MCP error), the turn fails loudly. Do not silently skip a stage or continue with partial state.
- The orchestrator surfaces the failing stage name and reason to the caller.
- No messages from a failed turn are appended to the stream. The stream stays clean.
- MCP tools are idempotent — a retried turn will not double-write state.
