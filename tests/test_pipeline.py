"""Tests for the intention/resolution pipeline."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.pipeline import (
    apply_character_extractor,
    apply_lorebook_extractor,
    parse_narrator_output,
    segments_to_text,
)


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
    assert segments[0]["character"] == "Gabrielle"  # Uses canonical name


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


# ── apply_character_extractor ──────────────────────────────


def test_apply_character_extractor_updates_state(tmp_path):
    from backend import storage

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
    from backend import storage

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
    from backend import storage

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

    # Should not raise, just log warning
    apply_character_extractor(slug, char, "not json at all", characters)

    saved = storage.get_characters(slug)
    assert saved[0]["states"]["temporal"] == []


def test_apply_character_extractor_caps_value(tmp_path):
    from backend import storage

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
    # persistent max is 20
    assert saved[0]["states"]["persistent"][0]["value"] == 20


def test_apply_character_extractor_strips_markdown_fences(tmp_path):
    from backend import storage

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
    from backend import storage

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
    from backend import storage

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
    assert entries[0]["content"] == "Known."  # Not overwritten
    assert entries[1]["title"] == "Ancient Sword"


# ── run_pipeline (mocked LLM) ─────────────────────────────


@pytest.mark.asyncio
async def test_run_pipeline_basic(tmp_path):
    """Pipeline produces narrator message with segments."""
    from backend import storage
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A dark tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "The tavern door swings open."

        result = await run_pipeline(
            slug=slug,
            player_message="I enter the tavern",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    assert len(result["messages"]) == 2  # player + narrator
    assert result["messages"][0]["role"] == "player"
    assert result["messages"][1]["role"] == "narrator"
    assert result["messages"][1]["segments"] is not None
    assert result["messages"][1]["segments"][0]["type"] == "narration"


@pytest.mark.asyncio
async def test_run_pipeline_with_dialog(tmp_path):
    """Pipeline parses dialog in narrator output into segments."""
    from backend import storage
    from backend.characters import new_character
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    gareth = new_character("Gareth")
    gareth["chattiness"] = 0  # won't activate by chattiness
    storage.save_characters(slug, [gareth])

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Gareth looks up.\nGareth(stern): Who goes there?"

        result = await run_pipeline(
            slug=slug,
            player_message="I enter the tavern",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    narrator_msg = result["messages"][1]
    assert len(narrator_msg["segments"]) == 2
    assert narrator_msg["segments"][0]["type"] == "narration"
    assert narrator_msg["segments"][1]["type"] == "dialog"
    assert narrator_msg["segments"][1]["character"] == "Gareth"


@pytest.mark.asyncio
async def test_run_pipeline_no_narrator_connection(tmp_path):
    """Pipeline raises when narrator is unassigned."""
    from backend import storage
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "Desc")
    adv = storage.embark_template("test", "Run")

    config = {
        "llm_connections": [],
        "story_roles": {"narrator": "", "character_intention": "", "extractor": ""},
    }
    story_roles = storage.get_story_roles(adv["slug"])

    with pytest.raises(ValueError, match="Narrator role is not assigned"):
        await run_pipeline(
            slug=adv["slug"],
            player_message="Hello",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )


@pytest.mark.asyncio
async def test_run_pipeline_character_loop(tmp_path):
    """Pipeline runs character intention + resolution when connection assigned."""
    from backend import storage
    from backend.characters import new_character
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    gareth = new_character("Gareth")
    gareth["chattiness"] = 100  # always activates
    storage.save_characters(slug, [gareth])

    config = {
        "llm_connections": [
            {"name": "llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "llm",
            "character_intention": "llm",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    call_count = 0

    async def mock_generate(url, key, prompt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "The tavern is quiet."  # narrator resolves player
        elif call_count == 2:
            return "I look around cautiously."  # Gareth's intention
        elif call_count == 3:
            return "Gareth(cautious): He scans the room carefully."  # narrator resolves Gareth
        return "Nothing more happens."

    with patch("backend.pipeline.llm.generate", side_effect=mock_generate):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    narrator_msg = result["messages"][-1]
    assert narrator_msg["role"] == "narrator"
    # Should have segments from both resolutions
    assert len(narrator_msg["segments"]) >= 2
    # Player message + narrator message
    assert result["messages"][0]["role"] == "player"


@pytest.mark.asyncio
async def test_run_pipeline_sandbox_shows_intentions(tmp_path):
    """In sandbox mode, intention messages are included."""
    from backend import storage
    from backend.characters import new_character
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    storage.save_characters(slug, [gareth])

    config = {
        "llm_connections": [
            {"name": "llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "llm",
            "character_intention": "llm",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)
    story_roles["sandbox"] = True

    call_count = 0

    async def mock_generate(url, key, prompt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "The room is dim."
        elif call_count == 2:
            return "I want to light a torch."
        elif call_count == 3:
            return "Gareth(determined): He reaches for a torch on the wall."
        return ""

    with patch("backend.pipeline.llm.generate", side_effect=mock_generate):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    roles = [m["role"] for m in result["messages"]]
    assert "intention" in roles
    intention_msg = [m for m in result["messages"] if m["role"] == "intention"][0]
    assert intention_msg["character"] == "Gareth"


@pytest.mark.asyncio
async def test_run_pipeline_player_name_in_prompt(tmp_path):
    """Pipeline includes player_name in narrator prompt context."""
    from backend import storage
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A dark tavern")
    adv = storage.embark_template("test", "Run", player_name="Joe")
    slug = adv["slug"]

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    captured_prompt = None

    async def mock_generate(url, key, prompt):
        nonlocal captured_prompt
        captured_prompt = prompt
        return "Joe walks into the tavern.\nJoe(curious): What is this place?"

    with patch("backend.pipeline.llm.generate", side_effect=mock_generate):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter the tavern",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    # Player name should appear in the rendered prompt
    assert "Joe" in captured_prompt
    # Player name dialog should be parsed as dialog segment
    narrator_msg = result["messages"][1]
    dialog_segs = [s for s in narrator_msg["segments"] if s["type"] == "dialog"]
    assert len(dialog_segs) == 1
    assert dialog_segs[0]["character"] == "Joe"


@pytest.mark.asyncio
async def test_run_pipeline_fallback_player_name(tmp_path):
    """Pipeline falls back to 'the adventurer' when player_name is empty."""
    from backend import storage
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")  # no player_name
    slug = adv["slug"]

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    captured_prompt = None

    async def mock_generate(url, key, prompt):
        nonlocal captured_prompt
        captured_prompt = prompt
        return "The tavern door opens."

    with patch("backend.pipeline.llm.generate", side_effect=mock_generate):
        await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    assert "the adventurer" in captured_prompt


@pytest.mark.asyncio
async def test_run_pipeline_active_persona_overrides_player_name(tmp_path):
    """When active_persona is set, persona name replaces player_name in prompt."""
    from backend import storage
    from backend.characters import new_persona
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run", player_name="OldName")
    slug = adv["slug"]

    # Create a global persona and set it active
    persona = new_persona("Aldric")
    persona["description"] = "A wandering sellsword"
    storage.save_global_personas([persona])
    storage.update_adventure(slug, {"active_persona": "aldric"})
    adv = storage.get_adventure(slug)

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    captured_prompt = None

    async def mock_generate(url, key, prompt):
        nonlocal captured_prompt
        captured_prompt = prompt
        return "Aldric enters the tavern."

    with patch("backend.pipeline.llm.generate", side_effect=mock_generate):
        await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    # Persona name should be in prompt, not old player_name
    assert "Aldric" in captured_prompt
    assert "OldName" not in captured_prompt


@pytest.mark.asyncio
async def test_run_pipeline_persona_nicknames_in_known_names(tmp_path):
    """Persona nicknames are used for dialog parsing."""
    from backend import storage
    from backend.characters import new_persona
    from backend.pipeline import run_pipeline

    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    persona = new_persona("Aldric")
    persona["nicknames"] = ["Al"]
    storage.save_global_personas([persona])
    storage.update_adventure(slug, {"active_persona": "aldric"})
    adv = storage.get_adventure(slug)

    config = {
        "llm_connections": [
            {"name": "test-llm", "provider_url": "http://localhost:5001", "api_key": ""},
        ],
        "story_roles": {
            "narrator": "test-llm",
            "character_intention": "",
            "extractor": "",
        },
    }
    story_roles = storage.get_story_roles(slug)

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Al(curious): What is this place?"

        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=config,
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    narrator_msg = result["messages"][1]
    dialog_segs = [s for s in narrator_msg["segments"] if s["type"] == "dialog"]
    assert len(dialog_segs) == 1
    assert dialog_segs[0]["character"] == "Al"
