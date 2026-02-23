"""Tests for rpg_tavern.storage.Storage."""

import pytest
from pathlib import Path

from rpg_tavern.models import Adventure, Character, Message, Persona, StateChange
from rpg_tavern.storage import Storage


@pytest.fixture
def storage(tmp_path: Path) -> Storage:
    return Storage(tmp_path)


@pytest.fixture
def adventure(storage: Storage) -> Adventure:
    return storage.create_adventure(
        slug="test-inn",
        title="The Test Inn",
        setting="A quiet inn for testing.",
    )


# ---------------------------------------------------------------------------
# Adventures
# ---------------------------------------------------------------------------

class TestAdventures:
    def test_create_returns_adventure(self, storage: Storage) -> None:
        adv = storage.create_adventure("my-inn", "My Inn", "Setting.")
        assert adv.slug == "my-inn"
        assert adv.title == "My Inn"

    def test_create_writes_metadata_file(self, storage: Storage, tmp_path: Path) -> None:
        storage.create_adventure("my-inn", "My Inn", "Setting.")
        assert (tmp_path / "adventures" / "my-inn.json").exists()

    def test_create_writes_adventure_directory(self, storage: Storage, tmp_path: Path) -> None:
        storage.create_adventure("my-inn", "My Inn", "Setting.")
        assert (tmp_path / "adventures" / "my-inn").is_dir()

    def test_get_adventure_returns_saved(self, storage: Storage) -> None:
        storage.create_adventure("my-inn", "My Inn", "Setting.")
        adv = storage.get_adventure("my-inn")
        assert adv is not None
        assert adv.title == "My Inn"
        assert adv.setting == "Setting."

    def test_get_adventure_returns_none_for_missing(self, storage: Storage) -> None:
        assert storage.get_adventure("no-such-inn") is None


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------

