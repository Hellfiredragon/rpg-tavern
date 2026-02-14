"""Tests for lorebook keyword matching, deduplication, and formatting."""

from backend.lorebook import format_lorebook, match_lorebook_entries


# ── match_lorebook_entries ────────────────────────────────────


def test_match_by_keyword():
    entries = [
        {"title": "Dragon", "content": "A big dragon", "keywords": ["dragon", "fire"]},
        {"title": "Village", "content": "A small village", "keywords": ["village"]},
    ]
    matched = match_lorebook_entries(entries, ["I see a dragon"])
    assert len(matched) == 1
    assert matched[0]["title"] == "Dragon"


def test_match_case_insensitive():
    entries = [
        {"title": "Dragon", "content": "A big dragon", "keywords": ["dragon"]},
    ]
    matched = match_lorebook_entries(entries, ["I see a DRAGON"])
    assert len(matched) == 1


def test_match_keyword_case_insensitive():
    entries = [
        {"title": "Dragon", "content": "A big dragon", "keywords": ["Dragon"]},
    ]
    matched = match_lorebook_entries(entries, ["the dragon breathes fire"])
    assert len(matched) == 1


def test_match_substring():
    entries = [
        {"title": "Dragon", "content": "A big dragon", "keywords": ["dragon"]},
    ]
    matched = match_lorebook_entries(entries, ["The dragonfire burns"])
    assert len(matched) == 1


def test_match_multiple_texts():
    entries = [
        {"title": "Dragon", "content": "desc", "keywords": ["dragon"]},
        {"title": "Village", "content": "desc", "keywords": ["village"]},
    ]
    matched = match_lorebook_entries(entries, ["dragon ahead", "the village burns"])
    assert len(matched) == 2


def test_match_dedup():
    """Same entry should not appear twice even if multiple keywords match."""
    entries = [
        {"title": "Dragon", "content": "desc", "keywords": ["dragon", "fire"]},
    ]
    matched = match_lorebook_entries(entries, ["the dragon breathes fire"])
    assert len(matched) == 1


def test_match_no_match():
    entries = [
        {"title": "Dragon", "content": "desc", "keywords": ["dragon"]},
    ]
    matched = match_lorebook_entries(entries, ["I look around the tavern"])
    assert len(matched) == 0


def test_match_empty_entries():
    matched = match_lorebook_entries([], ["dragon"])
    assert matched == []


def test_match_empty_texts():
    entries = [
        {"title": "Dragon", "content": "desc", "keywords": ["dragon"]},
    ]
    matched = match_lorebook_entries(entries, [])
    assert matched == []


def test_match_preserves_order():
    entries = [
        {"title": "A", "content": "desc", "keywords": ["alpha"]},
        {"title": "B", "content": "desc", "keywords": ["beta"]},
        {"title": "C", "content": "desc", "keywords": ["gamma"]},
    ]
    matched = match_lorebook_entries(entries, ["gamma and alpha"])
    assert [e["title"] for e in matched] == ["A", "C"]


# ── format_lorebook ──────────────────────────────────────────


def test_format_lorebook_empty():
    assert format_lorebook([]) == ""


def test_format_lorebook_single():
    entries = [{"title": "Dragon", "content": "A big dragon"}]
    result = format_lorebook(entries)
    assert result == "[Dragon] A big dragon"


def test_format_lorebook_multiple():
    entries = [
        {"title": "Dragon", "content": "A big dragon"},
        {"title": "Village", "content": "A small village"},
    ]
    result = format_lorebook(entries)
    assert "[Dragon] A big dragon" in result
    assert "[Village] A small village" in result
    assert result.count("\n") == 1
