"""Tests for run_pipeline with mocked LLM."""

from unittest.mock import AsyncMock, patch

import pytest

from backend import storage
from backend.characters import new_character, new_persona
from backend.pipeline import run_pipeline


@pytest.mark.asyncio
async def test_run_pipeline_basic(tmp_path):
    """Pipeline produces narrator message with segments."""
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

    assert len(result["messages"]) == 2
    assert result["messages"][0]["role"] == "player"
    assert result["messages"][1]["role"] == "narrator"
    assert result["messages"][1]["segments"] is not None
    assert result["messages"][1]["segments"][0]["type"] == "narration"


@pytest.mark.asyncio
async def test_run_pipeline_with_dialog(tmp_path):
    """Pipeline parses dialog in narrator output into segments."""
    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    gareth = new_character("Gareth")
    gareth["chattiness"] = 0
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

    call_count = 0

    async def mock_generate(url, key, prompt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "The tavern is quiet."
        elif call_count == 2:
            return "I look around cautiously."
        elif call_count == 3:
            return "Gareth(cautious): He scans the room carefully."
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
    assert len(narrator_msg["segments"]) >= 2
    assert result["messages"][0]["role"] == "player"


@pytest.mark.asyncio
async def test_run_pipeline_sandbox_shows_intentions(tmp_path):
    """In sandbox mode, intention messages are included."""
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

    assert "Joe" in captured_prompt
    narrator_msg = result["messages"][1]
    dialog_segs = [s for s in narrator_msg["segments"] if s["type"] == "dialog"]
    assert len(dialog_segs) == 1
    assert dialog_segs[0]["character"] == "Joe"


@pytest.mark.asyncio
async def test_run_pipeline_fallback_player_name(tmp_path):
    """Pipeline falls back to 'the adventurer' when player_name is empty."""
    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
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
    storage.init_storage(tmp_path)
    storage.create_template("Test", "A tavern")
    adv = storage.embark_template("test", "Run", player_name="OldName")
    slug = adv["slug"]

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

    assert "Aldric" in captured_prompt
    assert "OldName" not in captured_prompt


@pytest.mark.asyncio
async def test_run_pipeline_persona_nicknames_in_known_names(tmp_path):
    """Persona nicknames are used for dialog parsing."""
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
