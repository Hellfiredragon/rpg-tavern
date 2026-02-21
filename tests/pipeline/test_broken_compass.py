"""The Broken Compass Inn — Pipeline Scenario Test

Scenario:
  Location : The Broken Compass Inn, Millhaven, dusk
  Persona  : Aldric — wandering sellsword
  Characters:
    Brunolf  (innkeeper, chattiness=80)
    Isolde   (merchant, chattiness=55)

Turn 1 — Aldric enters and scans the room.
  Beat script: narration → brunolf cue → narration
  Expected stream: intention, narration, dialog(brunolf), narration

Turn 2 — Aldric asks Brunolf about Isolde (player writes the line explicitly).
  Beat script: narration → persona_verbatim → narration → brunolf cue → narration → brunolf cue
  Expected stream: intention, narration, dialog(aldric), narration,
                   dialog(brunolf), narration, dialog(brunolf)
  Side-effect: lore extractor records the bandit entry.

This test is the spec. It will fail until the pipeline modules are implemented.
"""

import json
import pytest

from rpg_tavern.models import Character, Persona
from rpg_tavern.storage import Storage
from rpg_tavern.pipeline.orchestrator import run_turn


# ---------------------------------------------------------------------------
# LLM stub responses
# ---------------------------------------------------------------------------

NARRATOR_T1 = json.dumps([
    {
        "type": "narration",
        "content": (
            "The Broken Compass smells of wet wool and tallow smoke. "
            "Three travelers huddle near the fire. In the far corner, "
            "a woman in a merchant's coat keeps her eyes on the door — "
            "not watching for arrivals. Watching to make sure no one follows."
        ),
    },
    {
        "type": "cue",
        "character": "brunolf",
        "mood": "neutral",
        "context": "Newcomer walked in soaked and armed. Brunolf is sizing him up.",
    },
    {
        "type": "narration",
        "content": (
            "He sets a clay mug in front of you without being asked, "
            "his eyes flicking briefly to the sword at your hip."
        ),
    },
])

BRUNOLF_DIALOG_T1 = "Rough night to be on the road. You come far?"

EXTRACTOR_EMPTY = json.dumps({"state_changes": []})
LORE_EMPTY = json.dumps({"entries": []})

NARRATOR_T2 = json.dumps([
    {
        "type": "narration",
        "content": "Aldric sets the mug down slowly, eyes still on the room.",
    },
    {
        "type": "persona_verbatim",
        "mood": "low",
        "content": "What's got that woman in the corner wound so tight?",
    },
    {
        "type": "narration",
        "content": (
            "Brunolf's expression tightens. He glances toward the corner "
            "and lowers his voice."
        ),
    },
    {
        "type": "cue",
        "character": "brunolf",
        "mood": "tensed",
        "context": (
            "Aldric asked directly about Isolde. Brunolf knows about "
            "the bandits and her suspicious arrival two nights ago."
        ),
    },
    {
        "type": "narration",
        "content": "He refills your mug without asking.",
    },
    {
        "type": "cue",
        "character": "brunolf",
        "mood": "tensed",
        "context": "Continue — warn about bandit trouble on the Millhaven-Estfeld road.",
    },
])

BRUNOLF_DIALOG_T2_A = (
    "Came in two nights ago. Won't say from where. "
    "Paid double for a room with a bolt."
)
BRUNOLF_DIALOG_T2_B = (
    "There's been trouble on the Millhaven-Estfeld road. "
    "Three merchant wagons robbed in a fortnight."
)

LORE_T2 = json.dumps({
    "entries": [
        {
            "key": "millhaven_estfeld_bandits",
            "content": (
                "Three merchant wagons robbed on the Millhaven-Estfeld road "
                "in a fortnight."
            ),
        }
    ]
})


# ---------------------------------------------------------------------------
# StubLLM — dispatches by stage name, independent queue per stage
# ---------------------------------------------------------------------------