class TestCharacters:
    def test_get_characters_empty_before_any_saved(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        assert storage.get_characters(adventure.slug) == []

    def test_save_and_retrieve_character(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        char = Character(id="brunolf", name="Brunolf", description="Innkeeper.", chattiness=80)
        storage.save_character(adventure.slug, char)
        chars = storage.get_characters(adventure.slug)
        assert len(chars) == 1
        assert chars[0].id == "brunolf"
        assert chars[0].chattiness == 80

    def test_save_multiple_characters(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.save_character(adventure.slug, Character(id="a", name="A", description="d"))
        storage.save_character(adventure.slug, Character(id="b", name="B", description="d"))
        assert len(storage.get_characters(adventure.slug)) == 2

    def test_save_character_upserts_by_id(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.save_character(adventure.slug, Character(id="brunolf", name="Old", description="d"))
        storage.save_character(adventure.slug, Character(id="brunolf", name="New", description="d"))
        chars = storage.get_characters(adventure.slug)
        assert len(chars) == 1
        assert chars[0].name == "New"

    def test_character_states_persisted(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        char = Character(
            id="brunolf", name="Brunolf", description="d",
            states=[{"label": "Cautious", "value": 3, "category": "temporal"}],
        )
        storage.save_character(adventure.slug, char)
        loaded = storage.get_characters(adventure.slug)[0]
        assert loaded.states[0]["label"] == "Cautious"


# ---------------------------------------------------------------------------
# Personas
# ---------------------------------------------------------------------------

class TestPersonas:
    def test_get_personas_empty_before_any_saved(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        assert storage.get_personas(adventure.slug) == []

    def test_save_and_retrieve_persona(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        persona = Persona(id="aldric", name="Aldric", description="Sellsword.")
        storage.save_persona(adventure.slug, persona)
        personas = storage.get_personas(adventure.slug)
        assert len(personas) == 1
        assert personas[0].id == "aldric"

    def test_save_persona_upserts_by_id(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.save_persona(adventure.slug, Persona(id="aldric", name="Old", description="d"))
        storage.save_persona(adventure.slug, Persona(id="aldric", name="New", description="d"))
        personas = storage.get_personas(adventure.slug)
        assert len(personas) == 1
        assert personas[0].name == "New"


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

class TestMessages:
    def _msg(self, turn_id: int, seq: int, **kwargs) -> Message:
        return Message(
            turn_id=turn_id, seq=seq,
            owner=kwargs.get("owner", "narrator"),
            type=kwargs.get("type", "narration"),
            content=kwargs.get("content", "text"),
            mood=kwargs.get("mood"),
        )

    def test_get_messages_empty_before_any_appended(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        assert storage.get_messages(adventure.slug) == []

    def test_append_and_retrieve_messages(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        msgs = [self._msg(1, 1), self._msg(1, 2)]
        storage.append_messages(adventure.slug, msgs)
        loaded = storage.get_messages(adventure.slug)
        assert len(loaded) == 2

    def test_append_is_cumulative(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.append_messages(adventure.slug, [self._msg(1, 1)])
        storage.append_messages(adventure.slug, [self._msg(1, 2)])
        assert len(storage.get_messages(adventure.slug)) == 2

    def test_message_fields_preserved(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        msg = Message(
            turn_id=2, seq=5, owner="brunolf", type="dialog",
            content="Rough night.", mood="neutral",
        )
        storage.append_messages(adventure.slug, [msg])
        loaded = storage.get_messages(adventure.slug)[0]
        assert loaded.turn_id == 2
        assert loaded.seq == 5
        assert loaded.owner == "brunolf"
        assert loaded.type == "dialog"
        assert loaded.mood == "neutral"
        assert loaded.content == "Rough night."

    def test_message_order_preserved(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        msgs = [self._msg(1, i, content=str(i)) for i in range(1, 6)]
        storage.append_messages(adventure.slug, msgs)
        loaded = storage.get_messages(adventure.slug)
        assert [m.content for m in loaded] == ["1", "2", "3", "4", "5"]


# ---------------------------------------------------------------------------
# Lorebook
# ---------------------------------------------------------------------------

class TestLorebook:
    def test_get_lorebook_empty_before_any_entries(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        assert storage.get_lorebook(adventure.slug) == []

    def test_append_and_retrieve_entry(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.append_lorebook_entries(adventure.slug, [
            {"key": "bandits", "content": "Bandits on the south road."},
        ])
        entries = storage.get_lorebook(adventure.slug)
        assert len(entries) == 1
        assert entries[0]["key"] == "bandits"

    def test_append_multiple_entries(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.append_lorebook_entries(adventure.slug, [
            {"key": "a", "content": "A."},
            {"key": "b", "content": "B."},
        ])
        assert len(storage.get_lorebook(adventure.slug)) == 2

    def test_upsert_by_key(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.append_lorebook_entries(adventure.slug, [
            {"key": "bandits", "content": "Old info."},
        ])
        storage.append_lorebook_entries(adventure.slug, [
            {"key": "bandits", "content": "Updated info."},
        ])
        entries = storage.get_lorebook(adventure.slug)
        assert len(entries) == 1
        assert entries[0]["content"] == "Updated info."

    def test_upsert_does_not_duplicate_different_keys(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        storage.append_lorebook_entries(adventure.slug, [{"key": "a", "content": "A."}])
        storage.append_lorebook_entries(adventure.slug, [{"key": "b", "content": "B."}])
        assert len(storage.get_lorebook(adventure.slug)) == 2


# ---------------------------------------------------------------------------
# State changes
# ---------------------------------------------------------------------------

class TestCharacterStateChanges:
    def _char(self, storage: Storage, adventure: Adventure) -> None:
        storage.save_character(
            adventure.slug,
            Character(id="brunolf", name="Brunolf", description="Innkeeper."),
        )

    def test_apply_adds_new_entry(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._char(storage, adventure)
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [StateChange(category="temporal", label="Cautious", value=3)],
        )
        char = storage.get_characters(adventure.slug)[0]
        entry = next(s for s in char.states if s["label"] == "Cautious")
        assert entry["value"] == 3
        assert entry["category"] == "temporal"

    def test_apply_upserts_existing_entry(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._char(storage, adventure)
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [StateChange(category="temporal", label="Cautious", value=3)],
        )
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [StateChange(category="temporal", label="Cautious", value=7)],
        )
        chars = storage.get_characters(adventure.slug)
        cautious = [s for s in chars[0].states if s["label"] == "Cautious"]
        assert len(cautious) == 1
        assert cautious[0]["value"] == 7

    def test_clamps_value_above_10(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._char(storage, adventure)
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [StateChange(category="core", label="Strength", value=15)],
        )
        char = storage.get_characters(adventure.slug)[0]
        entry = next(s for s in char.states if s["label"] == "Strength")
        assert entry["value"] == 10

    def test_clamps_value_below_0(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._char(storage, adventure)
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [StateChange(category="core", label="Strength", value=-5)],
        )
        char = storage.get_characters(adventure.slug)[0]
        entry = next(s for s in char.states if s["label"] == "Strength")
        assert entry["value"] == 0

    def test_category_isolation(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        """Same label in different categories → two separate entries."""
        self._char(storage, adventure)
        storage.apply_character_state_changes(
            adventure.slug, "brunolf",
            [
                StateChange(category="temporal", label="Alert", value=4),
                StateChange(category="persistent", label="Alert", value=8),
            ],
        )
        char = storage.get_characters(adventure.slug)[0]
        temporal = next(s for s in char.states if s["category"] == "temporal")
        persistent = next(s for s in char.states if s["category"] == "persistent")
        assert temporal["value"] == 4
        assert persistent["value"] == 8

    def test_raises_for_missing_character(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        with pytest.raises(ValueError, match="no-one"):
            storage.apply_character_state_changes(
                adventure.slug, "no-one",
                [StateChange(category="temporal", label="X", value=1)],
            )


class TestPersonaStateChanges:
    def _persona(self, storage: Storage, adventure: Adventure) -> None:
        storage.save_persona(
            adventure.slug,
            Persona(id="aldric", name="Aldric", description="Sellsword."),
        )

    def test_apply_adds_new_entry(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._persona(storage, adventure)
        storage.apply_persona_state_changes(
            adventure.slug, "aldric",
            [StateChange(category="persistent", label="Reputation", value=6)],
        )
        persona = storage.get_personas(adventure.slug)[0]
        entry = next(s for s in persona.states if s["label"] == "Reputation")
        assert entry["value"] == 6

    def test_apply_upserts_existing_entry(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        self._persona(storage, adventure)
        storage.apply_persona_state_changes(
            adventure.slug, "aldric",
            [StateChange(category="persistent", label="Reputation", value=4)],
        )
        storage.apply_persona_state_changes(
            adventure.slug, "aldric",
            [StateChange(category="persistent", label="Reputation", value=9)],
        )
        persona = storage.get_personas(adventure.slug)[0]
        entries = [s for s in persona.states if s["label"] == "Reputation"]
        assert len(entries) == 1
        assert entries[0]["value"] == 9

    def test_raises_for_missing_persona(
        self, storage: Storage, adventure: Adventure
    ) -> None:
        with pytest.raises(ValueError, match="ghost"):
            storage.apply_persona_state_changes(
                adventure.slug, "ghost",
                [StateChange(category="temporal", label="X", value=1)],
            )
