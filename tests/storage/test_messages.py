"""Tests for message CRUD operations."""

import pytest

from backend import storage


def test_get_messages_empty():
    """Returns [] when no messages file exists."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    assert storage.get_messages(adv["slug"]) == []


def test_append_and_get_messages():
    """Append + read round-trip."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    msgs = [
        {"role": "player", "text": "I look around", "ts": "2026-01-01T00:00:00Z"},
        {"role": "narrator", "text": "You see a tavern.", "ts": "2026-01-01T00:00:00Z"},
    ]
    storage.append_messages(adv["slug"], msgs)
    result = storage.get_messages(adv["slug"])
    assert len(result) == 2
    assert result[0]["role"] == "player"
    assert result[1]["text"] == "You see a tavern."


def test_append_messages_accumulates():
    """Multiple appends build up history."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.append_messages(adv["slug"], [
        {"role": "player", "text": "Hello", "ts": "2026-01-01T00:00:00Z"},
    ])
    storage.append_messages(adv["slug"], [
        {"role": "narrator", "text": "Hi there.", "ts": "2026-01-01T00:00:01Z"},
    ])
    result = storage.get_messages(adv["slug"])
    assert len(result) == 2
    assert result[0]["text"] == "Hello"
    assert result[1]["text"] == "Hi there."


def test_delete_message_middle():
    """Delete a message from the middle of the list."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.append_messages(adv["slug"], [
        {"role": "player", "text": "A", "ts": "2026-01-01T00:00:00Z"},
        {"role": "narrator", "text": "B", "ts": "2026-01-01T00:00:01Z"},
        {"role": "player", "text": "C", "ts": "2026-01-01T00:00:02Z"},
    ])
    result = storage.delete_message(adv["slug"], 1)
    assert len(result) == 2
    assert result[0]["text"] == "A"
    assert result[1]["text"] == "C"


def test_delete_message_first():
    """Delete the first message."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.append_messages(adv["slug"], [
        {"role": "player", "text": "A", "ts": "2026-01-01T00:00:00Z"},
        {"role": "narrator", "text": "B", "ts": "2026-01-01T00:00:01Z"},
    ])
    result = storage.delete_message(adv["slug"], 0)
    assert len(result) == 1
    assert result[0]["text"] == "B"


def test_delete_message_last():
    """Delete the last message."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.append_messages(adv["slug"], [
        {"role": "player", "text": "A", "ts": "2026-01-01T00:00:00Z"},
        {"role": "narrator", "text": "B", "ts": "2026-01-01T00:00:01Z"},
    ])
    result = storage.delete_message(adv["slug"], 1)
    assert len(result) == 1
    assert result[0]["text"] == "A"


def test_delete_message_out_of_range():
    """Out-of-range index raises IndexError."""
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "Run")
    storage.append_messages(adv["slug"], [
        {"role": "player", "text": "A", "ts": "2026-01-01T00:00:00Z"},
    ])
    with pytest.raises(IndexError):
        storage.delete_message(adv["slug"], 5)
    with pytest.raises(IndexError):
        storage.delete_message(adv["slug"], -1)
