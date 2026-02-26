# Character State System


## Overview

Each character maintains a private state map tracking emotional, relational, and identity states. States carry an internal numeric value managed by a state engine. A per-character extractor LLM reads contextual signals and outputs symbolic operations; the state engine applies the math. **No LLM ever sees raw numeric values** — only qualitative hint labels derived from value ranges.


## State Categories

| Category   | Max Count         | Removed When                                | Evolve When                              |
|------------|-------------------|---------------------------------------------|------------------------------------------|
| temporary  | unlimited         | value reaches 0                             | value reaches 20 to persistent           |
| persistent | 10                | value reaches 0, or pruned by consolidation | when overflow reaches 30, take evolution |
| identity   | 3 (conflict-free) | identity-crisis only                        |                                          |


## State Values and Hint Labels

Internal values range from **0–30**. Identity states may reach 0 (dormant) but are not removed — only identity-crisis removes them. The state engine translates ranges into hint labels for the extractor:

| Range | Label   | 
|-------|---------|
| 1–5   | hidden  |
| 6–10  | hunch   |
| 11–15 | urge    |
| 16–20 | active  |
| 21–30 | focus   | 

- Raw numbers are never passed to any LLM.
- The hidden only gets displayed to extractor to encourage taking same state twice
- Hidden states don't get displayed for narration, intention or thoughts producing LLMs


## Per-Character Extractor

Each character has a dedicated extractor instance, called once per pipeline turn after the character intention.

### Extractor Input

- Character lore (backstory, personality, relationships)
- Current state map, hint-labeled (no raw values)
- Last 5 narration messages
- Last 5 thought messages from this character
- Last 5 intention messages from this character

### Extractor Output Schema

```json
{
    "amplify": ["current relationship to any character", "mood", "identity", "feelings"],
    "suppress": ["current relationship to any character", "mood", "identity", "feelings"],
    "overflow": "one really important state",
    "evolution": "the evolution of the overflow state"
}
```

- **`amplify`** — list of state names to strengthen. States not yet in the map are created as new temporary states.
- **`suppress`** — list of state names to weaken.
- **`overflow`** — a single persistent state to escalate beyond the amplify ceiling. Must already exist as persistent; otherwise ignored.
- **`evolution`** — the renamed/crystallized form of the overflow state, used when overflow reaches 30. Ignored unless overflow hits 30 this turn.

`overflow` and `evolution` are always treated as a pair. An `evolution` without a corresponding `overflow` is discarded.


## State Mutations

The state engine applies all mutations after extraction. Order: amplify/suppress → overflow → drift for non-mentioned states.

| Operation                | Delta | Cap / Floor |
|--------------------------|-------|-------------|
| amplify                  | +3    | 20          |
| suppress                 | −3    | 0           |
| overflow                 | +3    | 30          |
| non-mentioned temporary  | −1    | 0           |
| non-mentioned persistent | +1    | 20          |
| non-mentioned identity   | +2    | 30          |


## State Lifecycle

### New States

- Any state named in `amplify` that does not yet exist is created at value **3** in `temporary`.
- The +3 amplify is not applied on top, keeping them at **3**.

### Temporary → Persistent Promotion

When a temporary state reaches **20 or above**, it is promoted to `persistent` at its current value.

If this promotion would push the persistent count past 10, a **consolidation** step is triggered first (see below).

### Persistent → Identity (Overflow + Evolution)

When the state designated as `overflow` reaches **30**:

1. The persistent state entry is removed.
2. A new identity state is created under the name given by `evolution`, starting at value **20** (active).
3. If adding this identity state would exceed 3 states, or if it semantically conflicts with an existing identity state,
   an **identity-crisis** is triggered.

**Overflow eligibility**: only `persistent` states may be designated as overflow. Designating a `temporary` or `identity` state as overflow is silently ignored.


## Limits and Resolution Steps

### Persistent State Consolidation

Triggered when persistent count would exceed 10.

