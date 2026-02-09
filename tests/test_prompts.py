import pytest

from backend.prompts import PromptError, build_context, render_prompt


# ── render_prompt ────────────────────────────────────────────


def test_render_simple_variable():
    result = render_prompt("Hello {{name}}!", {"name": "World"})
    assert result == "Hello World!"


def test_render_each_loop():
    tpl = "{{#each items}}{{this}} {{/each}}"
    result = render_prompt(tpl, {"items": ["a", "b", "c"]})
    assert result == "a b c "


def test_render_if_conditional():
    tpl = "{{#if show}}yes{{else}}no{{/if}}"
    assert render_prompt(tpl, {"show": True}) == "yes"
    assert render_prompt(tpl, {"show": False}) == "no"


def test_render_missing_variable():
    result = render_prompt("Hello {{name}}!", {})
    assert result == "Hello !"


def test_render_invalid_template():
    with pytest.raises(PromptError):
        render_prompt("{{> missing_partial}}", {})


# ── build_context ────────────────────────────────────────────


def test_build_context_basic():
    adventure = {"title": "My Quest", "description": "A great adventure"}
    messages = [
        {"role": "player", "text": "I look around", "ts": "2026-01-01T00:00:00Z"},
        {"role": "narrator", "text": "You see a tavern.", "ts": "2026-01-01T00:00:01Z"},
    ]
    ctx = build_context(adventure, messages, "I enter the tavern")

    assert ctx["title"] == "My Quest"
    assert ctx["description"] == "A great adventure"
    assert ctx["message"] == "I enter the tavern"
    assert len(ctx["messages"]) == 2
    assert ctx["messages"][0]["is_player"] is True
    assert ctx["messages"][0]["is_narrator"] is False
    assert ctx["messages"][1]["is_player"] is False
    assert ctx["messages"][1]["is_narrator"] is True
    assert "narration" not in ctx


def test_build_context_with_narration():
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        narration="The narrator speaks.",
    )
    assert ctx["narration"] == "The narrator speaks."


def test_build_context_history_format():
    messages = [
        {"role": "player", "text": "I look around"},
        {"role": "narrator", "text": "You see a tavern."},
    ]
    ctx = build_context({"title": "T", "description": "D"}, messages, "next")
    assert "> I look around" in ctx["history"]
    assert "You see a tavern." in ctx["history"]
    # Player messages have > prefix, narrator messages don't
    lines = ctx["history"].split("\n")
    assert lines[0] == "> I look around"
    assert lines[2] == "You see a tavern."


def test_build_context_empty_messages():
    ctx = build_context({"title": "T", "description": "D"}, [], "hello")
    assert ctx["messages"] == []
    assert ctx["history"] == ""


# ── Default narrator prompt reproduces old _build_prompt ─────


def test_default_narrator_prompt_matches_legacy():
    """The default Handlebars narrator prompt produces the same output
    as the old _build_prompt() function."""
    from backend.storage import DEFAULT_NARRATOR_PROMPT

    adventure = {"title": "Quest", "description": "A dark forest"}
    messages = [
        {"role": "player", "text": "I look around", "ts": "t1"},
        {"role": "narrator", "text": "You see trees.", "ts": "t2"},
    ]
    ctx = build_context(adventure, messages, "I go north")
    result = render_prompt(DEFAULT_NARRATOR_PROMPT, ctx)

    # Legacy format:
    # {description}\n\n> {player}\n\n{narrator}\n\n> {new_intent}\n
    expected = "A dark forest\n\n> I look around\n\nYou see trees.\n\n> I go north\n"
    assert result == expected
