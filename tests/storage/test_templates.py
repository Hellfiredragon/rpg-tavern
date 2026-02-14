"""Tests for template CRUD, preset merging, and intro."""

import pytest

from backend import storage


# ── Create & List ────────────────────────────────────────


def test_create_and_list_template():
    tmpl = storage.create_template("Test Quest", "A test template")
    assert tmpl["title"] == "Test Quest"
    assert tmpl["slug"] == "test-quest"
    assert tmpl["source"] == "user"

    templates = storage.list_templates()
    slugs = [t["slug"] for t in templates]
    assert "test-quest" in slugs


def test_create_template_collision():
    storage.create_template("Test Quest")
    with pytest.raises(FileExistsError):
        storage.create_template("Test Quest")


def test_create_template_preset_collision():
    """Cannot create a template whose slug collides with a preset."""
    with pytest.raises(FileExistsError):
        storage.create_template("The Cursed Tavern")


# ── Preset merging ───────────────────────────────────────


def test_list_includes_preset():
    """Preset templates appear in listing."""
    templates = storage.list_templates()
    slugs = [t["slug"] for t in templates]
    assert "the-cursed-tavern" in slugs


def test_preset_source_field():
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl is not None
    assert tmpl["source"] == "preset"


def test_user_override_wins():
    """A user template with same slug overrides the preset."""
    storage.update_template("the-cursed-tavern", {"description": "Overridden"})
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl["source"] == "user"
    assert tmpl["description"] == "Overridden"


def test_delete_reveals_preset():
    """Deleting user override reveals the preset underneath."""
    storage.update_template("the-cursed-tavern", {"description": "Overridden"})
    assert storage.get_template("the-cursed-tavern")["source"] == "user"
    storage.delete_template("the-cursed-tavern")
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl is not None
    assert tmpl["source"] == "preset"


# ── Get ──────────────────────────────────────────────────


def test_get_template():
    tmpl = storage.create_template("Quest")
    result = storage.get_template(tmpl["slug"])
    assert result is not None
    assert result["title"] == "Quest"


def test_get_template_missing():
    assert storage.get_template("nonexistent") is None


# ── Update ───────────────────────────────────────────────


def test_update_template():
    storage.create_template("Old Name")
    updated = storage.update_template("old-name", {"title": "New Name"})
    assert updated is not None
    assert updated["title"] == "New Name"
    assert updated["slug"] == "new-name"
    assert storage.get_template("old-name") is None
    assert storage.get_template("new-name") is not None


def test_update_description_no_rename():
    storage.create_template("Quest")
    updated = storage.update_template("quest", {"description": "Updated"})
    assert updated["description"] == "Updated"
    assert updated["slug"] == "quest"


def test_update_ignores_unknown_fields():
    storage.create_template("Quest")
    updated = storage.update_template("quest", {"title": "Quest", "slug": "hacked"})
    assert updated["slug"] == "quest"


def test_update_title_collision():
    storage.create_template("Alpha")
    storage.create_template("Beta")
    with pytest.raises(FileExistsError):
        storage.update_template("beta", {"title": "Alpha"})


def test_update_missing():
    assert storage.update_template("nope", {"title": "X"}) is None


def test_copy_on_write_update():
    """Updating a preset template copies it to data first."""
    updated = storage.update_template(
        "the-cursed-tavern", {"description": "Modified"}
    )
    assert updated["source"] == "user"
    assert updated["description"] == "Modified"
    assert (storage.templates_dir() / "the-cursed-tavern.json").is_file()


# ── Delete ───────────────────────────────────────────────


def test_delete_template():
    storage.create_template("Doomed")
    assert storage.delete_template("doomed") is True
    assert storage.get_template("doomed") is None


def test_delete_template_missing():
    assert storage.delete_template("nope") is False


# ── Intro ────────────────────────────────────────────────


def test_update_template_intro():
    storage.create_template("Quest", "Desc")
    updated = storage.update_template("quest", {"intro": "Welcome to the quest."})
    assert updated["intro"] == "Welcome to the quest."
    reloaded = storage.get_template("quest")
    assert reloaded["intro"] == "Welcome to the quest."
