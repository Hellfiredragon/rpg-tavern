"""Medieval Tavern Stream — Pipeline Integration Test

Replays the adventure from tests/resources/medieval_tavern_stream.json
through the pipeline, stubbing all LLM calls with predetermined responses
derived from the fixture data.

Turn 1 — Aldric enters. Brunolf and Theron activate as NPCs.
Turn 2 — Aldric sizes up Theron. Theron and Maren activate (Maren waits).
Turn 3 — Aldric accepts the deal. Brunolf and Maren activate.
"""

import json
import random
from pathlib import Path

import pytest

from rpg_tavern.models import Character, Persona
from rpg_tavern.pipeline.orchestrator import run_turn
from rpg_tavern.storage import Storage

# ---------------------------------------------------------------------------
# Load fixture data
# ---------------------------------------------------------------------------

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "resources" / "medieval_tavern_stream.json"
)

with open(FIXTURE_PATH) as _f:
    STREAM = json.load(_f)


def _msg(turn_id: int, seq: int) -> dict:
    """Look up a single message from the fixture by turn_id + seq."""
    for m in STREAM["messages"]:
        if m["turn_id"] == turn_id and m["seq"] == seq:
            return m
    raise KeyError(f"No message at t{turn_id}·s{seq}")


def _content(turn_id: int, seq: int) -> str:
    return _msg(turn_id, seq)["content"]


# ---------------------------------------------------------------------------
# StubLLM — deterministic LLM stand-in (same pattern as test_broken_compass)
# ---------------------------------------------------------------------------

class StubLLM:
    def __init__(self, responses: dict[str, list[str]]) -> None:
        self._queues: dict[str, list[str]] = {k: list(v) for k, v in responses.items()}
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, stage: str, prompt: str) -> str:
        self.calls.append((stage, prompt))
        queue = self._queues.get(stage)
        if not queue:
            raise AssertionError(
                f"StubLLM: unexpected call to stage={stage!r} "
                f"(no responses queued). calls so far: {len(self.calls)}"
            )
        return queue.pop(0)

    def assert_exhausted(self) -> None:
        leftover = {k: v for k, v in self._queues.items() if v}
        if leftover:
            stages = ", ".join(f"{k}({len(v)})" for k, v in leftover.items())
            raise AssertionError(f"StubLLM: unused responses remain: {stages}")


# ---------------------------------------------------------------------------
# Extractor helpers — current model uses {"state_changes": [...]}
# ---------------------------------------------------------------------------

EXTRACTOR_EMPTY = json.dumps({"state_changes": []})
LORE_EMPTY = json.dumps({"entries": []})

LORE_T2_THERON = json.dumps({"entries": [
    {"key": "greymount_pass", "content": "Eastern pass closed by rockslide. Goat trail exists via fog line."},
    {"key": "kaels_reach", "content": "Monastery north of Greymount. Aldric carries a letter there."},
]})

LORE_T3_BRUNOLF = json.dumps({"entries": [
    {"key": "thornfield", "content": "Dead village abandoned after the blight, not truly empty. Connected to Harsk's people."},
]})

LORE_T3_MAREN = json.dumps({"entries": [
    {"key": "maren_offer", "content": "Elven herbalist Maren offers healing skills in exchange for passage to Kael's Reach."},
]})


# ---------------------------------------------------------------------------
# Player intentions (from JSON)
# ---------------------------------------------------------------------------

INTENTION_T1 = _content(1, 0)
INTENTION_T2 = _content(2, 0)
INTENTION_T3 = _content(3, 0)


# ---------------------------------------------------------------------------
# Beat scripts — built from the fixture's narration and dialog messages
# ---------------------------------------------------------------------------

# -- Turn 1 ----------------------------------------------------------------

NARRATOR_T1_PERSONA = json.dumps([
    {"type": "narration", "content": _content(1, 2)},
    {"type": "persona_verbatim", "mood": "weary", "content": _content(1, 3)},
    {"type": "narration", "content": _content(1, 4)},
])

