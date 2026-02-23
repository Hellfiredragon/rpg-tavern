"""Tests for rpg_tavern.models."""

import pytest
from pydantic import ValidationError

from rpg_tavern.models import Adventure, Character, ExtractorResult, Message, Persona, StateChange


class TestMessage:
    def test_required_fields(self) -> None:
        m = Message(turn_id=1, seq=3, owner="narrator", type="narration", content="Dark.")
        assert m.turn_id == 1
        assert m.seq == 3
        assert m.owner == "narrator"
        assert m.type == "narration"
        assert m.content == "Dark."

    def test_mood_defaults_to_none(self) -> None:
        m = Message(turn_id=1, seq=1, owner="narrator", type="narration", content="x")
        assert m.mood is None

    def test_mood_present_on_dialog(self) -> None:
        m = Message(
            turn_id=1, seq=2, owner="brunolf", type="dialog",
            content="Rough night.", mood="neutral",
        )
        assert m.mood == "neutral"

    def test_invalid_type_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Message(turn_id=1, seq=1, owner="narrator", type="gossip", content="x")

    def test_all_valid_types_accepted(self) -> None:
        valid = ["narration", "dialog", "intention", "thought", "scene_marker", "system"]
        for t in valid:
            m = Message(turn_id=1, seq=1, owner="narrator", type=t, content="x")
            assert m.type == t

    def test_serialise_roundtrip(self) -> None:
        m = Message(turn_id=2, seq=5, owner="aldric", type="dialog",
                    content="Who goes there?", mood="wary")
        restored = Message.model_validate(m.model_dump())
        assert restored == m

    def test_mood_excluded_from_dump_when_none(self) -> None:
        m = Message(turn_id=1, seq=1, owner="narrator", type="narration", content="x")
        dumped = m.model_dump(exclude_none=True)
        assert "mood" not in dumped


class TestStateChange:
    def test_required_fields(self) -> None:
        sc = StateChange(category="temporal", label="Cautious", value=3)
        assert sc.category == "temporal"
        assert sc.label == "Cautious"
        assert sc.value == 3

    def test_all_categories_accepted(self) -> None:
        for cat in ("temporal", "persistent", "core"):
            sc = StateChange(category=cat, label="X", value=0)
            assert sc.category == cat

    def test_invalid_category_rejected(self) -> None:
        with pytest.raises(ValidationError):
            StateChange(category="invalid", label="X", value=0)

    def test_serialise_roundtrip(self) -> None:
        sc = StateChange(category="persistent", label="Wounded", value=7)
        restored = StateChange.model_validate(sc.model_dump())
        assert restored == sc


class TestExtractorResult:
    def test_empty_by_default(self) -> None:
        er = ExtractorResult()
        assert er.state_changes == []

    def test_with_state_changes(self) -> None:
        er = ExtractorResult(state_changes=[
            StateChange(category="temporal", label="Alert", value=5),
        ])
        assert len(er.state_changes) == 1
        assert er.state_changes[0].label == "Alert"

    def test_serialise_roundtrip(self) -> None:
        er = ExtractorResult(state_changes=[
            StateChange(category="core", label="Strength", value=8),
        ])
        restored = ExtractorResult.model_validate(er.model_dump())
        assert restored == er


class TestCharacter:
    def test_required_fields(self) -> None:
        c = Character(id="brunolf", name="Brunolf", description="Gruff innkeeper.")
        assert c.id == "brunolf"
        assert c.name == "Brunolf"

    def test_chattiness_defaults_to_50(self) -> None:
        c = Character(id="x", name="X", description="desc")
        assert c.chattiness == 50

    def test_states_defaults_to_empty(self) -> None:
        c = Character(id="x", name="X", description="desc")
        assert c.states == []

    def test_baked_defaults_to_false(self) -> None:
        c = Character(id="x", name="X", description="desc")
        assert c.baked is False

    def test_baked_flag_set(self) -> None:
        c = Character(id="x", name="X", description="desc", baked=True)
        assert c.baked is True

    def test_serialise_roundtrip(self) -> None:
        c = Character(id="brunolf", name="Brunolf", description="Inn.", chattiness=80)
        restored = Character.model_validate(c.model_dump())
        assert restored == c


class TestPersona:
    def test_required_fields(self) -> None:
        p = Persona(id="aldric", name="Aldric", description="Sellsword.")
        assert p.id == "aldric"

    def test_states_defaults_to_empty(self) -> None:
        p = Persona(id="x", name="X", description="desc")
        assert p.states == []

    def test_serialise_roundtrip(self) -> None:
        p = Persona(id="aldric", name="Aldric", description="Sellsword.")
        restored = Persona.model_validate(p.model_dump())
        assert restored == p


class TestAdventure:
    def test_required_fields(self) -> None:
        a = Adventure(slug="broken-compass", title="The Inn", setting="A tavern.")
        assert a.slug == "broken-compass"

    def test_serialise_roundtrip(self) -> None:
        a = Adventure(slug="broken-compass", title="The Inn", setting="A tavern.")
        restored = Adventure.model_validate_json(a.model_dump_json())
        assert restored == a
