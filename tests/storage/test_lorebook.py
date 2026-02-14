"""Tests for lorebook storage."""

from backend import storage


def test_embark_writes_lorebook():
    """Embarking writes lorebook.json automatically."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    path = storage.adventures_dir() / adv["slug"] / "lorebook.json"
    assert path.is_file()


def test_get_lorebook_empty():
    """Returns [] for a new adventure."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    assert storage.get_lorebook(adv["slug"]) == []


def test_save_and_get_lorebook():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    entries = [
        {"title": "Dragon", "content": "A big dragon", "keywords": ["dragon"]},
    ]
    storage.save_lorebook(adv["slug"], entries)
    result = storage.get_lorebook(adv["slug"])
    assert len(result) == 1
    assert result[0]["title"] == "Dragon"


def test_save_lorebook_overwrites():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.save_lorebook(adv["slug"], [
        {"title": "A", "content": "x", "keywords": []},
        {"title": "B", "content": "y", "keywords": []},
    ])
    storage.save_lorebook(adv["slug"], [
        {"title": "C", "content": "z", "keywords": []},
    ])
    result = storage.get_lorebook(adv["slug"])
    assert len(result) == 1
    assert result[0]["title"] == "C"
