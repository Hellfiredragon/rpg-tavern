"""Thornhaven Betrothal — Pipeline Integration Test

One continuous scenario across three turns.  Each Scenario.run_turn() call
asserts messages, lore, and state before handing control to the next turn.

Edge cases covered:
  • persona_cue     — Turn 1: Isolde's intent has no explicit words; narrator
                       generates her opening line via Persona Dialog LLM call.
  • suppress-to-zero — Turn 1 Brenna round: 'excitement about feast' (temp, 3)
                       suppressed to 0 and removed from the state map.
  • cross-round cue  — Turn 2: Aldous speaks inside Cael's narrator beat script
                       (cue with embedded intention).
  • lore upsert      — Turn 1 Cael sets 'betrothal'; Turn 2 Cael rewrites it.
  • overflow+evolution — Turn 3: Aldous's persistent 'resentment toward Cael'
                         (27) overflows to 30 → removed; identity 'The Scorned
                         Suitor' created at 20.
  • cross-round cue  — Turn 3: Cael speaks inside Aldous's narrator beat script
                       (cue with embedded intention).
"""

import json
from pathlib import Path

from rpg_tavern.storage import Storage
from tests.utils.scenario import Scenario

_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent
    / "resources"
    / "thornhaven_betrothal_stream.json"
)
with open(_FIXTURE_PATH) as _f:
    _STREAM = json.load(_f)

SLUG = _STREAM["adventure"]["slug"]


