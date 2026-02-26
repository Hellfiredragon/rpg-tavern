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
# Fixture data — kept for the narration baseline comparison only
# ---------------------------------------------------------------------------

_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "resources" / "medieval_tavern_stream.json"
)
with open(_FIXTURE_PATH) as _f:
    _STREAM = json.load(_f)

SLUG = _STREAM["adventure"]["slug"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestMedievalTavern:

    async def test_turn_1(self, storage: Storage) -> None:
        """Aldric enters.  Brunolf (baked) and Theron (roll passes) activate."""
        s = Scenario(storage, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(
            "I push through the door, shaking rain off my cloak, and walk to the bar. "
            "I set a silver piece on the counter."
        )
        s.narrate(
            "The door groans open. Aldric steps inside trailing a gust of wet wind that "
            "makes the candles flinch. Heads turn \u2014 a stranger in a road-worn cloak, mud "
            "to the knees. Aldric crosses to the bar, boots leaving dark prints on the "
            "flagstones, and sets a silver coin on the scarred oak with a quiet clink."
        )
        s.persona_says(
            "Ale, and whatever's hot. And I'll pay double if you can tell me how to "
            "cross the Greymount before the snows.",
            mood="weary",
        )
        s.narrate(
            "Brunolf's hand stops mid-wipe. His eyes \u2014 deep-set beneath craggy brows \u2014 "
            "fix on the coin, then on Aldric. A slow exhale through his nose."
        )
        s.persona_extractor(amplify=["determination", "road-weariness"])
        s.lore()

        # ── Brunolf NPC round ────────────────────────────────────────────────
        s.npc_intent(
            "Brunolf",
            "I'll pour him an ale and tell him the pass is closed — but I'm not the guide.",
        )
        s.narrate(
            "The dwarf reaches below the counter and draws up a clay mug, already "
            "filling it from the tap without looking."
        )
        s.npc_says(
            "Brunolf",
            "The eastern pass closed a tenday ago \u2014 rockslide. There's a goat trail the "
            "shepherds use, but you'd need someone who knows the fog line. I'm not that guide.",
            mood="guarded",
            context="Stranger asks about Greymount crossing.",
        )
        s.narrate(
            "Brunolf slides the mug across the bar. Foam sloshes over the rim. "
            "From the corner, the scrape of a chair."
        )
        s.npc_extractor("Brunolf", amplify=["caution toward strangers",
                                            "protectiveness of guests"])
        s.lore()

        # ── Theron NPC round ─────────────────────────────────────────────────
        s.npc_intent(
            "Theron",
            "I'll lean forward and let the stranger see I'm listening \u2014 I know the fog line.",
        )
        s.narrate(
            "Theron tilts forward, his hood shifting just enough to catch the firelight "
            "across a jaw rough with stubble. One boot drops from the chair rung to the "
            "floor \u2014 an unhurried announcement."
        )
        s.npc_says(
            "Theron",
            "I know the fog line. Done the crossing twice. What's on the other side "
            "that's worth freezing for?",
            mood="calculating",
            context="Theron overhears talk of Greymount and offers his knowledge.",
        )
        s.npc_extractor("Theron", amplify=["opportunity sensing"])
        s.lore()

        await s.run_turn()

    async def test_turn_2(self, storage_after_t1: Storage) -> None:
        """Aldric sizes up Theron.  Theron names his price twice; Maren watches."""
        s = Scenario(storage_after_t1, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(
            "I take a slow drink and turn to face Theron from the bar. "
            "I want to size him up before committing."
        )
        s.narrate(
            "Aldric lifts the mug, drinks \u2014 unhurried, deliberate \u2014 and turns on the "
            "stool to face the corner. The distance between them is a choice: close "
            "enough to talk, far enough to move. Aldric's hand rests on the bar, not "
            "on a weapon, but near one."
        )
        s.persona_says(
            "A letter that needs delivering to the monastery at Kael's Reach. "
            "Nothing worth stealing, if that's what you're weighing.",
            mood="measured",
        )
        s.narrate(
            "Theron's mouth twitches \u2014 not quite a smile. He rolls the empty cup "
            "between his palms."
        )
        s.persona_extractor(amplify=["curiosity", "assessment"])
        s.lore()

        # ── Theron NPC round (two cues) ──────────────────────────────────────
        s.npc_intent(
            "Theron",
            "I'll name a fair price \u2014 five to the trailhead, five at the ridge. "
            "Professional. No mention of Thornfield.",
        )
        s.narrate(
            "Theron sets down the cup and spreads his hands \u2014 an open gesture, palms "
            "up, the universal language of a man about to name a number."
        )
        s.npc_says(
            "Theron",
            "Five silver to the trailhead. Another five when we reach the ridge. "
            "You buy the supplies.",
            mood="amused",
            context="Theron names his price for the crossing.",
        )
        s.narrate(
            "Theron rises from the corner table in a single fluid motion \u2014 a fighter's "
            "economy, no wasted effort. The cloak falls open enough to show a short blade "
            "at his hip and the frayed edge of a leather map case. He crosses the room "
            "and extends a hand, palm up in the old traveller's greeting."
        )
        s.npc_says(
            "Theron",
            "First light. Six days' provisions \u2014 the trail doesn't forgive short rations.",
            mood="businesslike",
            context="Theron proposes departure at first light.",
        )
        s.narrate(
            "Brunolf grunts from behind the bar \u2014 neither endorsement nor warning, just "
            "acknowledgement. Across the room, Maren's hands have gone still over her "
            "herb pouches. She does not look up, but the sorting has stopped."
        )
        s.npc_extractor("Theron", amplify=["opportunity sensing",
                                           "self-serving calculation"])
        s.lore(
            greymount_pass="Eastern pass closed by rockslide. Goat trail exists via fog line.",
            kaels_reach="Monastery north of Greymount. Aldric carries a letter there.",
        )

        # ── Maren NPC round (silent observation — narration only) ────────────
        s.npc_intent(
            "Maren",
            "I'll wait until Theron sits back down, then offer my healing skills \u2014 "
            "and hint that his guide may not be trustworthy.",
        )
        s.narrate(
            "Maren resumes her sorting \u2014 but slower now, deliberate, the way someone "
            "moves when they are waiting rather than working. Her gaze lifts once to "
            "Aldric, brief and unreadable, before dropping back to the dried rosemary "
            "in her hand. She does not rise from her chair. Not yet."
        )
        s.npc_extractor("Maren", amplify=["wariness of dangerous men"])
        s.lore()

        await s.run_turn()

    async def test_turn_3(self, storage_after_t2: Storage) -> None:
        """Aldric shakes on the deal.  Brunolf warns; Maren offers passage."""
        s = Scenario(storage_after_t2, slug=SLUG, persona_id="Aldric")

        # ── Persona round ────────────────────────────────────────────────────
        s.player_intent(
            "I shake Theron's hand and agree to the terms. "
            "Then I ask Brunolf for a room and a bowl of stew."
        )
        s.narrate(
            "Aldric clasps Theron's hand \u2014 a brief, firm grip. The deal is made in the "
            "way of travellers: a word and a handshake, binding until one of them decides "
            "it isn't. Theron nods once and returns to his corner, folding back into "
            "shadow like he'd never left it."
        )
        s.persona_says("A room for the night. And a bowl of the stew, if there's any left.",
                       mood="casual")
        s.narrate("Brunolf jerks a thumb toward the stairs.")
        s.persona_extractor(amplify=["commitment", "forward planning"])
        s.lore()

        # ── Brunolf NPC round ────────────────────────────────────────────────
        s.npc_intent(
            "Brunolf",
            "I'll give him the room and stew, but drop a warning about Thornfield \u2014 "
            "just enough to keep his eyes open.",
        )
        s.narrate(
            "Brunolf ladles stew from a blackened pot into a chipped bowl and pushes "
            "it across the bar with a hunk of dark bread. His voice drops a register \u2014 "
            "not a whisper, but pitched for the near side of the bar."
        )
        s.npc_says(
            "Brunolf",
            "Second door up the stairs. Two coppers for the bed, stew's included. "
            "And lad \u2014 the goat trail runs past Thornfield. Know what that means before "
            "you trust a man you met over ale.",
            mood="matter-of-fact",
            context="Brunolf gives the room and drops a warning about Thornfield.",
        )
        s.narrate(
            "Aldric takes the bowl to a table against the back wall \u2014 stone at his "
            "shoulders, the whole room in front of him. The stew is thick, peppery, "
            "better than it looks. Rain keeps hammering. The fire pops and spits."
        )
        s.npc_extractor("Brunolf", amplify=["protectiveness of guests"])
        s.lore(
            thornfield=(
                "Dead village abandoned after the blight, not truly empty. "
                "Connected to Harsk's people."
            ),
        )

        # ── Maren NPC round (two cues) ───────────────────────────────────────
        s.npc_intent(
            "Maren",
            "I'll approach Aldric's table with my herb pouches and offer my skills "
            "as a second companion for the journey.",
        )
        s.narrate(
            "Maren rises from her table, gathering her pouches, and moves toward the "
            "back wall with the careful unhurried pace of someone who wants to seem "
            "incidental. She stops beside Aldric's table and sets a small cloth bundle "
            "down \u2014 dried willowbark and something that smells of mint. A healer's "
            "calling card."
        )
        s.npc_says(
            "Maren",
            "Brunolf's right. Thornfield is a dead village \u2014 but not empty. "
            "Theron knows people there. Not the kind who live in monasteries.",
            mood="quiet",
            context="Maren warns Aldric about Thornfield.",
        )
        s.narrate(
            "Maren does not sit down. Her voice is low enough that Theron, half a room "
            "away, would catch only murmur. Her scarred hand rests on the edge of the "
            "table \u2014 steady, unhurried."
        )
        s.npc_says(
            "Maren",
            "I'm heading north too. Field medicine, mountain herbs. A second companion "
            "who doesn't owe debts in Thornfield \u2014 for passage to Kael's Reach.",
            mood="earnest",
            context="Maren offers her skills as a second companion.",
        )
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

        s.player_intent("I shake Theron's hand and agree to the terms.")
        s.narrate(
            "Aldric clasps Theron's hand \u2014 a brief, firm grip. The deal is made in the "
            "way of travellers: a word and a handshake, binding until one of them decides "
            "it isn't. Theron nods once and returns to his corner, folding back into "
            "shadow like he'd never left it."
        )
        s.persona_says("A room for the night. And a bowl of the stew, if there's any left.",
                       mood="casual")
        s.narrate("Brunolf jerks a thumb toward the stairs.")
        s.persona_extractor(amplify=["commitment", "forward planning"])
        s.lore()

        s.npc_intent("Brunolf", "I'll give him the room and drop a warning about Thornfield.")
        s.narrate(
            "Brunolf ladles stew from a blackened pot into a chipped bowl and pushes "
            "it across the bar with a hunk of dark bread. His voice drops a register \u2014 "
            "not a whisper, but pitched for the near side of the bar."
        )
        s.npc_says(
            "Brunolf",
            "Second door up the stairs. Two coppers. And lad \u2014 the goat trail runs past "
            "Thornfield. Know what that means before you trust a man you met over ale.",
            mood="matter-of-fact",
            context="Brunolf gives the room and drops a warning about Thornfield.",
        )
        s.narrate(
            "Aldric takes the bowl to a table against the back wall \u2014 stone at his "
            "shoulders, the whole room in front of him. The stew is thick, peppery, "
            "better than it looks. Rain keeps hammering. The fire pops and spits."
        )
        s.npc_extractor("Brunolf", amplify=["protectiveness of guests"])
        s.lore(thornfield="Dead village abandoned after the blight, not truly empty.")

        s.npc_intent("Maren", "I'll approach and offer my skills as a second companion.")
        s.narrate(
            "Maren rises from her table, gathering her pouches, and moves toward the "
            "back wall with the careful unhurried pace of someone who wants to seem "
            "incidental. She stops beside Aldric's table and sets a small cloth bundle "
            "down \u2014 dried willowbark and something that smells of mint. A healer's "
            "calling card."
        )
        s.npc_says(
            "Maren",
            "Brunolf's right. Thornfield isn't empty. Theron knows people there.",
            mood="quiet",
            context="Maren warns Aldric about Thornfield.",
        )
        s.narrate(
            "Maren does not sit down. Her voice is low enough that Theron, half a room "
            "away, would catch only murmur. Her scarred hand rests on the edge of the "
            "table \u2014 steady, unhurried."
        )
        s.npc_says(
            "Maren",
            "I'm heading north too. Field medicine, mountain herbs. Passage to Kael's Reach.",
            mood="earnest",
            context="Maren offers her skills as a second companion.",
        )
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

        s.player_intent("I shake Theron's hand and agree to the terms.")
        s.narrate(
            "Aldric clasps Theron's hand \u2014 a brief, firm grip. The deal is made in the "
            "way of travellers: a word and a handshake, binding until one of them decides "
            "it isn't. Theron nods once and returns to his corner, folding back into "
            "shadow like he'd never left it."
        )
        s.persona_says("A room for the night. And a bowl of the stew, if there's any left.",
                       mood="casual")
        s.narrate("Brunolf jerks a thumb toward the stairs.")
        s.persona_extractor()
        s.lore()

        s.npc_intent("Brunolf", "I'll give him the room and drop a warning about Thornfield.")
        s.narrate(
            "Brunolf ladles stew from a blackened pot into a chipped bowl and pushes "
            "it across the bar with a hunk of dark bread. His voice drops a register \u2014 "
            "not a whisper, but pitched for the near side of the bar."
        )
        s.npc_says(
            "Brunolf",
            "Second door up the stairs. Two coppers for the bed, stew's included. "
            "And lad \u2014 the goat trail runs past Thornfield. Know what that means before "
            "you trust a man you met over ale.",
            mood="matter-of-fact",
            context="Brunolf gives the room and drops a warning about Thornfield.",
        )
        s.narrate(
            "Aldric takes the bowl to a table against the back wall \u2014 stone at his "
            "shoulders, the whole room in front of him. The stew is thick, peppery, "
            "better than it looks. Rain keeps hammering. The fire pops and spits."
        )
        s.npc_extractor("Brunolf")
        s.lore()

        s.npc_intent("Maren", "I'll approach and offer my skills as a second companion.")
        s.narrate(
            "Maren rises from her table, gathering her pouches, and moves toward the "
            "back wall with the careful unhurried pace of someone who wants to seem "
            "incidental. She stops beside Aldric's table and sets a small cloth bundle "
            "down \u2014 dried willowbark and something that smells of mint. A healer's "
            "calling card."
        )
        s.npc_says(
            "Maren",
            "Brunolf's right. Thornfield is a dead village \u2014 but not empty. "
            "Theron knows people there. Not the kind who live in monasteries.",
            mood="quiet",
            context="Maren warns Aldric about Thornfield.",
        )
        s.narrate(
            "Maren does not sit down. Her voice is low enough that Theron, half a room "
            "away, would catch only murmur. Her scarred hand rests on the edge of the "
            "table \u2014 steady, unhurried."
        )
        s.npc_says(
            "Maren",
            "I'm heading north too. Field medicine, mountain herbs. A second companion "
            "who doesn't owe debts in Thornfield \u2014 for passage to Kael's Reach.",
            mood="earnest",
            context="Maren offers her skills as a second companion.",
        )
        s.npc_extractor("Maren")
        s.lore()

        await s.run_turn()

        all_msgs = storage_after_t2.get_messages(SLUG)
        narrations = [m.content for m in all_msgs if m.type == "narration"]
        expected = [
            m["content"]
            for m in _STREAM["messages"]
            if m["type"] == "narration" and m["turn_id"] >= 1
        ]
        assert narrations == expected


# ---------------------------------------------------------------------------
# Fixtures — sequential turn state
# ---------------------------------------------------------------------------

@pytest.fixture
async def storage_after_t1(storage: Storage) -> Storage:
    s = Scenario(storage, slug=SLUG, persona_id="Aldric")

    s.player_intent(
        "I push through the door, shaking rain off my cloak, and walk to the bar. "
        "I set a silver piece on the counter."
    )
    s.narrate(
        "The door groans open. Aldric steps inside trailing a gust of wet wind that "
        "makes the candles flinch. Heads turn \u2014 a stranger in a road-worn cloak, mud "
        "to the knees. Aldric crosses to the bar, boots leaving dark prints on the "
        "flagstones, and sets a silver coin on the scarred oak with a quiet clink."
    )
    s.persona_says(
        "Ale, and whatever's hot. And I'll pay double if you can tell me how to "
        "cross the Greymount before the snows.",
        mood="weary",
    )
    s.narrate(
        "Brunolf's hand stops mid-wipe. His eyes \u2014 deep-set beneath craggy brows \u2014 "
        "fix on the coin, then on Aldric. A slow exhale through his nose."
    )
    s.persona_extractor(amplify=["determination", "road-weariness"])
    s.lore()

    s.npc_intent(
        "Brunolf",
        "I'll pour him an ale and tell him the pass is closed — but I'm not the guide.",
    )
    s.narrate(
        "The dwarf reaches below the counter and draws up a clay mug, already "
        "filling it from the tap without looking."
    )
    s.npc_says(
        "Brunolf",
        "The eastern pass closed a tenday ago \u2014 rockslide. There's a goat trail the "
        "shepherds use, but you'd need someone who knows the fog line. I'm not that guide.",
        mood="guarded",
        context="Stranger asks about Greymount crossing.",
    )
    s.narrate(
        "Brunolf slides the mug across the bar. Foam sloshes over the rim. "
        "From the corner, the scrape of a chair."
    )
    s.npc_extractor("Brunolf", amplify=["caution toward strangers",
                                        "protectiveness of guests"])
    s.lore()

    s.npc_intent(
        "Theron",
        "I'll lean forward and let the stranger see I'm listening \u2014 I know the fog line.",
    )
    s.narrate(
        "Theron tilts forward, his hood shifting just enough to catch the firelight "
        "across a jaw rough with stubble. One boot drops from the chair rung to the "
        "floor \u2014 an unhurried announcement."
    )
    s.npc_says(
        "Theron",
        "I know the fog line. Done the crossing twice. What's on the other side "
        "that's worth freezing for?",
        mood="calculating",
        context="Theron overhears talk of Greymount and offers his knowledge.",
    )
    s.npc_extractor("Theron", amplify=["opportunity sensing"])
    s.lore()

    await s.run_turn()
    return storage


@pytest.fixture
async def storage_after_t2(storage_after_t1: Storage) -> Storage:
    s = Scenario(storage_after_t1, slug=SLUG, persona_id="Aldric")

    s.player_intent(
        "I take a slow drink and turn to face Theron from the bar. "
        "I want to size him up before committing."
    )
    s.narrate(
        "Aldric lifts the mug, drinks \u2014 unhurried, deliberate \u2014 and turns on the "
        "stool to face the corner. The distance between them is a choice: close "
        "enough to talk, far enough to move. Aldric's hand rests on the bar, not "
        "on a weapon, but near one."
    )
    s.persona_says(
        "A letter that needs delivering to the monastery at Kael's Reach. "
        "Nothing worth stealing, if that's what you're weighing.",
        mood="measured",
    )
    s.narrate(
        "Theron's mouth twitches \u2014 not quite a smile. He rolls the empty cup "
        "between his palms."
    )
    s.persona_extractor(amplify=["curiosity", "assessment"])
    s.lore()

    s.npc_intent(
        "Theron",
        "I'll name a fair price \u2014 five to the trailhead, five at the ridge. "
        "Professional. No mention of Thornfield.",
    )
    s.narrate(
        "Theron sets down the cup and spreads his hands \u2014 an open gesture, palms "
        "up, the universal language of a man about to name a number."
    )
    s.npc_says(
        "Theron",
        "Five silver to the trailhead. Another five when we reach the ridge. "
        "You buy the supplies.",
        mood="amused",
        context="Theron names his price for the crossing.",
    )
    s.narrate(
        "Theron rises from the corner table in a single fluid motion \u2014 a fighter's "
        "economy, no wasted effort. The cloak falls open enough to show a short blade "
        "at his hip and the frayed edge of a leather map case. He crosses the room "
        "and extends a hand, palm up in the old traveller's greeting."
    )
    s.npc_says(
        "Theron",
        "First light. Six days' provisions \u2014 the trail doesn't forgive short rations.",
        mood="businesslike",
        context="Theron proposes departure at first light.",
    )
    s.narrate(
        "Brunolf grunts from behind the bar \u2014 neither endorsement nor warning, just "
        "acknowledgement. Across the room, Maren's hands have gone still over her "
        "herb pouches. She does not look up, but the sorting has stopped."
    )
    s.npc_extractor("Theron", amplify=["opportunity sensing",
                                       "self-serving calculation"])
    s.lore(
        greymount_pass="Eastern pass closed by rockslide. Goat trail exists via fog line.",
        kaels_reach="Monastery north of Greymount. Aldric carries a letter there.",
    )

    s.npc_intent(
        "Maren",
        "I'll wait until Theron sits back down, then offer my healing skills \u2014 "
        "and hint that his guide may not be trustworthy.",
    )
    s.narrate(
        "Maren resumes her sorting \u2014 but slower now, deliberate, the way someone "
        "moves when they are waiting rather than working. Her gaze lifts once to "
        "Aldric, brief and unreadable, before dropping back to the dried rosemary "
        "in her hand. She does not rise from her chair. Not yet."
    )
    s.npc_extractor("Maren", amplify=["wariness of dangerous men"])
    s.lore()

    await s.run_turn()
    return storage_after_t1
