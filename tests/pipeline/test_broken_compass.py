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
import random

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
        "intention": "I'll offer the newcomer a drink and get a read on him.",
        "context": "Newcomer walked in soaked and armed. Brunolf is sizing him up.",
    },
    {
        "type": "narration",
        "content": (
            "Brunolf sets a clay mug in front of Aldric without being asked, "
            "his eyes flicking briefly to the sword at Aldric's hip."
        ),
    },
])

BRUNOLF_DIALOG_T1 = "Rough night to be on the road. You come far?"

EXTRACTOR_EMPTY = json.dumps({"state_changes": []})
LORE_EMPTY = json.dumps({"entries": []})

BRUNOLF_EXTRACTOR_T2 = json.dumps({"state_changes": [
    {"category": "temporal", "label": "Cautious", "value": 3},
]})

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
            "Brunolf's expression tightens. Brunolf glances toward the corner "
            "and lowers his voice."
        ),
    },
    {
        "type": "cue",
        "character": "brunolf",
        "mood": "tensed",
        "intention": "I'll tell him what I know — carefully.",
        "context": (
            "Aldric asked directly about Isolde. Brunolf knows about "
            "the bandits and her suspicious arrival two nights ago."
        ),
    },
    {
        "type": "narration",
        "content": "Brunolf refills Aldric's mug without asking.",
    },
    {
        "type": "cue",
        "character": "brunolf",
        "mood": "tensed",
        "intention": "I'll warn him about the road trouble.",
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
# Turn 3 stub data — Aldric sits quietly; Isolde (baked) approaches him.
# ---------------------------------------------------------------------------

INTENTION_T3 = "I sit quietly and watch the room."

ISOLDE_INTENT = "The sellsword knows about the road. I'll approach him."

NARRATOR_T3_PLAYER = json.dumps([
    {"type": "narration", "content": "You settle back and nurse your drink."},
])

NARRATOR_T3_ISOLDE = json.dumps([
    {"type": "narration", "content": "Isolde sets down her cup and crosses the room."},
    {
        "type": "cue", "character": "isolde", "mood": "desperate",
        "intention": "I want to test if this stranger is reliable.",
        "context": "Isolde approaches and sizes up the sellsword.",
    },
    {"type": "narration", "content": "Isolde stops beside Aldric."},
    {
        "type": "cue", "character": "isolde", "mood": "desperate",
        "intention": "I'll name my destination and show I can pay.",
        "context": "Isolde names her destination and offers payment.",
    },
])

ISOLDE_DIALOG_A = "You look like someone who knows how to use that."
ISOLDE_DIALOG_B = "I need to reach Estfeld by tomorrow night. I can pay well."

ISOLDE_EXTRACTOR = json.dumps({"state_changes": [
    {"category": "temporal", "label": "Frightened", "value": 6},
    {"category": "temporal", "label": "Desperate",  "value": 5},
]})


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
        "narrator":            [NARRATOR_T1],
        "character_dialog":    [BRUNOLF_DIALOG_T1],
        "character_extractor": [EXTRACTOR_EMPTY],  # brunolf spoke once
        "persona_extractor":   [EXTRACTOR_EMPTY],
        "lore_extractor":      [LORE_EMPTY],
    })


@pytest.fixture
def stub_t2() -> StubLLM:
    return StubLLM({
        "narrator":            [NARRATOR_T2],
        "character_dialog":    [BRUNOLF_DIALOG_T2_A, BRUNOLF_DIALOG_T2_B],
        "character_extractor": [BRUNOLF_EXTRACTOR_T2],  # brunolf spoke twice → one extractor call
        "persona_extractor":   [EXTRACTOR_EMPTY],
        "lore_extractor":      [LORE_T2],
    })


