"""Tests for character, persona, and lorebook extractors."""

import json

from backend import storage
from backend.characters import new_persona
from backend.pipeline import (
    apply_character_extractor,
    apply_lorebook_extractor,
    apply_persona_extractor,
)


# ── apply_character_extractor ──────────────────────────────


def test_apply_character_extractor_updates_state(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    char = {
        "name": "Gareth",
        "slug": "gareth",
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }
    characters = [char]
    storage.save_characters(slug, characters)

    extractor_output = json.dumps({
        "state_changes": [
            {"category": "temporal", "label": "Angry", "value": 8},
        ],
    })

    apply_character_extractor(slug, char, extractor_output, characters)

    saved = storage.get_characters(slug)
    assert len(saved[0]["states"]["temporal"]) == 1
    assert saved[0]["states"]["temporal"][0]["label"] == "Angry"
    assert saved[0]["states"]["temporal"][0]["value"] == 8


def test_apply_character_extractor_updates_existing(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    char = {
        "name": "Gareth",
        "slug": "gareth",
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": [
            {"label": "Angry", "value": 5},
        ]},
        "overflow_pending": False,
    }
    characters = [char]
    storage.save_characters(slug, characters)

    extractor_output = json.dumps({
        "state_changes": [
            {"category": "temporal", "label": "Angry", "value": 12},
        ],
    })

    apply_character_extractor(slug, char, extractor_output, characters)

    saved = storage.get_characters(slug)
    assert saved[0]["states"]["temporal"][0]["value"] == 12


def test_apply_character_extractor_invalid_json(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    char = {
        "name": "Gareth",
        "slug": "gareth",
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }
    characters = [char]
    storage.save_characters(slug, characters)

    apply_character_extractor(slug, char, "not json at all", characters)

    saved = storage.get_characters(slug)
    assert saved[0]["states"]["temporal"] == []


def test_apply_character_extractor_caps_value(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    char = {
        "name": "Gareth",
        "slug": "gareth",
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }
    characters = [char]
    storage.save_characters(slug, characters)

    extractor_output = json.dumps({
        "state_changes": [
            {"category": "persistent", "label": "Loyal", "value": 99},
        ],
    })

    apply_character_extractor(slug, char, extractor_output, characters)

    saved = storage.get_characters(slug)
    assert saved[0]["states"]["persistent"][0]["value"] == 20


def test_apply_character_extractor_strips_markdown_fences(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    char = {
        "name": "Gareth",
        "slug": "gareth",
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }
    characters = [char]
    storage.save_characters(slug, characters)

    extractor_output = '```json\n{"state_changes": [{"category": "temporal", "label": "Happy", "value": 7}]}\n```'

    apply_character_extractor(slug, char, extractor_output, characters)

    saved = storage.get_characters(slug)
    assert saved[0]["states"]["temporal"][0]["label"] == "Happy"


# ── apply_lorebook_extractor ──────────────────────────────


def test_apply_lorebook_extractor_adds_entries(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    extractor_output = json.dumps({
        "lorebook_entries": [
            {"title": "Hidden Cave", "content": "A secret cave behind the waterfall.", "keywords": ["cave", "waterfall"]},
        ],
    })

    apply_lorebook_extractor(slug, extractor_output)

    entries = storage.get_lorebook(slug)
    assert len(entries) == 1
    assert entries[0]["title"] == "Hidden Cave"


def test_apply_lorebook_extractor_skips_duplicates(tmp_path):
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    storage.save_lorebook(slug, [
        {"title": "Hidden Cave", "content": "Known.", "keywords": ["cave"]},
    ])

    extractor_output = json.dumps({
        "lorebook_entries": [
            {"title": "Hidden Cave", "content": "New content.", "keywords": ["cave"]},
            {"title": "Ancient Sword", "content": "A rusty sword.", "keywords": ["sword"]},
        ],
    })

    apply_lorebook_extractor(slug, extractor_output)

    entries = storage.get_lorebook(slug)
    assert len(entries) == 2
    assert entries[0]["title"] == "Hidden Cave"
    assert entries[0]["content"] == "Known."
    assert entries[1]["title"] == "Ancient Sword"


# ── apply_persona_extractor ───────────────────────────────


def test_apply_persona_extractor_updates_state(tmp_path):
    """Persona extractor applies state changes to persona dict."""
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    persona = new_persona("Aldric")
    storage.save_global_personas([persona])

    extractor_output = json.dumps({
        "state_changes": [
            {"category": "temporal", "label": "Cautious", "value": 8},
            {"category": "persistent", "label": "Brave", "value": 5},
        ],
    })

    apply_persona_extractor(slug, persona, extractor_output)

    assert any(s["label"] == "Cautious" and s["value"] == 8 for s in persona["states"]["temporal"])
    assert any(s["label"] == "Brave" and s["value"] == 5 for s in persona["states"]["persistent"])


def test_apply_persona_extractor_copy_on_write(tmp_path):
    """Persona extractor saves to adventure-local storage (copy-on-write)."""
    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    persona = new_persona("Aldric")
    storage.save_global_personas([persona])

    # No adventure-local personas yet
    assert storage.get_adventure_personas(slug) == []

    extractor_output = json.dumps({
        "state_changes": [
            {"category": "temporal", "label": "Alert", "value": 6},
        ],
    })

    apply_persona_extractor(slug, persona, extractor_output)

    # Now persona is saved adventure-locally
    local = storage.get_adventure_personas(slug)
    assert len(local) == 1
    assert local[0]["slug"] == "aldric"
    assert any(s["label"] == "Alert" for s in local[0]["states"]["temporal"])

    # Global persona unchanged on disk
    global_personas = storage.get_global_personas()
    assert global_personas[0]["states"]["temporal"] == []  # global not touched on disk
