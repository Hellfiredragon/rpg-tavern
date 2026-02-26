"""Medieval Tavern — Pipeline Integration Test

Reads the adventure from tests/resources/medieval_tavern_stream.json as its
baseline.  Each line of the scenario corresponds to one message in the stream,
annotated with how it was produced.

Turn 1 — Aldric enters.  Brunolf and Theron activate.
Turn 2 — Aldric sizes up Theron.  Theron speaks twice; Maren watches silently.
Turn 3 — Aldric accepts the deal.  Brunolf warns; Maren offers passage.
"""

import json
from pathlib import Path

import pytest

from rpg_tavern.storage import Storage
from tests.utils.scenario import Scenario

# ---------------------------------------------------------------------------
# Fixture data
# ---------------------------------------------------------------------------

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "resources" / "medieval_tavern_stream.json"
)

with open(FIXTURE_PATH) as _f:
    STREAM = json.load(_f)

SLUG = STREAM["adventure"]["slug"]


def _msg(turn_id: int, seq: int) -> dict:
    for m in STREAM["messages"]:
        if m["turn_id"] == turn_id and m["seq"] == seq:
            return m
    raise KeyError(f"No message at t{turn_id}·s{seq}")


def _c(turn_id: int, seq: int) -> str:
    """Return the content of the fixture message at (turn_id, seq)."""
    return _msg(turn_id, seq)["content"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestMedievalTavern:

    async def test_turn_1(self, storage: Storage) -> None:
        """Aldric enters.  Brunolf (baked) and Theron (roll passes) activate."""
        s = Scenario(storage, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(_c(1, 0))
        s.narrate(_c(1, 2))                                    # Aldric enters
        s.persona_says(_c(1, 3), mood="weary")                 # verbatim — no LLM
        s.narrate(_c(1, 4))                                    # Brunolf reacts
        s.persona_extractor(amplify=["determination", "road-weariness"])
        s.lore()

        # ── Brunolf NPC round ────────────────────────────────────────────────
        s.npc_intent("Brunolf", _c(1, 6))
        s.narrate(_c(1, 8))                                    # dwarf draws mug
        s.npc_says("Brunolf", _c(1, 9), mood="guarded",
                   context="Stranger asks about Greymount crossing.")
        s.narrate(_c(1, 10))                                   # slides mug across
        s.npc_extractor("Brunolf", amplify=["caution toward strangers",
                                            "protectiveness of guests"])
        s.lore()

        # ── Theron NPC round ─────────────────────────────────────────────────
        s.npc_intent("Theron", _c(1, 12))
        s.narrate(_c(1, 14))                                   # tilts forward
        s.npc_says("Theron", _c(1, 15), mood="calculating",
                   context="Theron overhears talk of Greymount and offers his knowledge.")
        s.npc_extractor("Theron", amplify=["opportunity sensing"])
        s.lore()

        await s.run_turn()

    async def test_turn_2(self, storage_after_t1: Storage) -> None:
        """Aldric sizes up Theron.  Theron names his price twice; Maren watches."""
        s = Scenario(storage_after_t1, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(_c(2, 0))
        s.narrate(_c(2, 2))                                    # Aldric drinks, turns
        s.persona_says(_c(2, 3), mood="measured")              # verbatim
        s.narrate(_c(2, 4))                                    # Theron twitches
        s.persona_extractor(amplify=["curiosity", "assessment"])
        s.lore()

        # ── Theron NPC round (two cues) ──────────────────────────────────────
        s.npc_intent("Theron", _c(2, 6))
        s.narrate(_c(2, 8))                                    # sets down cup
        s.npc_says("Theron", _c(2, 9), mood="amused",
                   context="Theron names his price for the crossing.")
        s.narrate(_c(2, 10))                                   # rises
        s.npc_says("Theron", _c(2, 11), mood="businesslike",
                   context="Theron proposes departure at first light.")
        s.narrate(_c(2, 12))                                   # Brunolf grunts
        s.npc_extractor("Theron", amplify=["opportunity sensing",
                                           "self-serving calculation"])
        s.lore(
            greymount_pass="Eastern pass closed by rockslide. Goat trail exists via fog line.",
            kaels_reach="Monastery north of Greymount. Aldric carries a letter there.",
        )

        # ── Maren NPC round (silent observation — narration only) ────────────
        s.npc_intent("Maren", _c(2, 14))
        s.narrate(_c(2, 16))                                   # resumes sorting
        s.npc_extractor("Maren", amplify=["wariness of dangerous men"])
        s.lore()

        await s.run_turn()

    async def test_turn_3(self, storage_after_t2: Storage) -> None:
        """Aldric shakes on the deal.  Brunolf warns; Maren offers passage."""
        s = Scenario(storage_after_t2, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(_c(3, 0))
        s.narrate(_c(3, 2))                                    # handshake
        s.persona_says(_c(3, 3), mood="casual")                # verbatim
        s.narrate(_c(3, 4))                                    # Brunolf jerks thumb
        s.persona_extractor(amplify=["commitment", "forward planning"])
        s.lore()

        # ── Brunolf NPC round ────────────────────────────────────────────────
        s.npc_intent("Brunolf", _c(3, 6))
        s.narrate(_c(3, 8))                                    # ladles stew
        s.npc_says("Brunolf", _c(3, 9), mood="matter-of-fact",
                   context="Brunolf gives the room and drops a warning about Thornfield.")
        s.narrate(_c(3, 10))                                   # Aldric takes bowl
        s.npc_extractor("Brunolf", amplify=["protectiveness of guests"])
        s.lore(
            thornfield=(
                "Dead village abandoned after the blight, not truly empty. "
                "Connected to Harsk's people."
            ),
        )

        # ── Maren NPC round (two cues) ───────────────────────────────────────
        s.npc_intent("Maren", _c(3, 12))
        s.narrate(_c(3, 14))                                   # approaches
        s.npc_says("Maren", _c(3, 15), mood="quiet",
                   context="Maren warns Aldric about Thornfield.")
        s.narrate(_c(3, 16))                                   # doesn't sit
        s.npc_says("Maren", _c(3, 17), mood="earnest",
                   context="Maren offers her skills as a second companion.")
        s.npc_extractor("Maren", amplify=["wariness of dangerous men",
                                          "need for blackthorn root"])
        s.lore(
            maren_offer=(
                "Elven herbalist Maren offers healing skills in exchange "
                "for passage to Kael's Reach."
            ),
        )

        await s.run_turn()

    async def test_cumulative_message_count(
        self, storage_after_t2: Storage
    ) -> None:
        """After turns 1+2, the stream has 23 messages; turn 3 adds 13 more."""
        s = Scenario(storage_after_t2, slug=SLUG, persona_id="Aldric")

        s.player_intent(_c(3, 0))
        s.narrate(_c(3, 2))
        s.persona_says(_c(3, 3), mood="casual")
        s.narrate(_c(3, 4))
        s.persona_extractor(amplify=["commitment", "forward planning"])
        s.lore()

        s.npc_intent("Brunolf", _c(3, 6))
        s.narrate(_c(3, 8))
        s.npc_says("Brunolf", _c(3, 9), mood="matter-of-fact",
                   context="Brunolf gives the room and drops a warning about Thornfield.")
        s.narrate(_c(3, 10))
        s.npc_extractor("Brunolf", amplify=["protectiveness of guests"])
        s.lore(thornfield="Dead village abandoned after the blight, not truly empty.")

        s.npc_intent("Maren", _c(3, 12))
        s.narrate(_c(3, 14))
        s.npc_says("Maren", _c(3, 15), mood="quiet",
                   context="Maren warns Aldric about Thornfield.")
        s.narrate(_c(3, 16))
        s.npc_says("Maren", _c(3, 17), mood="earnest",
                   context="Maren offers her skills as a second companion.")
        s.npc_extractor("Maren", amplify=["wariness of dangerous men",
                                          "need for blackthorn root"])
        s.lore(maren_offer="Elven herbalist Maren offers healing skills.")

        await s.run_turn()
        # 11 (T1) + 12 (T2) + 13 (T3) = 36
        assert len(storage_after_t2.get_messages(SLUG)) == 36

    async def test_full_narration_matches_fixture(
        self, storage_after_t2: Storage
    ) -> None:
        """Every narration message across all 3 turns matches the fixture."""
        s = Scenario(storage_after_t2, slug=SLUG, persona_id="Aldric")

        s.player_intent(_c(3, 0))
        s.narrate(_c(3, 2))
        s.persona_says(_c(3, 3), mood="casual")
        s.narrate(_c(3, 4))
        s.persona_extractor()
        s.lore()

        s.npc_intent("Brunolf", _c(3, 6))
        s.narrate(_c(3, 8))
        s.npc_says("Brunolf", _c(3, 9), mood="matter-of-fact",
                   context="Brunolf gives the room and drops a warning about Thornfield.")
        s.narrate(_c(3, 10))
        s.npc_extractor("Brunolf")
        s.lore()

        s.npc_intent("Maren", _c(3, 12))
        s.narrate(_c(3, 14))
        s.npc_says("Maren", _c(3, 15), mood="quiet",
                   context="Maren warns Aldric about Thornfield.")
        s.narrate(_c(3, 16))
        s.npc_says("Maren", _c(3, 17), mood="earnest",
                   context="Maren offers her skills as a second companion.")
        s.npc_extractor("Maren")
        s.lore()

        await s.run_turn()

        all_msgs = storage_after_t2.get_messages(SLUG)
        narrations = [m.content for m in all_msgs if m.type == "narration"]
        expected = [
            m["content"]
            for m in STREAM["messages"]
            if m["type"] == "narration" and m["turn_id"] >= 1
        ]
        assert narrations == expected


# ---------------------------------------------------------------------------
# Fixtures — sequential turn state
# ---------------------------------------------------------------------------

@pytest.fixture
async def storage_after_t1(storage: Storage) -> Storage:
    s = Scenario(storage, slug=SLUG, persona_id="Aldric")

    s.player_intent(_c(1, 0))
    s.narrate(_c(1, 2))
    s.persona_says(_c(1, 3), mood="weary")
    s.narrate(_c(1, 4))
    s.persona_extractor(amplify=["determination", "road-weariness"])
    s.lore()

    s.npc_intent("Brunolf", _c(1, 6))
    s.narrate(_c(1, 8))
    s.npc_says("Brunolf", _c(1, 9), mood="guarded",
               context="Stranger asks about Greymount crossing.")
    s.narrate(_c(1, 10))
    s.npc_extractor("Brunolf", amplify=["caution toward strangers",
                                        "protectiveness of guests"])
    s.lore()

    s.npc_intent("Theron", _c(1, 12))
    s.narrate(_c(1, 14))
    s.npc_says("Theron", _c(1, 15), mood="calculating",
               context="Theron overhears talk of Greymount and offers his knowledge.")
    s.npc_extractor("Theron", amplify=["opportunity sensing"])
    s.lore()

    await s.run_turn()
    return storage


@pytest.fixture
async def storage_after_t2(storage_after_t1: Storage) -> Storage:
    s = Scenario(storage_after_t1, slug=SLUG, persona_id="Aldric")

    s.player_intent(_c(2, 0))
    s.narrate(_c(2, 2))
    s.persona_says(_c(2, 3), mood="measured")
    s.narrate(_c(2, 4))
    s.persona_extractor(amplify=["curiosity", "assessment"])
    s.lore()

    s.npc_intent("Theron", _c(2, 6))
    s.narrate(_c(2, 8))
    s.npc_says("Theron", _c(2, 9), mood="amused",
               context="Theron names his price for the crossing.")
    s.narrate(_c(2, 10))
    s.npc_says("Theron", _c(2, 11), mood="businesslike",
               context="Theron proposes departure at first light.")
    s.narrate(_c(2, 12))
    s.npc_extractor("Theron", amplify=["opportunity sensing",
                                       "self-serving calculation"])
    s.lore(
        greymount_pass="Eastern pass closed by rockslide. Goat trail exists via fog line.",
        kaels_reach="Monastery north of Greymount. Aldric carries a letter there.",
    )

    s.npc_intent("Maren", _c(2, 14))
    s.narrate(_c(2, 16))
    s.npc_extractor("Maren", amplify=["wariness of dangerous men"])
    s.lore()

    await s.run_turn()
    return storage_after_t1
