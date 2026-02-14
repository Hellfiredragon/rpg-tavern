"""Tests for adventure lifecycle, embark, and name generation."""

from backend import storage


# ── Embark ───────────────────────────────────────────────


def test_embark_template():
    storage.create_template("Quest", "A great quest")
    adventure = storage.embark_template("quest", "My Adventure")
    assert adventure is not None
    assert adventure["title"] == "My Adventure"
    assert adventure["slug"] == "my-adventure"
    assert adventure["template_slug"] == "quest"
    assert adventure["description"] == "A great quest"


def test_embark_slug_collision():
    storage.create_template("Quest", "Desc")
    storage.embark_template("quest", "Run")
    r2 = storage.embark_template("quest", "Run")
    assert r2["slug"] == "run-2"


def test_embark_with_player_name():
    storage.create_template("Quest", "A great quest")
    adventure = storage.embark_template("quest", "My Adventure", player_name="Joe")
    assert adventure is not None
    assert adventure["player_name"] == "Joe"
    loaded = storage.get_adventure(adventure["slug"])
    assert loaded["player_name"] == "Joe"


def test_embark_without_player_name():
    storage.create_template("Quest", "Desc")
    adventure = storage.embark_template("quest", "Run")
    assert adventure["player_name"] == ""


def test_embark_missing():
    assert storage.embark_template("nope", "Title") is None


def test_embark_preset():
    """Can embark directly from a preset template."""
    adventure = storage.embark_template("the-cursed-tavern", "My Tavern Run")
    assert adventure is not None
    assert adventure["template_slug"] == "the-cursed-tavern"


def test_embark_with_intro_writes_message():
    """Embarking a template with intro writes it as first narrator message."""
    storage.create_template("Quest", "Desc")
    storage.update_template("quest", {"intro": "The adventure begins."})
    adv = storage.embark_template("quest", "Run")
    msgs = storage.get_messages(adv["slug"])
    assert len(msgs) == 1
    assert msgs[0]["role"] == "narrator"
    assert msgs[0]["text"] == "The adventure begins."


def test_embark_without_intro_no_messages():
    """Embarking a template without intro starts with empty messages."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    assert storage.get_messages(adv["slug"]) == []


# ── Adventures ───────────────────────────────────────────


def test_list_adventures_empty():
    assert storage.list_adventures() == []


def test_adventure_lifecycle():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "My Run")
    adventures = storage.list_adventures()
    assert len(adventures) == 1
    assert adventures[0]["slug"] == adv["slug"]

    got = storage.get_adventure(adv["slug"])
    assert got["title"] == "My Run"

    assert storage.delete_adventure(adv["slug"]) is True
    assert storage.list_adventures() == []


def test_update_adventure_player_name():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    updated = storage.update_adventure(adv["slug"], {"player_name": "Joe"})
    assert updated is not None
    assert updated["player_name"] == "Joe"
    loaded = storage.get_adventure(adv["slug"])
    assert loaded["player_name"] == "Joe"


def test_update_adventure_ignores_unknown_fields():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    updated = storage.update_adventure(adv["slug"], {"player_name": "Joe", "slug": "hacked"})
    assert updated["player_name"] == "Joe"
    assert updated["slug"] == adv["slug"]


def test_update_adventure_missing():
    assert storage.update_adventure("nope", {"player_name": "X"}) is None


def test_get_adventure_missing():
    assert storage.get_adventure("nonexistent") is None


def test_delete_adventure_missing():
    assert storage.delete_adventure("nope") is False


# ── Name generation ──────────────────────────────────────


def test_generate_adventure_name():
    name = storage.generate_adventure_name("The Cursed Tavern")
    assert name.startswith("The Cursed Tavern in the ")