NARRATOR_T1_BRUNOLF = json.dumps([
    {"type": "narration", "content": _content(1, 8)},
    {"type": "cue", "character": "Brunolf", "mood": "guarded",
     "context": "Stranger asks about Greymount crossing."},
    {"type": "narration", "content": _content(1, 10)},
])

NARRATOR_T1_THERON = json.dumps([
    {"type": "narration", "content": _content(1, 14)},
    {"type": "cue", "character": "Theron", "mood": "calculating",
     "context": "Theron overhears talk of Greymount and offers his knowledge."},
])

# -- Turn 2 ----------------------------------------------------------------

NARRATOR_T2_PERSONA = json.dumps([
    {"type": "narration", "content": _content(2, 2)},
    {"type": "persona_verbatim", "mood": "measured", "content": _content(2, 3)},
    {"type": "narration", "content": _content(2, 4)},
])

NARRATOR_T2_THERON = json.dumps([
    {"type": "narration", "content": _content(2, 8)},
    {"type": "cue", "character": "Theron", "mood": "amused",
     "context": "Theron names his price for the crossing."},
    {"type": "narration", "content": _content(2, 10)},
    {"type": "cue", "character": "Theron", "mood": "businesslike",
     "context": "Theron proposes departure at first light."},
    {"type": "narration", "content": _content(2, 12)},
])

NARRATOR_T2_MAREN = json.dumps([
    {"type": "narration", "content": _content(2, 16)},
])

# -- Turn 3 ----------------------------------------------------------------

NARRATOR_T3_PERSONA = json.dumps([
    {"type": "narration", "content": _content(3, 2)},
    {"type": "persona_verbatim", "mood": "casual", "content": _content(3, 3)},
    {"type": "narration", "content": _content(3, 4)},
])

NARRATOR_T3_BRUNOLF = json.dumps([
    {"type": "narration", "content": _content(3, 8)},
    {"type": "cue", "character": "Brunolf", "mood": "matter-of-fact",
     "context": "Brunolf gives the room and drops a warning about Thornfield."},
    {"type": "narration", "content": _content(3, 10)},
])

NARRATOR_T3_MAREN = json.dumps([
    {"type": "narration", "content": _content(3, 14)},
    {"type": "cue", "character": "Maren", "mood": "quiet",
     "context": "Maren warns Aldric about Thornfield."},
    {"type": "narration", "content": _content(3, 16)},
    {"type": "cue", "character": "Maren", "mood": "earnest",
     "context": "Maren offers her skills as a second companion."},
])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SLUG = "the-broken-compass"


@pytest.fixture
def storage(tmp_path) -> Storage:
    s = Storage(tmp_path)
    s.create_adventure(
        slug=SLUG,
        title="The Broken Compass",
        setting=(
            "The Broken Compass — a stone-walled tavern on the crossroads "
            "of the King's Road. Rain hammers the shutters."
        ),
    )
    # Order: Brunolf, Theron, Maren — controls NPC activation order
    for char_data in [
        STREAM["characters"][0],  # Brunolf
        STREAM["characters"][2],  # Theron
        STREAM["characters"][1],  # Maren
    ]:
        s.save_character(
            SLUG,
            Character(
                id=char_data["name"],
                name=char_data["name"],
                description=char_data["description"],
                chattiness=char_data["chattiness"],
                baked=char_data.get("baked", False),
            ),
        )
    s.save_persona(
        SLUG,
        Persona(
            id=STREAM["active_persona"],
            name=STREAM["player_name"],
            description="A road-weary traveller carrying a letter to Kael's Reach.",
        ),
    )
    return s


