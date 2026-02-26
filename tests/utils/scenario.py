"""Scenario DSL helper for readable pipeline tests.

Usage:

    s = Scenario(storage, slug="my-adventure", persona_id="Aldric")

    s.player_intent("I push through the door…")
    s.narrate("The door groans open…")
    s.persona_says("Ale, and whatever's hot.", mood="weary")
    s.narrate("Brunolf looks up…")
    s.persona_extractor(amplify=["determination"])
    s.lore()

    s.npc_intent("Brunolf", "I'll pour the stranger an ale…")
    s.narrate("Brunolf reaches under the bar…")
    s.npc_says("Brunolf", "Rough night to be on the road.", mood="guarded",
               context="Stranger asks about Greymount crossing.")
    s.narrate("He sets the mug down.")
    s.npc_extractor("Brunolf", amplify=["caution toward strangers"])
    s.lore(greymount_pass="The eastern pass is closed.")

    await s.run_turn()

Each call accumulates script items.  ``run_turn()`` assembles a StubLLM,
sets character chattiness (100 for named NPCs, 0 for all others), runs the
pipeline, and asserts messages + lore + states.  Call it once per turn;
it resets the accumulated state afterwards so the same instance can be
reused across turns on the same storage.

Beat-script grouping:
  ``player_intent()`` starts the persona's narrator context.
  ``npc_intent(char)`` closes the current context and starts char's context.
  ``narrate()`` / ``persona_says()`` / ``npc_says()`` add beats to the
  current open context.

  When ``npc_says(char)`` is called inside *char*'s own ``npc_intent`` block,
  the cue beat has no ``intention`` field (the NPC already stated its
  intention).  When called outside any ``npc_intent`` block (e.g. during the
  player's round), use the ``intention=`` parameter to embed it in the cue.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field

from rpg_tavern.models import ExtractorOutput
from rpg_tavern.pipeline.orchestrator import run_turn as _run_turn
from rpg_tavern.pipeline.state_engine import apply_extraction
from rpg_tavern.storage import Storage
from tests.utils.stub_llm import LORE_EMPTY, StubLLM


# ---------------------------------------------------------------------------
# Internal data types
# ---------------------------------------------------------------------------

@dataclass
class _NarratorContext:
    """One narrator call.  *npc_id* is None for the persona's round."""
    npc_id: str | None
    beats: list[dict] = field(default_factory=list)
    char_dialogs: list[str] = field(default_factory=list)


@dataclass
class _ExtractorEntry:
    owner_id: str
    is_persona: bool
    output: ExtractorOutput


@dataclass
class _LoreEntry:
    facts: dict[str, str]   # key → content (empty dict = no lore this round)


@dataclass
class _ExpectedMessage:
    owner: str
    type: str
    content: str
    mood: str | None = None


# ---------------------------------------------------------------------------
# Scenario class
# ---------------------------------------------------------------------------