class StubLLM:
    """Deterministic LLM stand-in for tests.

    Provide a dict mapping stage name → list of responses (in call order).
    Raises if a stage is called more times than responses were provided.
    """

    def __init__(self, responses: dict[str, list[str]]) -> None:
        self._queues: dict[str, list[str]] = {k: list(v) for k, v in responses.items()}
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, stage: str, prompt: str) -> str:
        self.calls.append((stage, prompt))
        queue = self._queues.get(stage)
        if not queue:
            raise AssertionError(
                f"StubLLM: unexpected call to stage={stage!r} "
                f"(no responses queued). calls so far: {self.calls}"
            )
        return queue.pop(0)

    def assert_exhausted(self) -> None:
        """Assert every queued response was consumed — catches missing LLM calls."""
        leftover = {k: v for k, v in self._queues.items() if v}
        if leftover:
            raise AssertionError(
                f"StubLLM: unused responses remain: {leftover}"
            )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

INTENTION_T1 = (
    "I step inside out of the rain and take a seat at the bar, "
    "scanning the room while I order an ale."
)

INTENTION_T2 = (
    "I take a slow drink and keep my voice low. "
    "'What's got that woman in the corner wound so tight?'"
)


@pytest.fixture
def storage(tmp_path: pytest.TempPathFactory) -> Storage:
    s = Storage(tmp_path)
    s.create_adventure(
        slug="broken-compass",
        title="The Broken Compass Inn",
        setting=(
            "A roadside inn in the village of Millhaven, dusk. "
            "A storm has stranded travelers inside."
        ),
    )
    s.save_character(
        "broken-compass",
        Character(
            id="brunolf",
            name="Brunolf",
            description="Gruff innkeeper. Fair but watchful. Knows local gossip.",
            chattiness=80,
        ),
    )
    s.save_character(
        "broken-compass",
        Character(
            id="isolde",
            name="Isolde",
            description="Traveling merchant. Visibly nervous. Hiding something.",
            chattiness=55,
        ),
    )
    s.save_persona(
        "broken-compass",
        Persona(
            id="aldric",
            name="Aldric",
            description="A wandering sellsword. Dry wit, blade always close.",
        ),
    )
    return s


@pytest.fixture
def stub_t1() -> StubLLM:
    return StubLLM({
        "narrator":          [NARRATOR_T1],
        "character_dialog":  [BRUNOLF_DIALOG_T1],
        "persona_extractor": [EXTRACTOR_EMPTY],
        "lore_extractor":    [LORE_EMPTY],
    })


@pytest.fixture
def stub_t2() -> StubLLM:
    return StubLLM({
        "narrator":          [NARRATOR_T2],
        "character_dialog":  [BRUNOLF_DIALOG_T2_A, BRUNOLF_DIALOG_T2_B],
        "persona_extractor": [EXTRACTOR_EMPTY],
        "lore_extractor":    [LORE_T2],
    })


@pytest.fixture
async def storage_after_t1(storage: Storage, stub_t1: StubLLM) -> Storage:
    """Storage with turn 1 already committed — used as base for turn 2 tests."""
    await run_turn(
        storage=storage,
        adventure_slug="broken-compass",
        persona_id="aldric",
        intention=INTENTION_T1,
        llm=stub_t1,
    )
    return storage


# ---------------------------------------------------------------------------
# Turn 1 tests
# ---------------------------------------------------------------------------