@pytest.fixture
def stub_t3() -> StubLLM:
    return StubLLM({
        "narrator":            [NARRATOR_T3_PLAYER, NARRATOR_T3_ISOLDE],
        "npc_intent":          [ISOLDE_INTENT],
        "character_dialog":    [ISOLDE_DIALOG_A, ISOLDE_DIALOG_B],
        "character_extractor": [ISOLDE_EXTRACTOR],
        "persona_extractor":   [EXTRACTOR_EMPTY],
        "lore_extractor":      [LORE_EMPTY, LORE_EMPTY],  # player round + Isolde round
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
        rng=random.Random(1234),  # seed where neither NPC activates
    )
    return storage


@pytest.fixture
async def storage_after_t2(
    storage_after_t1: Storage, stub_t2: StubLLM
) -> Storage:
    """Storage with turns 1–2 committed. Characters updated for T3 (Isolde baked)."""
    await run_turn(
        storage=storage_after_t1,
        adventure_slug="broken-compass",
        persona_id="aldric",
        intention=INTENTION_T2,
        llm=stub_t2,
        rng=random.Random(1234),
    )
    # Prepare T3: Brunolf won't activate (chattiness=0), Isolde always activates (baked)
    chars = storage_after_t1.get_characters("broken-compass")
    for char in chars:
        if char.id == "brunolf":
            char.chattiness = 0
            storage_after_t1.save_character("broken-compass", char)
        elif char.id == "isolde":
            char.baked = True
            storage_after_t1.save_character("broken-compass", char)
    return storage_after_t1


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
            rng=random.Random(1234),
        )
        # intention + narration + intention(brunolf) + dialog(brunolf) + narration = 5
        assert len(messages) == 5

    async def test_message_sequence(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
            rng=random.Random(1234),
        )
        assert [(m.seq, m.owner, m.type) for m in messages] == [
            (1, "aldric",   "intention"),
            (2, "narrator", "narration"),
            (3, "brunolf",  "intention"),  # from cue intention field
            (4, "brunolf",  "dialog"),
            (5, "narrator", "narration"),
        ]

    async def test_all_turn_id_1(self, storage: Storage, stub_t1: StubLLM) -> None:
        messages = await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
            rng=random.Random(1234),
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
        )
        assert len(storage.get_messages("broken-compass")) == 5

    async def test_no_lore_after_turn1(
        self, storage: Storage, stub_t1: StubLLM
    ) -> None:
        await run_turn(
            storage=storage,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
            rng=random.Random(1234),
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
        )
        assert [(m.seq, m.owner, m.type) for m in messages] == [
            (6,  "aldric",   "intention"),
            (7,  "narrator", "narration"),
            (8,  "aldric",   "dialog"),    # persona_verbatim
            (9,  "narrator", "narration"),
            (10, "brunolf",  "intention"), # cue 1 intention
            (11, "brunolf",  "dialog"),    # cue 1 dialog
            (12, "narrator", "narration"),
            (13, "brunolf",  "intention"), # cue 2 intention
            (14, "brunolf",  "dialog"),    # cue 2 dialog
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
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
            rng=random.Random(1234),
        )
        types = [m.type for m in messages]
        # narration must appear between the two brunolf dialog messages
        brunolf_dialog_idxs = [
            i for i, m in enumerate(messages)
            if m.owner == "brunolf" and m.type == "dialog"
        ]
        assert brunolf_dialog_idxs[1] - brunolf_dialog_idxs[0] > 1, (
            "Expected narration (and an intention) between the two Brunolf dialog messages"
        )
        assert types[brunolf_dialog_idxs[0] + 1] == "narration"

    async def test_lore_entry_created(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
            rng=random.Random(1234),
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
            rng=random.Random(1234),
        )
        # 5 from turn 1 + 9 from turn 2
        assert len(storage_after_t1.get_messages("broken-compass")) == 14

    async def test_brunolf_state_applied(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
            rng=random.Random(1234),
        )
        chars = storage_after_t1.get_characters("broken-compass")
        brunolf = next(c for c in chars if c.id == "brunolf")
        cautious = next(s for s in brunolf.states if s["label"] == "Cautious")
        assert cautious["value"] == 3
        assert cautious["category"] == "temporal"

    async def test_all_llm_responses_consumed(
        self, storage_after_t1: Storage, stub_t2: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t1,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
            rng=random.Random(1234),
        )
        stub_t2.assert_exhausted()


# ---------------------------------------------------------------------------
# Turn 3 tests
# ---------------------------------------------------------------------------

class TestTurn3:
    """Aldric sits quietly; Isolde (baked) approaches and makes her pitch."""

    async def test_isolde_intention_in_stream(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        assert any(m.owner == "isolde" and m.type == "intention" for m in messages)

    async def test_isolde_dialog_in_stream(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        isolde_lines = [m for m in messages if m.owner == "isolde" and m.type == "dialog"]
        assert len(isolde_lines) == 2
        assert isolde_lines[0].content == ISOLDE_DIALOG_A
        assert isolde_lines[1].content == ISOLDE_DIALOG_B
        assert isolde_lines[0].mood == "desperate"

    async def test_isolde_state_applied(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        chars = storage_after_t2.get_characters("broken-compass")
        isolde = next(c for c in chars if c.id == "isolde")
        frightened = next(s for s in isolde.states if s["label"] == "Frightened")
        assert frightened["value"] == 6

    async def test_brunolf_does_not_activate(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        brunolf_intentions = [
            m for m in messages if m.owner == "brunolf" and m.type == "intention"
        ]
        assert brunolf_intentions == []

    async def test_message_count(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        messages = await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        # player: intention + narration = 2
        # isolde round: intention(npc_intent) + narration + intention(cue1) + dialog(cue1)
        #               + narration + intention(cue2) + dialog(cue2) = 7
        assert len(messages) == 9

    async def test_all_llm_responses_consumed(
        self, storage_after_t2: Storage, stub_t3: StubLLM
    ) -> None:
        await run_turn(
            storage=storage_after_t2,
            adventure_slug="broken-compass",
            persona_id="aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
        )
        stub_t3.assert_exhausted()
