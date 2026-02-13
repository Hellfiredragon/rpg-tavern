"""Tests for persona storage, CRUD, and merge logic."""

import json

from backend import storage
from backend.characters import new_persona


# ── new_persona ──────────────────────────────────────────────


def test_new_persona_structure():
    """Persona has description, no chattiness."""
    p = new_persona("Aldric")
    assert p["name"] == "Aldric"
    assert p["slug"] == "aldric"
    assert p["description"] == ""
    assert p["nicknames"] == []
    assert p["states"] == {"core": [], "persistent": [], "temporal": []}
    assert p["overflow_pending"] is False
    assert "chattiness" not in p


# ── Global personas CRUD ─────────────────────────────────────


def test_global_personas_crud():
    """Create, read, update, delete global personas."""
    assert storage.get_global_personas() == []

    p = new_persona("Aldric")
    storage.save_global_personas([p])
    result = storage.get_global_personas()
    assert len(result) == 1
    assert result[0]["name"] == "Aldric"

    # Update
    result[0]["description"] = "A wanderer"
    storage.save_global_personas(result)
    reloaded = storage.get_global_personas()
    assert reloaded[0]["description"] == "A wanderer"

    # Delete
    storage.save_global_personas([])
    assert storage.get_global_personas() == []


# ── Adventure personas CRUD ──────────────────────────────────


def test_adventure_personas_crud():
    """Create, read, update, delete adventure-local personas."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    slug = adv["slug"]

    assert storage.get_adventure_personas(slug) == []

    p = new_persona("Kira")
    storage.save_adventure_personas(slug, [p])
    result = storage.get_adventure_personas(slug)
    assert len(result) == 1
    assert result[0]["name"] == "Kira"

    # Delete
    storage.save_adventure_personas(slug, [])
    assert storage.get_adventure_personas(slug) == []


# ── Merge logic ──────────────────────────────────────────────


def test_merged_personas_precedence():
    """Adventure-local persona wins over global with same slug."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    slug = adv["slug"]

    g = new_persona("Aldric")
    g["description"] = "Global version"
    storage.save_global_personas([g])

    l = new_persona("Aldric")
    l["description"] = "Local version"
    storage.save_adventure_personas(slug, [l])

    merged = storage.get_merged_personas(slug)
    assert len(merged) == 1
    assert merged[0]["description"] == "Local version"
    assert merged[0]["source"] == "adventure"


def test_merged_personas_source_tags():
    """Source field is set correctly in merged list."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    slug = adv["slug"]

    g = new_persona("Aldric")
    storage.save_global_personas([g])

    l = new_persona("Kira")
    storage.save_adventure_personas(slug, [l])

    merged = storage.get_merged_personas(slug)
    by_slug = {p["slug"]: p for p in merged}
    assert by_slug["aldric"]["source"] == "global"
    assert by_slug["kira"]["source"] == "adventure"


def test_merged_personas_no_global():
    """Merge works when no global personas exist."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    slug = adv["slug"]

    l = new_persona("Kira")
    storage.save_adventure_personas(slug, [l])

    merged = storage.get_merged_personas(slug)
    assert len(merged) == 1
    assert merged[0]["source"] == "adventure"


def test_merged_personas_no_local():
    """Merge returns globals when no adventure-local personas exist."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    slug = adv["slug"]

    g = new_persona("Aldric")
    storage.save_global_personas([g])

    merged = storage.get_merged_personas(slug)
    assert len(merged) == 1
    assert merged[0]["source"] == "global"


# ── Embark ────────────────────────────────────────────────────


def test_embark_creates_empty_personas():
    """Embarking writes an empty personas.json."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    path = storage.adventures_dir() / adv["slug"] / "personas.json"
    assert path.is_file()
    assert json.loads(path.read_text()) == []


# ── update_adventure with active_persona ─────────────────────


def test_update_adventure_active_persona():
    """active_persona can be set via update_adventure."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    updated = storage.update_adventure(adv["slug"], {"active_persona": "aldric"})
    assert updated["active_persona"] == "aldric"
    loaded = storage.get_adventure(adv["slug"])
    assert loaded["active_persona"] == "aldric"