async def test_thornhaven_betrothal(storage: Storage) -> None:
    """Three-turn scenario: betrothal feast, a portrait, and a rival's overreach."""
    s = Scenario(storage, slug=SLUG, persona_id="Isolde")
    lord_cael = s.npc("Lord Cael")
    sir_aldous = s.npc("Sir Aldous")
    brenna = s.npc("Brenna")

    # ── Turn 1: Isolde approaches Lord Cael ──────────────────────────────────
    s.player_intent(
        "I make my way to Lord Cael's end of the table and take the seat to his left. "
        "I haven't decided how to open — I want to see how he receives me first."
    )
    s.narrate(
        "Isolde crosses the hall with the measured steps of a woman who has spent years "
        "learning to move through rooms where everyone is watching. The seat to Lord "
        "Cael's left has been empty for three years. She takes it without ceremony."
    )
    # persona_cue: Isolde's intent contained no explicit words; the narrator
    # generates her opening line by firing the Persona Dialog LLM stage.
    s.persona_cue("Lord Cael. I hope the feast is a pleasant one.", mood="cautious")
    s.narrate("Cael's expression does not change. He sets down his cup.")
    s.persona_extractor(amplify=["nervousness", "curiosity about Cael"])
    s.lore()

    lord_cael.intent("I'll rise to greet her properly — whatever comes next can wait.")
    s.narrate(
        "Lord Cael rises from his chair — unhurried, deliberate, the way a man moves "
        "when he wants to convey that he has thought about the gesture."
    )
    lord_cael.says("Lady Isolde. You are welcome at Thornhaven.", mood="formal")
    s.narrate("He pours wine into the cup beside her place without being asked, then sits.")
    lord_cael.extractor(amplify=["duty to lineage"])
    s.lore(betrothal="Lord Cael Ashford betrothed to Lady Isolde Vane at midwinter.")

    brenna.intent(
        "I'll appear at my lady's side and make sure Lord Cael knows she is cared "
        "for — and watched over."
    )
    s.narrate(
        "Brenna materialises at Isolde's shoulder with the discretion of long practice "
        "— there one moment, invisible the next."
    )
    brenna.says(
        "My lord, if you'll permit — my lady has been looking forward to this evening.",
        mood="warm",
    )
    s.narrate(
        "She retreats a half-step before Cael can respond, leaving the comment to hang "
        "pleasantly in the air."
    )
    # suppress-to-zero: Brenna's temporary 'excitement about feast' (3) hits 0
    # and is removed from the state map entirely.
    brenna.extractor(suppress=["excitement about feast"], amplify=["protectiveness of Isolde"])
    s.lore()

    await s.run_turn()

    # ── Turn 2: Isolde asks about the portrait; Aldous intrudes ───────────────
    s.player_intent(
        "There is a portrait above the hearth — a woman in a red dress. "
        "I ask about her. I say: 'My lord, who is the woman in the portrait? "
        "She is beautiful.'"
    )
    s.narrate(
        "Isolde's gaze drifts to the portrait above the hearth — a woman in a red "
        "dress, dark-haired, painted mid-laugh."
    )
    # persona_verbatim: the player's intent quoted the exact words.
    s.persona_says(
        "My lord, who is the woman in the portrait? She is beautiful.",
        mood="curious",
    )
    s.narrate("The question lands quietly. Cael's expression does something almost invisible.")
    s.persona_extractor(amplify=["curiosity about Cael", "curiosity about Lady Lysa"])
    s.lore()

    lord_cael.intent(
        "I'll tell her — briefly, without dwelling. Lysa's portrait stays because "
        "removing it would be a kind of dishonesty I'm not capable of."
    )
    s.narrate("Cael looks up at the portrait for a moment before he answers.")
    lord_cael.says("Lady Lysa. My wife. She died three winters past.", mood="measured")
    # cross-round cue: Aldous speaks inside Cael's narrator beat script.
    # The cue beat carries an embedded intention field; the orchestrator appends
    # an intention message for Aldous before firing Character Dialog.
    sir_aldous.says(
        "A great loss, my lord. Some wounds do not close.",
        mood="insinuating",
        intention="I'll slip into this tender moment — sympathy is a door I can walk through.",
    )
    s.narrate(
        "Sir Aldous has appeared at the edge of the candlelight without anyone noticing "
        "his approach."
    )
    # Both Cael (the activated NPC) and Aldous (spoke via cross-round cue) get
    # character extractors — in that order.
    lord_cael.extractor(amplify=["grief over lost wife"])
    # Aldous's overflow at 24 (+3 = 27) does not yet hit 30; resentment stays in
    # persistent and will be eligible for evolution next turn.
    sir_aldous.extractor(overflow="resentment toward Cael", amplify=["longing for Isolde"])
    # lore upsert: the 'betrothal' key written in Turn 1 is overwritten with richer
    # information now that Lysa's story has emerged.
    s.lore(betrothal="Lord Cael's first wife Lysa died three winters past. He remarries by duty.")

    brenna.intent("I'll watch Aldous — I know his kind. I'll stay close to my lady.")
    s.narrate(
        "Brenna's expression does not change. Her eyes follow Aldous the way a cat "
        "watches a door."
    )
    # Brenna is silent this round; no says() call.  The extractor still runs
    # because she was the activated NPC for this round.
    brenna.extractor(amplify=["protectiveness of Isolde", "wariness of Aldous"])
    s.lore()

    await s.run_turn()

    # ── Turn 3: Isolde rebuffs Aldous; Cael ends it; Brenna intervenes ────────
    s.player_intent(
        "Aldous is circling too close. I stay in my seat, spine straight. "
        "I say: 'Sir Aldous. I was not aware you had been introduced to our end of the table.'"
    )
    s.narrate(
        "Isolde turns toward Aldous with the careful composure of someone who has "
        "decided what to do."
    )
    s.persona_says(
        "Sir Aldous. I was not aware you had been introduced to our end of the table.",
        mood="cool",
    )
    s.narrate(
        "Aldous smiles — the expression reaching his eyes in a way that does not read "
        "as warmth."
    )
    s.persona_extractor(amplify=["wariness of Aldous"])
    s.lore()

    sir_aldous.intent(
        "I'll charm her and position Cael as a lesser match — carefully. "
        "Just an implication."
    )
    s.narrate(
        "Aldous steps forward, adjusting his sleeve in a gesture designed to look idle."
    )
    sir_aldous.says(
        "Lady Isolde. The far end of the table offered nothing worth speaking to. "
        "I came to remedy that.",
        mood="charming",
    )
    # cross-round cue: Cael shuts Aldous down from inside Aldous's beat script.
    lord_cael.says("Sir Aldous. Your seat awaits you.", mood="flat",
                   intention="I'll end this in one sentence.")
    s.narrate(
        "Aldous holds Cael's gaze for exactly one second too long before he turns, "
        "smiles at Isolde, and goes."
    )
    # overflow + evolution: Aldous's persistent 'resentment toward Cael' was at 27
    # after T2.  Overflow pushes it to 30 → the entry is removed from persistent
    # and identity 'The Scorned Suitor' is created at 20.
    sir_aldous.extractor(
        overflow="resentment toward Cael",
        evolution="The Scorned Suitor",
        amplify=["longing for Isolde"],
    )
    lord_cael.extractor(amplify=["duty to lineage"])
    s.lore(
        aldous_threat=(
            "Sir Aldous Crane was refused Lady Isolde's hand twice before this betrothal."
        ),
    )

    brenna.intent(
        "I'll move in beside my lady — if Aldous won't leave the room, she shouldn't "
        "be without company."
    )
    s.narrate(
        "Brenna draws the chair beside Isolde closer and sits — not asking permission, "
        "not needing it."
    )
    brenna.says(
        "My lady, the musicians are asking about the first set. Shall I tell them slower?",
        mood="brisk",
    )
    s.narrate("It is not subtle. It doesn't need to be.")
    brenna.extractor(amplify=["protectiveness of Isolde"])
    s.lore()

    await s.run_turn()

    # ── Final assertions ──────────────────────────────────────────────────────
    all_msgs = storage.get_messages(SLUG)

    # T1: 12 messages  T2: 12 messages  T3: 14 messages
    assert len(all_msgs) == 38

    narrations = [m.content for m in all_msgs if m.type == "narration"]
    expected_narrations = [
        m["content"]
        for m in _STREAM["messages"]
        if isinstance(m, dict) and m.get("type") == "narration"
    ]
    assert narrations == expected_narrations

    # Verify Aldous's overflow+evolution result: resentment gone, identity created
    chars = {c.id: c for c in storage.get_characters(SLUG)}
    aldous = chars["Sir Aldous"]
    assert "resentment toward Cael" not in aldous.states.get("persistent", {})
    assert aldous.states["identity"].get("The Scorned Suitor") == 20
