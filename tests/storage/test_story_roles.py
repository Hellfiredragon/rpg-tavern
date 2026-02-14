"""Tests for story roles storage, migration, and connections."""

import json

from backend import storage


# ── Defaults ─────────────────────────────────────────────


def test_get_story_roles_defaults():
    """Returns defaults when no story-roles.json exists."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    roles = storage.get_story_roles(adv["slug"])
    assert roles["narrator"]["prompt"] != ""
    assert roles["character_intention"]["prompt"] != ""
    assert roles["extractor"]["prompt"] != ""
    assert roles["lorebook_extractor"]["prompt"] != ""
    assert roles["max_rounds"] == 3
    assert roles["sandbox"] is False


def test_embark_writes_story_roles():
    """Embarking writes story-roles.json automatically."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    path = storage.adventures_dir() / adv["slug"] / "story-roles.json"
    assert path.is_file()


def test_default_story_roles_character_intention_exists():
    """Default story roles have character_intention with prompt."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    roles = storage.get_story_roles(adv["slug"])
    assert roles["character_intention"]["prompt"] != ""


def test_default_story_roles_has_max_rounds():
    """Default story roles include max_rounds and sandbox."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    roles = storage.get_story_roles(adv["slug"])
    assert roles["max_rounds"] == 3
    assert roles["sandbox"] is False


def test_default_story_roles_have_connection_field():
    """Default story roles include connection field."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    roles = storage.get_story_roles(adv["slug"])
    for role_name in ("narrator", "character_intention", "extractor", "lorebook_extractor"):
        assert "connection" in roles[role_name]
        assert roles[role_name]["connection"] == ""


# ── Update ───────────────────────────────────────────────


def test_update_story_roles_partial():
    """Partial update merges into existing roles."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.update_story_roles(adv["slug"], {
        "character_intention": {"prompt": "Write intention."},
    })
    roles = storage.get_story_roles(adv["slug"])
    assert roles["character_intention"]["prompt"] == "Write intention."
    assert roles["narrator"]["prompt"] != ""


def test_update_story_roles_update_prompt():
    """Can update a role prompt."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.update_story_roles(adv["slug"], {
        "extractor": {"prompt": "Extract data."},
    })
    roles = storage.get_story_roles(adv["slug"])
    assert roles["extractor"]["prompt"] == "Extract data."


def test_update_story_roles_ignores_unknown():
    """Unknown role names are silently ignored."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.update_story_roles(adv["slug"], {
        "unknown_role": {"when": "on_player_message"},
    })
    roles = storage.get_story_roles(adv["slug"])
    assert "unknown_role" not in roles


def test_update_story_roles_connection():
    """update_story_roles persists connection field."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.update_story_roles(adv["slug"], {
        "narrator": {"connection": "my-llm"},
    })
    roles = storage.get_story_roles(adv["slug"])
    assert roles["narrator"]["connection"] == "my-llm"
    assert roles["narrator"]["prompt"] != ""


# ── Migration ────────────────────────────────────────────


def test_story_roles_migration_from_old_format():
    """Old character_writer + when/where format migrates correctly."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    old_roles = {
        "narrator": {"when": "on_player_message", "where": "chat", "prompt": "Narrate."},
        "character_writer": {"when": "after_narration", "where": "chat", "prompt": "Write dialog."},
        "extractor": {"when": "after_narration", "where": "system", "prompt": "Extract."},
    }
    path = storage.adventures_dir() / adv["slug"] / "story-roles.json"
    path.write_text(json.dumps(old_roles, indent=2))

    roles = storage.get_story_roles(adv["slug"])
    assert "character_writer" not in roles
    assert roles["character_intention"]["prompt"] == "Write dialog."
    assert "when" not in roles["narrator"]
    assert "where" not in roles["narrator"]
    assert roles["max_rounds"] == 3
    assert roles["sandbox"] is False
    assert roles["lorebook_extractor"]["prompt"] != ""


# ── Connections ──────────────────────────────────────────


def test_embark_copies_global_connections():
    """embark_template copies global connection defaults into new adventure."""
    storage.create_template("Quest", "Desc")
    storage.update_config({"story_roles": {
        "narrator": "llm-a",
        "extractor": "llm-b",
    }})
    adv = storage.embark_template("quest", "Run")
    roles = storage.get_story_roles(adv["slug"])
    assert roles["narrator"]["connection"] == "llm-a"
    assert roles["extractor"]["connection"] == "llm-b"
    assert roles["character_intention"]["connection"] == ""
    assert roles["lorebook_extractor"]["connection"] == ""
