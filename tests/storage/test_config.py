"""Tests for config storage, including font_settings merge and migration."""

import json

from backend import storage


def test_get_config_empty():
    """Returns defaults when no config file exists."""
    config = storage.get_config()
    assert config["llm_connections"] == []
    assert config["story_roles"] == {
        "narrator": "",
        "character_intention": "",
        "extractor": "",
        "lorebook_extractor": "",
    }
    assert config["app_width_percent"] == 100


def test_update_config_connections():
    """Adding connections replaces the array and persists."""
    conns = [
        {
            "name": "My KoboldCpp",
            "provider_url": "http://localhost:5001",
            "api_key": "",
        }
    ]
    result = storage.update_config({"llm_connections": conns})
    assert len(result["llm_connections"]) == 1
    assert result["llm_connections"][0]["name"] == "My KoboldCpp"

    reloaded = storage.get_config()
    assert reloaded["llm_connections"][0]["provider_url"] == "http://localhost:5001"


def test_update_config_roles():
    """Partial role update preserves other roles."""
    storage.update_config({"story_roles": {"narrator": "My OpenAI"}})
    storage.update_config({"story_roles": {"extractor": "Local LLM"}})

    config = storage.get_config()
    assert config["story_roles"]["narrator"] == "My OpenAI"
    assert config["story_roles"]["extractor"] == "Local LLM"
    assert config["story_roles"]["character_intention"] == ""


def test_update_config_partial():
    """Scalar and roles updates are independent."""
    storage.update_config({"story_roles": {"narrator": "X"}})
    storage.update_config({"app_width_percent": 75})

    config = storage.get_config()
    assert config["story_roles"]["narrator"] == "X"
    assert config["app_width_percent"] == 75
    assert config["llm_connections"] == []


def test_update_config_replaces_connections_array():
    """Sending a new connections array fully replaces the old one."""
    storage.update_config({"llm_connections": [
        {"name": "A", "provider_url": "", "api_key": ""},
        {"name": "B", "provider_url": "", "api_key": ""},
    ]})
    storage.update_config({"llm_connections": [
        {"name": "C", "provider_url": "", "api_key": ""},
    ]})

    config = storage.get_config()
    assert len(config["llm_connections"]) == 1
    assert config["llm_connections"][0]["name"] == "C"


def test_config_includes_lorebook_extractor():
    """get_config includes lorebook_extractor in story_roles defaults."""
    config = storage.get_config()
    assert "lorebook_extractor" in config["story_roles"]
    assert config["story_roles"]["lorebook_extractor"] == ""


# ── New: font_settings merge ─────────────────────────────


def test_font_settings_merge():
    """update_config merges font_settings per-group, not wholesale."""
    storage.update_config({"font_settings": {
        "narration": {"family": "Georgia"},
    }})
    config = storage.get_config()
    # narration family changed
    assert config["font_settings"]["narration"]["family"] == "Georgia"
    # narration size/style preserved from defaults
    assert config["font_settings"]["narration"]["size"] == 18
    assert config["font_settings"]["narration"]["style"] == "normal"
    # other groups untouched
    assert config["font_settings"]["dialog"]["family"] == "Crimson Text"
    assert config["font_settings"]["heading"]["family"] == "Cinzel"


# ── New: character_writer migration in config ────────────


def test_config_story_roles_migration():
    """Old character_writer in stored config migrates to character_intention."""
    # Write config with old character_writer key directly
    config_path = storage.data_dir() / "config.json"
    raw = {
        "llm_connections": [],
        "story_roles": {
            "narrator": "llm-a",
            "character_writer": "llm-b",
            "extractor": "",
        },
    }
    config_path.write_text(json.dumps(raw))

    config = storage.get_config()
    assert "character_writer" not in config["story_roles"]
    assert config["story_roles"]["character_intention"] == "llm-b"
    assert config["story_roles"]["narrator"] == "llm-a"
