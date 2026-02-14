"""Tests for parse_narrator_output and segments_to_text."""

from backend.pipeline import parse_narrator_output, segments_to_text


# ── parse_narrator_output ──────────────────────────────────


def test_parse_simple_narration():
    segments = parse_narrator_output("The wind blows gently.", [])
    assert len(segments) == 1
    assert segments[0]["type"] == "narration"
    assert segments[0]["text"] == "The wind blows gently."


def test_parse_dialog():
    text = "The woman smiles.\nGabrielle(blushed): Hi sweety!"
    segments = parse_narrator_output(text, ["Gabrielle"])
    assert len(segments) == 2
    assert segments[0]["type"] == "narration"
    assert segments[0]["text"] == "The woman smiles."
    assert segments[1]["type"] == "dialog"
    assert segments[1]["character"] == "Gabrielle"
    assert segments[1]["emotion"] == "blushed"
    assert segments[1]["text"] == "Hi sweety!"


def test_parse_dialog_case_insensitive():
    text = "gabrielle(happy): Hello!"
    segments = parse_narrator_output(text, ["Gabrielle"])
    assert len(segments) == 1
    assert segments[0]["type"] == "dialog"
    assert segments[0]["character"] == "Gabrielle"


def test_parse_unknown_name_as_narration():
    text = "Bob(angry): This is mine!"
    segments = parse_narrator_output(text, ["Gabrielle"])
    assert len(segments) == 1
    assert segments[0]["type"] == "narration"
    assert "Bob(angry)" in segments[0]["text"]


def test_parse_mixed_segments():
    text = """The tavern falls silent.
Gareth(stern): Who goes there?
The door creaks open.
Elena(curious): A stranger? How exciting!
Rain pelts the windows."""
    segments = parse_narrator_output(text, ["Gareth", "Elena"])
    assert len(segments) == 5
    assert segments[0]["type"] == "narration"
    assert segments[1]["type"] == "dialog"
    assert segments[1]["character"] == "Gareth"
    assert segments[2]["type"] == "narration"
    assert segments[3]["type"] == "dialog"
    assert segments[3]["character"] == "Elena"
    assert segments[4]["type"] == "narration"


def test_parse_adjacent_narration_merged():
    text = "Line one.\nLine two.\nLine three."
    segments = parse_narrator_output(text, [])
    assert len(segments) == 1
    assert "Line one." in segments[0]["text"]
    assert "Line two." in segments[0]["text"]
    assert "Line three." in segments[0]["text"]


def test_parse_empty_input():
    segments = parse_narrator_output("", [])
    assert len(segments) == 1
    assert segments[0]["type"] == "narration"


def test_parse_whitespace_only():
    segments = parse_narrator_output("   \n  \n  ", [])
    assert len(segments) == 1
    assert segments[0]["type"] == "narration"


def test_parse_nickname_match():
    text = "Cap(gruff): Stand back!"
    segments = parse_narrator_output(text, ["Cap", "Gareth"])
    assert len(segments) == 1
    assert segments[0]["type"] == "dialog"
    assert segments[0]["character"] == "Cap"


def test_parse_player_name_as_dialog():
    """Player name in known_names enables player dialog parsing."""
    text = "Joe pops his eyes open.\nJoe(surprised): Who are you?"
    segments = parse_narrator_output(text, ["Gabrielle", "Joe"])
    assert len(segments) == 2
    assert segments[0]["type"] == "narration"
    assert segments[1]["type"] == "dialog"
    assert segments[1]["character"] == "Joe"
    assert segments[1]["emotion"] == "surprised"


def test_parse_dialog_with_parentheses_in_text():
    text = "Gareth(amused): The king (may he rest) was wise."
    segments = parse_narrator_output(text, ["Gareth"])
    assert len(segments) == 1
    assert segments[0]["type"] == "dialog"
    assert segments[0]["text"] == "The king (may he rest) was wise."


# ── segments_to_text ───────────────────────────────────────


def test_segments_to_text():
    segments = [
        {"type": "narration", "text": "The wind blows."},
        {"type": "dialog", "character": "Gareth", "emotion": "stern", "text": "Halt!"},
        {"type": "narration", "text": "He draws his sword."},
    ]
    text = segments_to_text(segments)
    assert "The wind blows." in text
    assert "Gareth(stern): Halt!" in text
    assert "He draws his sword." in text