class TestTurn1:
    """Aldric enters the inn and scans the room."""

    async def test_message_count(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        # intention + narration + dialog(brunolf) + narration = 4
        assert len(messages) == 4

    async def test_message_sequence(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        assert [(m.seq, m.owner, m.type) for m in messages] == [
            (1, "aldric",   "intention"),
            (2, "narrator", "narration"),
            (3, "brunolf",  "dialog"),
            (4, "narrator", "narration"),
        ]

    async def test_all_turn_id_1(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        assert all(m.turn_id == 1 for m in messages)

    async def test_no_spoken_words_in_narration(
        self, storage: Storage, stub_t1: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        for m in messages:
            if m.type == "narration":
                assert '"' not in m.content and "\u201c" not in m.content, (
                    f"Narration contains quoted speech: {m.content!r}"
                )

    async def test_brunolf_dialog(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        dialog = next(m for m in messages if m.type == "dialog")
        assert dialog.owner == "brunolf"
        assert dialog.mood == "neutral"
        assert dialog.content == BRUNOLF_DIALOG_T1

    async def test_messages_persisted(
        self, storage: Storage, stub_t1: StubLLM
    ) -> None:
        await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        assert len(storage.get_messages("broken-compass")) == 4

    async def test_no_lore_after_turn1(
        self, storage: Storage, stub_t1: StubLLM
    ) -> None:
        await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        assert storage.get_lorebook("broken-compass") == []

    async def test_all_llm_responses_consumed(
        self, storage: Storage, stub_t1: StubLLM
    ) -> None:
        await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
        )
        stub_t1.assert_exhausted()


# ---------------------------------------------------------------------------
# Turn 2 tests
# ---------------------------------------------------------------------------

class TestTurn2:
    """Aldric asks about Isolde. Player wrote the line; Brunolf responds twice."""

    async def test_message_sequence(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        assert [(m.seq, m.owner, m.type) for m in messages] == [
            (5,  "aldric",   "intention"),
            (6,  "narrator", "narration"),
            (7,  "aldric",   "dialog"),    # persona_verbatim
            (8,  "narrator", "narration"),
            (9,  "brunolf",  "dialog"),    # cue 1
            (10, "narrator", "narration"),
            (11, "brunolf",  "dialog"),    # cue 2
        ]

    async def test_persona_verbatim_lifted_from_intention(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        persona_dialog = next(
            m for m in messages if m.type == "dialog" and m.owner == "aldric"
        )
        # Content must match what the Narrator placed in the persona_verbatim beat,
        # not the full intention string (the Narrator strips action framing).
        assert persona_dialog.content == "What's got that woman in the corner wound so tight?"
        assert persona_dialog.mood == "low"

    async def test_persona_verbatim_requires_no_llm_call(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        persona_dialog_calls = [
            c for c in stub_t2.calls if c[0] == "persona_dialog"
        ]
        assert persona_dialog_calls == [], (
            "persona_verbatim beat must not trigger a Persona Dialog LLM call"
        )

    async def test_brunolf_two_dialog_beats(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        brunolf_lines = [
            m for m in messages if m.owner == "brunolf" and m.type == "dialog"
        ]
        assert len(brunolf_lines) == 2
        assert brunolf_lines[0].content == BRUNOLF_DIALOG_T2_A
        assert brunolf_lines[1].content == BRUNOLF_DIALOG_T2_B
        assert brunolf_lines[0].mood == "tensed"
        assert brunolf_lines[1].mood == "tensed"

    async def test_brunolf_dialog_beats_interleaved_with_narration(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        types = [m.type for m in messages]
        # narration must appear between the two brunolf dialog messages
        brunolf_idxs = [i for i, m in enumerate(messages) if m.owner == "brunolf"]
        assert brunolf_idxs[1] - brunolf_idxs[0] > 1, (
            "Expected a narration beat between the two Brunolf dialog messages"
        )
        assert types[brunolf_idxs[0] + 1] == "narration"

    async def test_lore_entry_created(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        lorebook = storage_after_t1.get_lorebook("broken-compass")
        assert len(lorebook) == 1
        assert "Millhaven-Estfeld" in lorebook[0]["content"]

    async def test_cumulative_message_count(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        # 4 from turn 1 + 7 from turn 2
        assert len(storage_after_t1.get_messages("broken-compass")) == 11

    async def test_all_llm_responses_consumed(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
        )
        stub_t2.assert_exhausted()