The character generates a consolidation **thought** (a dedicated pipeline step): it reasons through all its persistent states, weighs their importance, and produces a prioritized list. The bottom entries are discarded cleanly (not suppressed to 0 — they simply stop being tracked). The top 10 are retained. The pending promotion is then committed.

### Identity-Crisis

Triggered when:
- Adding a new identity state would push the count above 3, **or**
- A new or existing identity state semantically conflicts with another (e.g., *"loyalty to Joe"* alongside *"betrayal of Joe"*)

The character generates an introspection **thought** (a dedicated pipeline step): it reflects on which identity states to keep. The result is 1–3 retained identity states. Non-retained states are permanently removed — they cannot be recovered unless rebuilt from scratch through the temporary → persistent → overflow path.

**Key rule**: `suppress` reduces an identity state's value (floor 0, dormant) but cannot remove it. A dormant identity state recovers naturally via drift (+2/turn). Only identity-crisis removes identity states permanently.


## Example State Map

Internal representation (hidden from LLMs):

```json
{
  "temporary": {
    "embarrassment": 7,
    "curiosity about the stranger": 4
  },
  "persistent": {
    "distrust of guards": 18,
    "grief over lost brother": 15,
    "fondness for Mira": 12
  },
  "identity": {
    "Loyal to the Old Code": 22,
    "Haunted by the Siege": 25
  }
}
```

What the extractor receives (hint-labeled):

```
temporary:
  embarrassment [hunch]
  curiosity about the stranger [hidden]

persistent:
  distrust of guards [active]
  grief over lost brother [urge]
  fondness for Mira [urge]

identity:
  Loyal to the Old Code [focus]
  Haunted by the Siege [focus]
```


## Design Notes and Open Questions

### Improvements

**1. Persistent drift cap at 20**
Without a ceiling, a persistent state at 12 ignored for 10 turns reaches 22 via drift alone, bypassing the overflow mechanism entirely. Capping drift at 20 keeps `overflow` as the exclusive path into the 21–30 range and makes the extractor's `overflow` designation meaningful rather than optional.
*Exception*: if a persistent state is already above 20 (because it is the active overflow target), drift continues up to 30.

**2. Overflow eligibility gating**
Requiring `overflow` to target only existing persistent states (not temporary or identity) keeps escalation intentional. A brand-new state cannot jump directly from temporary to identity in one turn.

**3. Identity state starting value at 20, not 30**
When evolution creates an identity state, starting it at 20 rather than inheriting the predecessor's 30 marks the transformation as a new crystallization — the raw intensity has been distilled into something qualitatively different, not just continued. It also gives the identity state room to grow (or be suppressed) before it becomes fully dominant.

**4. Conflict detection is semantic, not structural**
Identity conflicts should be determined by the character's introspection thought during identity-crisis, not by keyword matching in the engine. The guiding question: *"Can I hold both of these as simultaneously, equally true?"* If the character cannot, that is a conflict. This allows nuanced coexistence (e.g., *"Fond of Mira"* and *"Protective of the City"* coexist fine even if Mira is a criminal) and catches genuine contradictions.

**5. Consolidation and crisis trigger before committing**
Both resolution steps are triggered *before* the new state entry is finalized, ensuring the state map is always within bounds at the end of each extraction cycle.

### Asymmetry by Design: Suppress vs Drift on Identity States

Suppressing an identity state costs 10 turns of −3 to drive it from 30 to 0 (dormant). Drift of +2/turn means it recovers to meaningful strength in roughly 6 turns of silence. This asymmetry is intentional: repressing a core identity trait requires sustained, active effort, and neglecting it even briefly lets it resurface. Identity states are meant to be persistent pressures, not easily silenced.

**Conflict B: Identity-crisis can collapse identity to 1 state**
The crisis resolution allows keeping as few as 1 identity state, meaning a triggered crisis could strip a character from 3 identity states to 1. This is a feature — a genuine identity rupture — but one with dramatic narrative weight. The pipeline should treat identity-crisis as a significant story event.
