"""Tests for Handlebars prompt rendering: template compilation, context building,
custom helpers (take, last), and error handling."""

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
    assert len(ctx["msgs"]) == 2
    assert ctx["msgs"][0]["is_player"] is True
    assert ctx["msgs"][0]["is_narrator"] is False
    assert ctx["msgs"][1]["is_player"] is False
    assert ctx["msgs"][1]["is_narrator"] is True
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
    assert ctx["msgs"] == []
    assert ctx["history"] == ""


# ── Default narrator prompt reproduces old _build_prompt ─────


# ── helpers: take & last ────────────────────────────────────


def test_take_first_n():
    tpl = "{{#take items 2}}{{this}} {{/take}}"
    result = render_prompt(tpl, {"items": ["a", "b", "c", "d"]})
    assert result == "a b "


def test_take_more_than_length():
    tpl = "{{#take items 10}}{{this}} {{/take}}"
    result = render_prompt(tpl, {"items": ["a", "b"]})
    assert result == "a b "


def test_take_with_objects():
    tpl = "{{#take msgs 1}}{{text}}{{/take}}"
    result = render_prompt(tpl, {"msgs": [{"text": "first"}, {"text": "second"}]})
    assert result == "first"


def test_last_n():
    tpl = "{{#last items 2}}{{this}} {{/last}}"
    result = render_prompt(tpl, {"items": ["a", "b", "c", "d"]})
    assert result == "c d "


def test_last_more_than_length():
    tpl = "{{#last items 10}}{{this}} {{/last}}"
    result = render_prompt(tpl, {"items": ["a", "b"]})
    assert result == "a b "


def test_last_with_objects():
    tpl = "{{#last msgs 1}}{{text}}{{/last}}"
    result = render_prompt(tpl, {"msgs": [{"text": "first"}, {"text": "second"}]})
    assert result == "second"


def test_build_context_with_characters():
    char_ctx = {
        "list": [{"name": "Gareth", "slug": "gareth", "descriptions": ["Loyal drives their actions"]}],
        "summary": "Gareth: Loyal drives their actions",
    }
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        chars=char_ctx,
    )
    assert ctx["chars"]["list"] == char_ctx["list"]
    assert ctx["chars"]["summary"] == char_ctx["summary"]


def test_build_context_without_characters():
    ctx = build_context({"title": "T", "description": "D"}, [], "hello")
    assert "chars" not in ctx


def test_build_context_with_lorebook():
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        lore_text="[Dragon] A big dragon",
        lore_entries=[{"title": "Dragon", "content": "A big dragon", "keywords": ["dragon"]}],
    )
    assert ctx["lore"]["text"] == "[Dragon] A big dragon"
    assert len(ctx["lore"]["entries"]) == 1
    assert ctx["lore"]["entries"][0]["title"] == "Dragon"


def test_build_context_without_lorebook():
    ctx = build_context({"title": "T", "description": "D"}, [], "hello")
    assert "lore" not in ctx


def test_build_context_with_chars_extra_fields():
    """chars dict is passed through directly, supporting any keys."""
    chars_ctx = {
        "list": [{"name": "Gareth", "descriptions": []}],
        "summary": "Gareth: (no notable states)",
        "active": [{"name": "Gareth"}],
        "active_summary": "Gareth: (no notable states)",
    }
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        chars=chars_ctx,
    )
    assert len(ctx["chars"]["active"]) == 1
    assert ctx["chars"]["active_summary"] == "Gareth: (no notable states)"


def test_build_context_with_player_name():
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        player_name="Joe",
    )
    assert ctx["player_name"] == "Joe"


def test_build_context_without_player_name():
    ctx = build_context({"title": "T", "description": "D"}, [], "hello")
    assert "player_name" not in ctx


def test_default_narrator_prompt_renders():
    """The default narrator prompt renders without errors."""
    from backend.storage import DEFAULT_NARRATOR_PROMPT

    adventure = {"title": "Quest", "description": "A dark forest"}
    messages = [
        {"role": "player", "text": "I look around", "ts": "t1"},
        {"role": "narrator", "text": "You see trees.", "ts": "t2"},
    ]
    ctx = build_context(
        adventure, messages, "I go north",
        intention="I go north",
        chars={
            "list": [{"name": "Gareth", "descriptions": ["Loyal"]}],
            "summary": "Gareth: Loyal",
        },
        player_name="Joe",
    )
    result = render_prompt(DEFAULT_NARRATOR_PROMPT, ctx)
    assert "A dark forest" in result
    assert "I go north" in result
    assert "Gareth: Loyal" in result
    assert "Joe" in result


def test_default_character_intention_prompt_renders():
    from backend.storage import DEFAULT_CHARACTER_INTENTION_PROMPT

    ctx = build_context(
        {"title": "T", "description": "D"},
        [{"role": "narrator", "text": "The battle rages.", "ts": "t1"}],
        "I attack",
        narration_so_far="The enemy falls back.",
        char_name="Gareth",
        char_description="A loyal knight",
        char_states=[
            {"label": "Loyal", "value": 18, "category": "core", "level": "dominant",
             "description": "Loyal dominates their current priorities",
             "is_silent": False, "is_subconscious": False, "is_manifest": False,
             "is_dominant": True, "is_definitive": False},
        ],
        player_name="Joe",
    )
    result = render_prompt(DEFAULT_CHARACTER_INTENTION_PROMPT, ctx)
    assert "Gareth" in result
    assert "The enemy falls back." in result
    assert "Loyal dominates their current priorities" in result
    assert "Joe" in result


def test_default_character_extractor_prompt_renders():
    from backend.storage import DEFAULT_CHARACTER_EXTRACTOR_PROMPT

    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "I look around",
        narration="You see a tavern.",
        char_name="Gareth",
        char_all_states=[
            {"label": "Angry", "value": 3, "category": "temporal", "level": "silent",
             "description": "", "is_silent": True, "is_subconscious": False,
             "is_manifest": False, "is_dominant": False, "is_definitive": False},
        ],
        player_name="Joe",
    )
    result = render_prompt(DEFAULT_CHARACTER_EXTRACTOR_PROMPT, ctx)
    assert "You see a tavern." in result
    assert "state_changes" in result
    assert "Gareth" in result
    assert "temporal/Angry = 3 (silent)" in result
    assert "Joe" in result


def test_build_context_with_player_persona():
    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "hello",
        player_name="Aldric",
        player_description="A wandering sellsword",
        player_states=[
            {"label": "Brave", "value": 12, "category": "core", "level": "manifest",
             "description": "Brave is manifest in their body language"},
        ],
    )
    assert ctx["player_name"] == "Aldric"
    assert ctx["player"]["description"] == "A wandering sellsword"
    assert len(ctx["player"]["states"]) == 1
    assert ctx["player"]["states"][0]["label"] == "Brave"


def test_build_context_without_player_persona():
    ctx = build_context({"title": "T", "description": "D"}, [], "hello")
    assert "player" not in ctx


def test_default_lorebook_extractor_prompt_renders():
    from backend.storage import DEFAULT_LOREBOOK_EXTRACTOR_PROMPT

    ctx = build_context(
        {"title": "T", "description": "D"},
        [],
        "I explore",
        round_narrations="The tavern has a secret cellar.",
    )
    result = render_prompt(DEFAULT_LOREBOOK_EXTRACTOR_PROMPT, ctx)
    assert "secret cellar" in result
    assert "lorebook_entries" in result
