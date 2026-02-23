"""Tests for rpg_tavern.pipeline.visibility.filter_messages."""

import pytest

from rpg_tavern.models import Message
from rpg_tavern.pipeline.visibility import filter_messages


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _msg(turn_id: int, seq: int, owner: str, type: str, content: str = "x") -> Message:
    return Message(turn_id=turn_id, seq=seq, owner=owner, type=type, content=content)


def _build_stream() -> list[Message]:
    """Representative stream: two past turns + current turn in progress."""
    return [
        # Turn 1
        _msg(1, 1, "aldric",   "intention",  "I enter the inn."),
        _msg(1, 2, "narrator", "narration",  "You step inside."),
        _msg(1, 3, "brunolf",  "dialog",     "Rough night?"),
        _msg(1, 4, "narrator", "narration",  "He sets a mug down."),
        # Turn 2
        _msg(2, 5, "aldric",   "intention",  "I ask about Isolde."),
        _msg(2, 6, "narrator", "narration",  "You lower your voice."),
        _msg(2, 7, "aldric",   "dialog",     "What's her story?"),
        _msg(2, 8, "brunolf",  "dialog",     "Came two nights ago."),
        # Turn 3 — current; intention already appended, narration being built
        _msg(3, 9, "aldric",   "intention",  "I sit quietly."),
        _msg(3, 10, "narrator","narration",  "You settle back."),
    ]


CURRENT = 3


# ---------------------------------------------------------------------------
# Narrator
# ---------------------------------------------------------------------------

class TestNarratorFilter:
    def test_sees_all_narration(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "narrator", "aldric", CURRENT)
        narrations = [m for m in result if m.type == "narration"]
        # turns 1 (×2) + turn 2 (×1) + turn 3 current (×1) = 4
        assert len(narrations) == 4

    def test_sees_all_dialog(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "narrator", "aldric", CURRENT)
        dialogs = [m for m in result if m.type == "dialog"]
        # turn 1: brunolf; turn 2: aldric + brunolf = 3
        assert len(dialogs) == 3

    def test_sees_only_current_own_intention(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "narrator", "aldric", CURRENT)
        intentions = [m for m in result if m.type == "intention"]
        assert len(intentions) == 1
        assert intentions[0].turn_id == CURRENT
        assert intentions[0].owner == "aldric"

    def test_does_not_see_past_intentions(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "narrator", "aldric", CURRENT)
        past_intentions = [
            m for m in result if m.type == "intention" and m.turn_id < CURRENT
        ]
        assert past_intentions == []

    def test_does_not_see_other_current_intention(self) -> None:
        msgs = _build_stream()
        # Add an NPC intention in the current turn
        msgs.append(_msg(CURRENT, 11, "brunolf", "intention", "I watch the door."))
        result = filter_messages(msgs, "narrator", "aldric", CURRENT)
        other = [m for m in result if m.type == "intention" and m.owner == "brunolf"]
        assert other == []


# ---------------------------------------------------------------------------
# Character Dialog / Persona Dialog
# ---------------------------------------------------------------------------

class TestDialogStageFilter:
    @pytest.mark.parametrize("stage", ["character_dialog", "persona_dialog"])
    def test_sees_all_narrative(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "brunolf", CURRENT)
        types = {m.type for m in result}
        assert types <= {"narration", "dialog"}

    @pytest.mark.parametrize("stage", ["character_dialog", "persona_dialog"])
    def test_no_intentions(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "brunolf", CURRENT)
        assert all(m.type != "intention" for m in result)

    @pytest.mark.parametrize("stage", ["character_dialog", "persona_dialog"])
    def test_sees_current_turn_narration(self, stage: str) -> None:
        """Dialog stages receive the messages already produced this round."""
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "brunolf", CURRENT)
        current_narrations = [m for m in result if m.turn_id == CURRENT and m.type == "narration"]
        assert len(current_narrations) == 1


# ---------------------------------------------------------------------------
# Persona Extractor / Character Extractor
# ---------------------------------------------------------------------------

class TestExtractorFilter:
    @pytest.mark.parametrize("stage", ["persona_extractor", "character_extractor"])
    def test_no_current_round_narrative(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "aldric", CURRENT)
        current_narrative = [
            m for m in result
            if m.type in ("narration", "dialog") and m.turn_id == CURRENT
        ]
        assert current_narrative == []

    @pytest.mark.parametrize("stage", ["persona_extractor", "character_extractor"])
    def test_sees_past_narrative(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "aldric", CURRENT)
        past = [m for m in result if m.type in ("narration", "dialog")]
        assert len(past) == 6  # turns 1 and 2

    @pytest.mark.parametrize("stage", ["persona_extractor", "character_extractor"])
    def test_sees_own_last_past_intention(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "aldric", CURRENT)
        intentions = [m for m in result if m.type == "intention"]
        assert len(intentions) == 1
        assert intentions[0].turn_id == 2  # last own past intention

    @pytest.mark.parametrize("stage", ["persona_extractor", "character_extractor"])
    def test_no_other_intentions(self, stage: str) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, stage, "aldric", CURRENT)
        others = [m for m in result if m.type == "intention" and m.owner != "aldric"]
        assert others == []


# ---------------------------------------------------------------------------
# NPC Intent
# ---------------------------------------------------------------------------

class TestNpcIntentFilter:
    def test_sees_past_narrative(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "npc_intent", "brunolf", CURRENT)
        narrative = [m for m in result if m.type in ("narration", "dialog")]
        assert len(narrative) == 6  # turns 1 and 2

    def test_sees_own_past_intentions(self) -> None:
        msgs = _build_stream()
        # Add a past brunolf intention
        msgs.insert(0, _msg(1, 0, "brunolf", "intention", "I watch the newcomer."))
        result = filter_messages(msgs, "npc_intent", "brunolf", CURRENT)
        own = [m for m in result if m.type == "intention" and m.owner == "brunolf"]
        assert len(own) == 1

    def test_no_other_intentions(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "npc_intent", "brunolf", CURRENT)
        others = [m for m in result if m.type == "intention" and m.owner != "brunolf"]
        assert others == []

    def test_no_current_turn_content(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "npc_intent", "brunolf", CURRENT)
        current = [m for m in result if m.turn_id == CURRENT]
        assert current == []


# ---------------------------------------------------------------------------
# Lore Extractor
# ---------------------------------------------------------------------------

class TestLoreExtractorFilter:
    def test_sees_only_current_turn_narrative(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "lore_extractor", "narrator", CURRENT)
        assert all(m.turn_id == CURRENT for m in result)

    def test_no_past_turns(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "lore_extractor", "narrator", CURRENT)
        past = [m for m in result if m.turn_id < CURRENT]
        assert past == []

    def test_no_intentions(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "lore_extractor", "narrator", CURRENT)
        assert all(m.type != "intention" for m in result)

    def test_count(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "lore_extractor", "narrator", CURRENT)
        # current turn has 1 narration message (intention excluded)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Unknown stage
# ---------------------------------------------------------------------------

class TestUnknownStage:
    def test_unknown_stage_returns_empty(self) -> None:
        msgs = _build_stream()
        result = filter_messages(msgs, "unknown_stage", "aldric", CURRENT)
        assert result == []