def _rng_t1() -> random.Random:
    """Seed where Maren (chat=45) does NOT activate.

    Brunolf is baked → auto. Rolls: Theron (chat=60) must pass, Maren must fail.
    Since stored order is [Brunolf, Theron, Maren] and Brunolf is baked,
    the rng rolls are: Theron first, Maren second.
    """
    # Find a valid seed
    for seed in range(1000):
        rng = random.Random(seed)
        theron_roll = rng.randint(0, 100)
        maren_roll = rng.randint(0, 100)
        if theron_roll < 60 and maren_roll >= 45:
            return random.Random(seed)
    raise RuntimeError("No valid seed found for Turn 1")


@pytest.fixture
def stub_t1() -> StubLLM:
    return StubLLM({
        "narrator": [NARRATOR_T1_PERSONA, NARRATOR_T1_BRUNOLF, NARRATOR_T1_THERON],
        "npc_intent": [_content(1, 6), _content(1, 12)],
        "character_dialog": [_content(1, 9), _content(1, 15)],
        "persona_extractor": [EXTRACTOR_EMPTY],
        "character_extractor": [EXTRACTOR_EMPTY, EXTRACTOR_EMPTY],
        "lore_extractor": [LORE_EMPTY, LORE_EMPTY, LORE_EMPTY],
    })


@pytest.fixture
async def storage_after_t1(storage: Storage, stub_t1: StubLLM) -> Storage:
    await run_turn(
        storage=storage,
        adventure_slug=SLUG,
        persona_id="Aldric",
        intention=INTENTION_T1,
        llm=stub_t1,
        rng=_rng_t1(),
    )
    # Turn 2: Brunolf should NOT activate, Theron + Maren should.
    # Set Brunolf non-baked with chattiness=0; set Maren baked to guarantee activation.
    chars = storage.get_characters(SLUG)
    for char in chars:
        if char.id == "Brunolf":
            char.baked = False
            char.chattiness = 0
            storage.save_character(SLUG, char)
        elif char.id == "Maren":
            char.baked = True
            storage.save_character(SLUG, char)
    return storage


@pytest.fixture
def stub_t2() -> StubLLM:
    return StubLLM({
        "narrator": [NARRATOR_T2_PERSONA, NARRATOR_T2_THERON, NARRATOR_T2_MAREN],
        "npc_intent": [_content(2, 6), _content(2, 14)],
        "character_dialog": [_content(2, 9), _content(2, 11)],
        "persona_extractor": [EXTRACTOR_EMPTY],
        "character_extractor": [EXTRACTOR_EMPTY],  # Theron only (Maren doesn't speak)
        "lore_extractor": [LORE_EMPTY, LORE_T2_THERON, LORE_EMPTY],
    })


def _rng_t2() -> random.Random:
    """Seed where Theron (chat=60) activates.

    Brunolf has chattiness=0 (always fails, but still rolls).
    Theron must pass (< 60). Maren is baked → auto (no roll).
    Rolls: Brunolf first (wasted), Theron second.
    """
    for seed in range(1000):
        rng = random.Random(seed)
        _brunolf = rng.randint(0, 100)  # consumed but always fails
        theron_roll = rng.randint(0, 100)
        if theron_roll < 60:
            return random.Random(seed)
    raise RuntimeError("No valid seed found for Turn 2")


@pytest.fixture
async def storage_after_t2(
    storage_after_t1: Storage, stub_t2: StubLLM
) -> Storage:
    await run_turn(
        storage=storage_after_t1,
        adventure_slug=SLUG,
        persona_id="Aldric",
        intention=INTENTION_T2,
        llm=stub_t2,
        rng=_rng_t2(),
    )
    # Turn 3: Brunolf + Maren activate, Theron does not.
    chars = storage_after_t1.get_characters(SLUG)
    for char in chars:
        if char.id == "Brunolf":
            char.baked = True
            char.chattiness = 80
            storage_after_t1.save_character(SLUG, char)
        elif char.id == "Theron":
            char.baked = False
            char.chattiness = 0
            storage_after_t1.save_character(SLUG, char)
        elif char.id == "Maren":
            char.baked = True
            storage_after_t1.save_character(SLUG, char)
    return storage_after_t1


