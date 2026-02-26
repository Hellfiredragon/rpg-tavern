"""The Broken Compass Inn — Pipeline Scenario Test

One continuous scenario across three turns.  Each Scenario.run_turn() call
asserts messages, lore, and state before handing control to the next turn.

Turn 1 — Aldric enters and scans the room.  Brunolf appears via an embedded
          cue in the player's narrator round (no dedicated NPC round).

Turn 2 — Aldric asks about Isolde (player writes the line verbatim).  Brunolf
          answers twice via consecutive cue beats in the player's round.
          Lore extractor records the bandit entry.

Turn 3 — Aldric sits quietly.  Isolde (baked) gets her own NPC round and
          pitches the sellsword for an escort to Estfeld.
"""

import pytest

from rpg_tavern.models import Character, Persona
from rpg_tavern.storage import Storage
from tests.utils.scenario import Scenario

SLUG = "broken-compass"


@pytest.fixture
def storage(tmp_path) -> Storage:
    s = Storage(tmp_path)
    s.create_adventure(
        slug=SLUG,
        title="The Broken Compass Inn",
        setting=(
            "A roadside inn in the village of Millhaven, dusk. "
            "A storm has stranded travelers inside."
        ),
    )
    s.save_character(
        SLUG,
        Character(
            id="brunolf",
            name="Brunolf",
            description="Gruff innkeeper. Fair but watchful. Knows local gossip.",
            chattiness=80,
        ),
    )
    s.save_character(
        SLUG,
        Character(
            id="isolde",
            name="Isolde",
            description="Traveling merchant. Visibly nervous. Hiding something.",
            chattiness=55,
        ),
    )
    s.save_persona(
        SLUG,
        Persona(
            id="aldric",
            name="Aldric",
            description="A wandering sellsword. Dry wit, blade always close.",
        ),
    )
    return s


async def test_broken_compass(storage: Storage) -> None:
    """Three-turn scenario: Aldric arrives, asks questions, and gets a job offer."""
    s = Scenario(storage, slug=SLUG, persona_id="aldric")
    brunolf = s.npc("brunolf")
    isolde = s.npc("isolde")

    # ── Turn 1: Aldric enters ─────────────────────────────────────────────────
    s.player_intent(
        "I step inside out of the rain and take a seat at the bar, "
        "scanning the room while I order an ale."
    )
    s.narrate(
        "The Broken Compass smells of wet wool and tallow smoke. "
        "Three travelers huddle near the fire. In the far corner, "
        "a woman in a merchant's coat keeps her eyes on the door — "
        "not watching for arrivals. Watching to make sure no one follows."
    )
    # Brunolf appears via an embedded cue in the player's narrator round — he has
    # no dedicated NPC round this turn, just a cue beat with an intention field.
    brunolf.says(
        "Rough night to be on the road. You come far?",
        mood="neutral",
        context="Newcomer walked in soaked and armed. Brunolf is sizing him up.",
        intention="I'll offer the newcomer a drink and get a read on him.",
    )
    s.narrate(
        "Brunolf sets a clay mug in front of Aldric without being asked, "
        "his eyes flicking briefly to the sword at Aldric's hip."
    )
    s.persona_extractor()
    # Brunolf spoke in the player's round — character extractor fires for him.
    brunolf.extractor()
    s.lore()

    await s.run_turn()

    # ── Turn 2: Aldric asks about Isolde ─────────────────────────────────────
    s.player_intent(
        "I take a slow drink and keep my voice low. "
        "'What's got that woman in the corner wound so tight?'"
    )
    s.narrate("Aldric sets the mug down slowly, eyes still on the room.")
    # persona_verbatim: the player's intent quoted the exact words; the narrator
    # places a persona_verbatim beat, no Persona Dialog LLM call needed.
    s.persona_says("What's got that woman in the corner wound so tight?", mood="low")
    s.narrate(
        "Brunolf's expression tightens. Brunolf glances toward the corner "
        "and lowers his voice."
    )
    brunolf.says(
        "Came in two nights ago. Won't say from where. Paid double for a room with a bolt.",
        mood="tensed",
        context=(
            "Aldric asked directly about Isolde. Brunolf knows about "
            "the bandits and her suspicious arrival two nights ago."
        ),
        intention="I'll tell him what I know — carefully.",
    )
    s.narrate("Brunolf refills Aldric's mug without asking.")
    brunolf.says(
        "There's been trouble on the Millhaven-Estfeld road. "
        "Three merchant wagons robbed in a fortnight.",
        mood="tensed",
        context="Continue — warn about bandit trouble on the Millhaven-Estfeld road.",
        intention="I'll warn him about the road trouble.",
    )
    s.persona_extractor()
    brunolf.extractor(amplify=["Cautious"])
    s.lore(
        millhaven_estfeld_bandits=(
            "Three merchant wagons robbed on the Millhaven-Estfeld road in a fortnight."
        ),
    )

    await s.run_turn()

    # ── Turn 3: Aldric sits; Isolde approaches ────────────────────────────────
    s.player_intent("I sit quietly and watch the room.")
    s.narrate("Aldric settles back and nurses the drink.")
    s.persona_extractor()
    s.lore()

    isolde.intent("The sellsword knows about the road. I'll approach him.")
    s.narrate("Isolde sets down her cup and crosses the room.")
    isolde.says(
        "You look like someone who knows how to use that.",
        mood="desperate",
        context="Isolde approaches and sizes up the sellsword.",
    )
    s.narrate("Isolde stops beside Aldric.")
    isolde.says(
        "I need to reach Estfeld by tomorrow night. I can pay well.",
        mood="desperate",
        context="Isolde names her destination and offers payment.",
    )
    isolde.extractor(amplify=["Frightened", "Desperate"])
    s.lore()

    await s.run_turn()

    # ── Final assertions ──────────────────────────────────────────────────────
    all_msgs = storage.get_messages(SLUG)

    # T1: 5   (intention + narration + intention(cue) + dialog + narration)
    # T2: 9   (intention + narration + dialog(verbatim) + narration +
    #          intention(cue1) + dialog(cue1) + narration + intention(cue2) + dialog(cue2))
    # T3: 7   (intention + narration +
    #          intention(npc_intent) + narration + dialog + narration + dialog)
    assert len(all_msgs) == 21