class Scenario:
    def __init__(self, storage: Storage, slug: str, persona_id: str) -> None:
        self._storage = storage
        self._slug = slug
        self._persona_id = persona_id
        self._reset()

    # ------------------------------------------------------------------
    # Script methods
    # ------------------------------------------------------------------

    def player_intent(self, text: str) -> None:
        """Record the player's intention and open the persona's narrator context."""
        self._intention_text = text
        self._expected.append(_ExpectedMessage(self._persona_id, "intention", text))
        self._open_context(npc_id=None)

    def narrate(self, text: str) -> None:
        """Add a narration beat to the current narrator context."""
        self._require_context("narrate()")
        self._current_ctx.beats.append({"type": "narration", "content": text})
        self._expected.append(_ExpectedMessage("narrator", "narration", text))

    def persona_says(self, text: str, mood: str) -> None:
        """Add a persona_verbatim beat (no LLM call)."""
        self._require_context("persona_says()")
        self._current_ctx.beats.append(
            {"type": "persona_verbatim", "mood": mood, "content": text}
        )
        self._expected.append(_ExpectedMessage(self._persona_id, "dialog", text, mood))

    def npc_intent(self, char_id: str, text: str) -> None:
        """Record the NPC's intention and open their narrator context."""
        self._npc_intents.append((char_id, text))
        self._expected.append(_ExpectedMessage(char_id, "intention", text))
        self._open_context(npc_id=char_id)

    def npc_says(
        self,
        char_id: str,
        text: str,
        mood: str,
        context: str = "",
        intention: str | None = None,
    ) -> None:
        """Add a character cue beat to the current narrator context.

        If called within the NPC's own ``npc_intent`` block, no ``intention``
        field is added to the beat (the NPC already stated it).  Otherwise
        pass ``intention=`` to embed the intent inline in the cue beat; this
        also inserts an expected intention message before the dialog.
        """
        self._require_context("npc_says()")
        beat: dict = {
            "type": "cue",
            "character": char_id,
            "mood": mood,
            "context": context,
        }
        if self._current_ctx.npc_id == char_id:
            # NPC speaks in their own round — intention already in the stream
            pass
        elif intention is not None:
            # NPC speaks in another character's round — embed intention in cue
            beat["intention"] = intention
            self._expected.append(_ExpectedMessage(char_id, "intention", intention))
        self._current_ctx.beats.append(beat)
        self._current_ctx.char_dialogs.append(text)
        self._expected.append(_ExpectedMessage(char_id, "dialog", text, mood))

    def persona_extractor(
        self,
        amplify: list[str] | None = None,
        suppress: list[str] | None = None,
        overflow: str | None = None,
        evolution: str | None = None,
    ) -> None:
        """Record what the persona extractor returns this round."""
        self._extractors.append(_ExtractorEntry(
            owner_id=self._persona_id,
            is_persona=True,
            output=ExtractorOutput(
                amplify=amplify or [],
                suppress=suppress or [],
                overflow=overflow,
                evolution=evolution,
            ),
        ))

    def npc_extractor(
        self,
        char_id: str,
        amplify: list[str] | None = None,
        suppress: list[str] | None = None,
        overflow: str | None = None,
        evolution: str | None = None,
    ) -> None:
        """Record what the character extractor returns for *char_id* this round."""
        self._extractors.append(_ExtractorEntry(
            owner_id=char_id,
            is_persona=False,
            output=ExtractorOutput(
                amplify=amplify or [],
                suppress=suppress or [],
                overflow=overflow,
                evolution=evolution,
            ),
        ))

    def lore(self, **facts: str) -> None:
        """Record lore extractor output for the current round.

        Call with no arguments for an empty round: ``s.lore()``.
        Pass key=value pairs for facts: ``s.lore(eastern_pass="...")``.
        """
        self._lore_entries.append(_LoreEntry(facts))

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------

    async def run_turn(self) -> None:
        """Assemble stubs, run the pipeline turn, assert results, reset."""
        assert self._intention_text is not None, (
            "player_intent() must be called before run_turn()"
        )

        # Capture pre-run states for state assertions
        pre_char_states = {
            c.id: copy.deepcopy(c.states)
            for c in self._storage.get_characters(self._slug)
        }
        pre_persona_states = {
            p.id: copy.deepcopy(p.states)
            for p in self._storage.get_personas(self._slug)
        }

        # Set baked=True for NPCs that appear in npc_intent (guaranteed activation),
        # chattiness=0 + baked=False for all others (guaranteed skip).
        active_npcs = {char_id for char_id, _ in self._npc_intents}
        for char in self._storage.get_characters(self._slug):
            char.baked = char.id in active_npcs
            char.chattiness = 0
            self._storage.save_character(self._slug, char)

        stub = self._build_stub()
        messages = await _run_turn(
            storage=self._storage,
            adventure_slug=self._slug,
            persona_id=self._persona_id,
            intention=self._intention_text,
            llm=stub,
        )

        self._assert_messages(messages)
        self._assert_lore()
        self._assert_states(pre_char_states, pre_persona_states)
        stub.assert_exhausted()
        self._reset()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _reset(self) -> None:
        self._intention_text: str | None = None
        self._contexts: list[_NarratorContext] = []
        self._current_ctx: _NarratorContext | None = None
        self._npc_intents: list[tuple[str, str]] = []
        self._extractors: list[_ExtractorEntry] = []
        self._lore_entries: list[_LoreEntry] = []
        self._expected: list[_ExpectedMessage] = []

    def _open_context(self, npc_id: str | None) -> None:
        ctx = _NarratorContext(npc_id=npc_id)
        self._contexts.append(ctx)
        self._current_ctx = ctx

    def _require_context(self, method: str) -> None:
        assert self._current_ctx is not None, (
            f"{method} must be called inside a player_intent() or npc_intent() block"
        )

    def _build_stub(self) -> StubLLM:
        narrator_scripts = [json.dumps(ctx.beats) for ctx in self._contexts]

        npc_intent_texts = [text for _, text in self._npc_intents]

        char_dialog_texts: list[str] = []
        for ctx in self._contexts:
            char_dialog_texts.extend(ctx.char_dialogs)

        persona_extractor_responses: list[str] = []
        char_extractor_responses: list[str] = []
        for entry in self._extractors:
            response = entry.output.model_dump_json()
            if entry.is_persona:
                persona_extractor_responses.append(response)
            else:
                char_extractor_responses.append(response)

        lore_responses: list[str] = []
        for entry in self._lore_entries:
            if entry.facts:
                lore_responses.append(json.dumps({
                    "entries": [{"key": k, "content": v} for k, v in entry.facts.items()]
                }))
            else:
                lore_responses.append(LORE_EMPTY)

        responses: dict[str, list[str]] = {}
        if narrator_scripts:
            responses["narrator"] = narrator_scripts
        if npc_intent_texts:
            responses["npc_intent"] = npc_intent_texts
        if char_dialog_texts:
            responses["character_dialog"] = char_dialog_texts
        if persona_extractor_responses:
            responses["persona_extractor"] = persona_extractor_responses
        if char_extractor_responses:
            responses["character_extractor"] = char_extractor_responses
        if lore_responses:
            responses["lore_extractor"] = lore_responses
        return StubLLM(responses)

    def _assert_messages(self, messages: list) -> None:
        actual = [(m.owner, m.type, m.content, m.mood) for m in messages]
        expected = [(e.owner, e.type, e.content, e.mood) for e in self._expected]
        if actual != expected:
            lines = ["Message stream mismatch:"]
            max_len = max(len(actual), len(expected))
            for i in range(max_len):
                a = actual[i] if i < len(actual) else "—missing—"
                e = expected[i] if i < len(expected) else "—missing—"
                mark = "✓" if a == e else "✗"
                lines.append(f"  [{i}] {mark}  expected={e}  actual={a}")
            raise AssertionError("\n".join(lines))

    def _assert_lore(self) -> None:
        lorebook = {
            e["key"]: e["content"]
            for e in self._storage.get_lorebook(self._slug)
        }
        for entry in self._lore_entries:
            for key, content in entry.facts.items():
                assert key in lorebook, (
                    f"Lore key {key!r} not found in lorebook. "
                    f"Present keys: {list(lorebook)}"
                )
                assert lorebook[key] == content, (
                    f"Lore[{key!r}]: expected {content!r}, got {lorebook[key]!r}"
                )

    def _assert_states(
        self,
        pre_char: dict[str, dict],
        pre_persona: dict[str, dict],
    ) -> None:
        for entry in self._extractors:
            if not (entry.output.amplify or entry.output.suppress or entry.output.overflow):
                continue

            if entry.is_persona:
                actors = self._storage.get_personas(self._slug)
                actor = next((p for p in actors if p.id == entry.owner_id), None)
                assert actor is not None, f"Persona {entry.owner_id!r} not found"
                pre_states = pre_persona.get(entry.owner_id, {})
                actual_states = actor.states
            else:
                actors = self._storage.get_characters(self._slug)
                actor = next((c for c in actors if c.id == entry.owner_id), None)
                assert actor is not None, f"Character {entry.owner_id!r} not found"
                pre_states = pre_char.get(entry.owner_id, {})
                actual_states = actor.states

            expected_states = apply_extraction(pre_states, entry.output)
            assert actual_states == expected_states, (
                f"State mismatch for {entry.owner_id!r}:\n"
                f"  expected: {expected_states}\n"
                f"  actual:   {actual_states}"
            )