@pytest.fixture
def stub_t3() -> StubLLM:
    return StubLLM({
        "narrator": [NARRATOR_T3_PERSONA, NARRATOR_T3_BRUNOLF, NARRATOR_T3_MAREN],
        "npc_intent": [_content(3, 6), _content(3, 12)],
        "character_dialog": [_content(3, 9), _content(3, 15), _content(3, 17)],
        "persona_extractor": [EXTRACTOR_EMPTY],
        "character_extractor": [EXTRACTOR_EMPTY, EXTRACTOR_EMPTY],
        "lore_extractor": [LORE_EMPTY, LORE_T3_BRUNOLF, LORE_T3_MAREN],
    })


# ---------------------------------------------------------------------------
# Turn 1 — Aldric enters the tavern
# ---------------------------------------------------------------------------

class TestTurn1:
    """Aldric enters. Brunolf and Theron each take an NPC turn."""

    async def _run(self, storage, stub_t1):
        return await run_turn(
            storage=storage,
            adventure_slug=SLUG,
            persona_id="Aldric",
            intention=INTENTION_T1,
            llm=stub_t1,
            rng=_rng_t1(),
        )

    async def test_message_count(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        # persona: intention + 2 narrations + 1 dialog = 4
        # brunolf NPC: intention + 2 narrations + 1 dialog = 4
        # theron NPC: intention + 1 narration + 1 dialog = 3
        assert len(messages) == 11

    async def test_message_sequence(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        actual = [(m.owner, m.type) for m in messages]
        assert actual == [
            ("Aldric",   "intention"),
            ("narrator", "narration"),    # Aldric enters
            ("Aldric",   "dialog"),       # persona_verbatim
            ("narrator", "narration"),    # Brunolf reacts
            # -- Brunolf NPC turn --
            ("Brunolf",  "intention"),
            ("narrator", "narration"),    # pours ale
            ("Brunolf",  "dialog"),
            ("narrator", "narration"),    # slides mug
            # -- Theron NPC turn --
            ("Theron",   "intention"),
            ("narrator", "narration"),    # tilts forward
            ("Theron",   "dialog"),
        ]

    async def test_all_turn_id_1(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        assert all(m.turn_id == 1 for m in messages)

    async def test_seq_continuity(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        seqs = [m.seq for m in messages]
        assert seqs == list(range(1, 12))

    async def test_persona_verbatim_content(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        dialog = next(m for m in messages if m.owner == "Aldric" and m.type == "dialog")
        assert dialog.content == _content(1, 3)
        assert dialog.mood == "weary"

    async def test_brunolf_dialog(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        dialog = next(m for m in messages if m.owner == "Brunolf" and m.type == "dialog")
        assert dialog.content == _content(1, 9)
        assert dialog.mood == "guarded"

    async def test_theron_dialog(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        dialog = next(m for m in messages if m.owner == "Theron" and m.type == "dialog")
        assert dialog.content == _content(1, 15)
        assert dialog.mood == "calculating"

    async def test_maren_does_not_activate(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        assert not any(m.owner == "Maren" for m in messages)

    async def test_narration_content_matches_fixture(self, storage, stub_t1):
        messages = await self._run(storage, stub_t1)
        narrations = [m.content for m in messages if m.type == "narration"]
        assert narrations == [
            _content(1, 2),   # Aldric enters
            _content(1, 4),   # Brunolf reacts
            _content(1, 8),   # dwarf pours
            _content(1, 10),  # slides mug
            _content(1, 14),  # Theron tilts
        ]

    async def test_all_llm_responses_consumed(self, storage, stub_t1):
        await self._run(storage, stub_t1)
        stub_t1.assert_exhausted()

    async def test_messages_persisted(self, storage, stub_t1):
        await self._run(storage, stub_t1)
        assert len(storage.get_messages(SLUG)) == 11


# ---------------------------------------------------------------------------
# Turn 2 — Aldric sizes up Theron; Theron names his price; Maren waits
# ---------------------------------------------------------------------------

class TestTurn2:
    """Theron speaks twice. Maren's NPC turn resolves as silent observation."""

    async def _run(self, storage_after_t1, stub_t2):
        return await run_turn(
            storage=storage_after_t1,
            adventure_slug=SLUG,
            persona_id="Aldric",
            intention=INTENTION_T2,
            llm=stub_t2,
            rng=_rng_t2(),
        )

    async def test_message_count(self, storage_after_t1, stub_t2):
        messages = await self._run(storage_after_t1, stub_t2)
        # persona: intention + 2 narrations + 1 dialog = 4
        # theron NPC: intention + 3 narrations + 2 dialogs = 6
        # maren NPC: intention + 1 narration = 2
        assert len(messages) == 12

    async def test_message_sequence(self, storage_after_t1, stub_t2):
        messages = await self._run(storage_after_t1, stub_t2)
        actual = [(m.owner, m.type) for m in messages]
        assert actual == [
            ("Aldric",   "intention"),
            ("narrator", "narration"),    # Aldric lifts mug
            ("Aldric",   "dialog"),       # persona_verbatim
            ("narrator", "narration"),    # Theron twitches
            # -- Theron NPC turn --
            ("Theron",   "intention"),
            ("narrator", "narration"),    # sets down cup
            ("Theron",   "dialog"),       # names price
            ("narrator", "narration"),    # rises
            ("Theron",   "dialog"),       # first light
            ("narrator", "narration"),    # Brunolf grunts
            # -- Maren NPC turn --
            ("Maren",    "intention"),
            ("narrator", "narration"),    # resumes sorting
        ]

    async def test_theron_two_dialogs(self, storage_after_t1, stub_t2):
        messages = await self._run(storage_after_t1, stub_t2)
        theron_lines = [m for m in messages if m.owner == "Theron" and m.type == "dialog"]
        assert len(theron_lines) == 2
        assert theron_lines[0].content == _content(2, 9)
        assert theron_lines[0].mood == "amused"
        assert theron_lines[1].content == _content(2, 11)
        assert theron_lines[1].mood == "businesslike"

    async def test_maren_silent_turn(self, storage_after_t1, stub_t2):
        """Maren's NPC turn produces only an intention + narration, no dialog."""
        messages = await self._run(storage_after_t1, stub_t2)
        maren_msgs = [m for m in messages if m.owner == "Maren"]
        assert len(maren_msgs) == 1
        assert maren_msgs[0].type == "intention"

    async def test_cumulative_message_count(self, storage_after_t1, stub_t2):
        await self._run(storage_after_t1, stub_t2)
        # 11 from turn 1 + 12 from turn 2
        assert len(storage_after_t1.get_messages(SLUG)) == 23

    async def test_lore_entries_created(self, storage_after_t1, stub_t2):
        await self._run(storage_after_t1, stub_t2)
        lorebook = storage_after_t1.get_lorebook(SLUG)
        keys = {e["key"] for e in lorebook}
        assert "greymount_pass" in keys
        assert "kaels_reach" in keys

    async def test_all_llm_responses_consumed(self, storage_after_t1, stub_t2):
        await self._run(storage_after_t1, stub_t2)
        stub_t2.assert_exhausted()


# ---------------------------------------------------------------------------
# Turn 3 — Aldric accepts the deal; Brunolf warns; Maren offers passage
# ---------------------------------------------------------------------------

class TestTurn3:
    """Brunolf warns about Thornfield. Maren approaches with two lines."""

    async def _run(self, storage_after_t2, stub_t3):
        return await run_turn(
            storage=storage_after_t2,
            adventure_slug=SLUG,
            persona_id="Aldric",
            intention=INTENTION_T3,
            llm=stub_t3,
            rng=random.Random(0),  # Brunolf + Maren baked; Theron chat=0 → no rolls matter
        )

    async def test_message_count(self, storage_after_t2, stub_t3):
        messages = await self._run(storage_after_t2, stub_t3)
        # persona: intention + 2 narrations + 1 dialog = 4
        # brunolf NPC: intention + 2 narrations + 1 dialog = 4
        # maren NPC: intention + 2 narrations + 2 dialogs = 5
        assert len(messages) == 13

    async def test_message_sequence(self, storage_after_t2, stub_t3):
        messages = await self._run(storage_after_t2, stub_t3)
        actual = [(m.owner, m.type) for m in messages]
        assert actual == [
            ("Aldric",   "intention"),
            ("narrator", "narration"),    # handshake
            ("Aldric",   "dialog"),       # persona_verbatim
            ("narrator", "narration"),    # Brunolf thumb
            # -- Brunolf NPC turn --
            ("Brunolf",  "intention"),
            ("narrator", "narration"),    # ladles stew
            ("Brunolf",  "dialog"),       # warning
            ("narrator", "narration"),    # Aldric sits
            # -- Maren NPC turn --
            ("Maren",    "intention"),
            ("narrator", "narration"),    # approaches
            ("Maren",    "dialog"),       # Thornfield warning
            ("narrator", "narration"),    # doesn't sit
            ("Maren",    "dialog"),       # offers passage
        ]

    async def test_brunolf_dialog(self, storage_after_t2, stub_t3):
        messages = await self._run(storage_after_t2, stub_t3)
        dialog = next(m for m in messages if m.owner == "Brunolf" and m.type == "dialog")
        assert dialog.content == _content(3, 9)
        assert dialog.mood == "matter-of-fact"

    async def test_maren_two_dialogs(self, storage_after_t2, stub_t3):
        messages = await self._run(storage_after_t2, stub_t3)
        maren_lines = [m for m in messages if m.owner == "Maren" and m.type == "dialog"]
        assert len(maren_lines) == 2
        assert maren_lines[0].content == _content(3, 15)
        assert maren_lines[0].mood == "quiet"
        assert maren_lines[1].content == _content(3, 17)
        assert maren_lines[1].mood == "earnest"

    async def test_theron_does_not_activate(self, storage_after_t2, stub_t3):
        messages = await self._run(storage_after_t2, stub_t3)
        theron_msgs = [m for m in messages if m.owner == "Theron"]
        assert theron_msgs == []

    async def test_cumulative_message_count(self, storage_after_t2, stub_t3):
        await self._run(storage_after_t2, stub_t3)
        # 11 + 12 + 13 = 36
        assert len(storage_after_t2.get_messages(SLUG)) == 36

    async def test_lore_entries_accumulated(self, storage_after_t2, stub_t3):
        await self._run(storage_after_t2, stub_t3)
        lorebook = storage_after_t2.get_lorebook(SLUG)
        keys = {e["key"] for e in lorebook}
        # From T2 + T3
        assert "greymount_pass" in keys
        assert "thornfield" in keys
        assert "maren_offer" in keys

    async def test_all_llm_responses_consumed(self, storage_after_t2, stub_t3):
        await self._run(storage_after_t2, stub_t3)
        stub_t3.assert_exhausted()

    async def test_full_adventure_narration_matches_fixture(
        self, storage_after_t2, stub_t3
    ):
        """Every narration message across all 3 turns matches the fixture content."""
        await self._run(storage_after_t2, stub_t3)
        all_msgs = storage_after_t2.get_messages(SLUG)
        narrations = [m.content for m in all_msgs if m.type == "narration"]
        expected = [
            m["content"]
            for m in STREAM["messages"]
            if m["type"] == "narration" and m["turn_id"] >= 1
        ]
        assert narrations == expected
