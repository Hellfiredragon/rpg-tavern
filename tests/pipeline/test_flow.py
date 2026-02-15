"""End-to-end pipeline flow tests with mocked LLM responses.

Each test sets up a specific scenario (characters, connections, story roles)
and provides canned LLM responses to verify the pipeline produces the correct
message structure, calls LLM in the right order, and runs extractors properly.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend import storage
from backend.characters import new_character, new_persona
from backend.pipeline import run_pipeline


# ── Helpers ──────────────────────────────────────────────


def _setup_adventure(tmp_path, characters=None, persona=None, active_persona_slug=""):
    """Create a minimal adventure with optional characters and persona."""
    storage.init_storage(tmp_path)
    storage.create_template("Test", "A dark tavern at the crossroads")
    adv = storage.embark_template("test", "Run")
    slug = adv["slug"]

    if characters:
        storage.save_characters(slug, characters)
    if persona:
        storage.save_global_personas([persona])
        if active_persona_slug:
            storage.update_adventure(slug, {"active_persona": active_persona_slug})
            adv = storage.get_adventure(slug)

    return adv, slug


def _config(narrator=True, intention=True, extractor=True, lorebook_extractor=None):
    """Build a config dict with optional connection assignments."""
    if lorebook_extractor is None:
        lorebook_extractor = extractor
    conns = [{"name": "llm", "provider_url": "http://localhost:5001", "api_key": ""}]
    return {
        "llm_connections": conns,
        "story_roles": {
            "narrator": "llm" if narrator else "",
            "character_intention": "llm" if intention else "",
            "extractor": "llm" if extractor else "",
            "lorebook_extractor": "llm" if lorebook_extractor else "",
        },
    }


class LLMSequence:
    """Track LLM calls in order and return canned responses.

    Use with: patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq)
    """

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []  # list of (url, key, prompt) tuples
        self._index = 0

    def __call__(self, url, key, prompt):
        self.calls.append((url, key, prompt))
        idx = self._index
        self._index += 1
        if idx < len(self.responses):
            return self.responses[idx]
        return ""

    @property
    def call_count(self):
        return len(self.calls)

    def prompt(self, index):
        return self.calls[index][2]


# ── Test: Full pipeline with 1 character, all connections ──


@pytest.mark.asyncio
async def test_full_flow_single_character(tmp_path):
    """Player intention -> narrator -> extractor -> char intention -> narrator -> extractor -> lorebook.

    Verifies the exact LLM call sequence and message structure for a single round.
    """
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "The tavern door creaks open. Gareth looks up from his ale.",
        json.dumps({"state_changes": [{"category": "temporal", "label": "Alert", "value": 7}]}),
        "I want to see who just walked in.",
        "Gareth(cautious): Who goes there?\nHe reaches for his sword hilt.",
        json.dumps({"state_changes": [{"category": "temporal", "label": "Suspicious", "value": 8}]}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I push open the tavern door",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 6

    msgs = result["messages"]
    assert msgs[0]["role"] == "player"
    assert msgs[0]["text"] == "I push open the tavern door"

    # Phase 1: narrator text (narration only, no dialog)
    assert msgs[1]["role"] == "narrator"
    assert "tavern door creaks open" in msgs[1]["text"]

    # Intention always stored
    assert msgs[2]["role"] == "intention"

    # Character round: dialog + narration
    dialog_msgs = [m for m in msgs if m["role"] == "dialog"]
    assert len(dialog_msgs) == 1
    assert dialog_msgs[0]["character"] == "Gareth"
    assert dialog_msgs[0]["emotion"] == "cautious"

    chars = storage.get_characters(slug)
    temporal_labels = {s["label"] for s in chars[0]["states"]["temporal"]}
    assert "Alert" in temporal_labels
    assert "Suspicious" in temporal_labels


@pytest.mark.asyncio
async def test_full_flow_message_order_with_intentions(tmp_path):
    """Intentions always appear between narration messages."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "The room is dim.",
        "I reach for my sword.",
        "Gareth(wary): He draws his blade slowly.",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    msgs = result["messages"]
    roles = [m["role"] for m in msgs]
    # player, narrator(Phase 1), intention, dialog(round)
    assert roles == ["player", "narrator", "intention", "dialog"]

    intention_msg = msgs[2]
    assert intention_msg["character"] == "Gareth"
    assert intention_msg["text"] == "I reach for my sword."


# ── Test: Multiple characters in one round ────────────────


@pytest.mark.asyncio
async def test_multiple_characters_one_round(tmp_path):
    """Two characters both activate in a single round."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    elena = new_character("Elena")
    elena["chattiness"] = 100

    adv, slug = _setup_adventure(tmp_path, characters=[gareth, elena])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "A stranger enters. Gareth and Elena notice immediately.",
        json.dumps({"state_changes": []}),
        json.dumps({"state_changes": []}),
        "I want to confront the stranger.",
        "Gareth(stern): State your business.",
        json.dumps({"state_changes": []}),
        "I'll observe from a distance.",
        "Elena watches quietly from behind the bar.\nElena(curious): Interesting...",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter the tavern",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    msgs = result["messages"]
    # player, narrator(Phase 1), intention(Gareth), dialog(Gareth),
    # intention(Elena), narrator(Elena watches...), dialog(Elena)
    intention_msgs = [m for m in msgs if m["role"] == "intention"]
    assert len(intention_msgs) == 2
    assert intention_msgs[0]["character"] == "Gareth"
    assert intention_msgs[1]["character"] == "Elena"

    dialog_msgs = [m for m in msgs if m["role"] == "dialog"]
    dialog_chars = [m["character"] for m in dialog_msgs]
    assert "Gareth" in dialog_chars
    assert "Elena" in dialog_chars


# ── Test: Max rounds cap ──────────────────────────────────


@pytest.mark.asyncio
async def test_max_rounds_caps_loop(tmp_path):
    """max_rounds=2 means exactly 2 rounds of character intention+resolution."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 2

    llm_seq = LLMSequence([
        "Gareth sits in the corner.",
        json.dumps({"state_changes": []}),
        "I look around.",
        "Gareth glances about.",
        json.dumps({"state_changes": []}),
        "I keep watching.",
        "Gareth continues to watch.",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I sit down",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 9


# ── Test: No characters -> no rounds ──────────────────────


@pytest.mark.asyncio
async def test_no_characters_skips_rounds(tmp_path):
    """Without characters, the round loop is skipped entirely."""
    adv, slug = _setup_adventure(tmp_path, characters=[])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The empty tavern greets you with silence.",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    assert llm_seq.call_count == 2
    assert len(result["messages"]) == 2
    assert result["messages"][1]["role"] == "narrator"
    assert result["messages"][1]["text"] == "The empty tavern greets you with silence."


# ── Test: Character with 0 chattiness not named -> not activated ──


@pytest.mark.asyncio
async def test_zero_chattiness_not_named_skips_character(tmp_path):
    """A character with 0% chattiness who isn't named in narration won't activate."""
    bob = new_character("Bob")
    bob["chattiness"] = 0
    adv, slug = _setup_adventure(tmp_path, characters=[bob])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The tavern is empty and quiet.",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 2
    assert len(result["messages"]) == 2


# ── Test: Character extractor runs after Phase 1 for named chars ──


@pytest.mark.asyncio
async def test_extractor_runs_phase1_for_named_character(tmp_path):
    """Extractor runs for a character mentioned in the Phase 1 narrator output."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 0
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "Gareth waves from the bar.",
        json.dumps({"state_changes": [{"category": "temporal", "label": "Friendly", "value": 9}]}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=_config(intention=False),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 3
    chars = storage.get_characters(slug)
    assert any(s["label"] == "Friendly" for s in chars[0]["states"]["temporal"])


@pytest.mark.asyncio
async def test_extractor_skipped_for_unnamed_character_phase1(tmp_path):
    """Extractor does NOT run for a character not mentioned in Phase 1."""
    bob = new_character("Bob")
    bob["chattiness"] = 0
    adv, slug = _setup_adventure(tmp_path, characters=[bob])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The tavern is silent.",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 2


# ── Test: Lorebook extractor gets all round narrations ────


@pytest.mark.asyncio
async def test_lorebook_extractor_receives_all_narrations(tmp_path):
    """Lorebook extractor prompt contains narration from Phase 1 and all rounds."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    phase1_narration = "The ancient tavern stands at the crossroads."
    round1_narration = "Gareth inspects the old fireplace."

    llm_seq = LLMSequence([
        phase1_narration,
        "I want to check the fireplace.",
        round1_narration,
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    lorebook_prompt = llm_seq.prompt(4)
    assert phase1_narration in lorebook_prompt
    assert round1_narration in lorebook_prompt


# ── Test: Persona extractor runs when persona named ───────


@pytest.mark.asyncio
async def test_persona_extractor_runs_when_named(tmp_path):
    """Persona extractor runs when active persona's name appears in narration."""
    persona = new_persona("Aldric")
    persona["nicknames"] = ["Al"]
    adv, slug = _setup_adventure(tmp_path, persona=persona, active_persona_slug="aldric")
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "Aldric steps into the dim tavern.",
        json.dumps({"state_changes": [{"category": "temporal", "label": "Cautious", "value": 8}]}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    assert llm_seq.call_count == 3
    local_personas = storage.get_adventure_personas(slug)
    assert len(local_personas) == 1
    assert any(s["label"] == "Cautious" for s in local_personas[0]["states"]["temporal"])


# ── Test: Empty narrator response ─────────────────────────


@pytest.mark.asyncio
async def test_empty_narrator_response(tmp_path):
    """When narrator returns empty text, pipeline still produces valid output."""
    adv, slug = _setup_adventure(tmp_path)
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    # Only player message (empty narration produces no narrator messages)
    assert result["messages"][0]["role"] == "player"


@pytest.mark.asyncio
async def test_empty_narrator_with_character_rounds(tmp_path):
    """When narrator returns empty for both Phase 1 and rounds,
    the pipeline doesn't crash."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 2

    async def mock_gen(url, key, prompt):
        if "what YOU want to do" in prompt or "State what" in prompt:
            return "I want to do something."
        if "state_changes" in prompt or "state changes" in prompt or "State Label" in prompt:
            return json.dumps({"state_changes": []})
        if "lorebook" in prompt.lower() or "world facts" in prompt.lower():
            return json.dumps({"lorebook_entries": []})
        return ""

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=mock_gen):
        result = await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    # Should have at least player message + intention
    assert result["messages"][0]["role"] == "player"


# ── Test: No intention connection -> no character rounds ───


@pytest.mark.asyncio
async def test_no_intention_connection_skips_rounds(tmp_path):
    """Without character_intention connection, rounds are skipped even with characters."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "Gareth nods at you.",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I wave at Gareth",
            adventure=adv,
            config=_config(intention=False),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 3
    assert len(result["messages"]) == 2


# ── Test: No extractor connection -> states not updated ────


@pytest.mark.asyncio
async def test_no_extractor_connection_skips_extraction(tmp_path):
    """Without extractor connection, character states are not updated."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "Gareth looks up.",
        "I want to investigate.",
        "Gareth searches the room.",
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=_config(extractor=False),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 3
    chars = storage.get_characters(slug)
    assert chars[0]["states"]["temporal"] == []


# ── Test: Characters are ticked at end of turn ────────────


@pytest.mark.asyncio
async def test_character_states_ticked_at_end(tmp_path):
    """Character states are ticked (temporal decay, persistent growth) after the pipeline."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 0
    gareth["states"]["temporal"] = [{"label": "Angry", "value": 3}]
    gareth["states"]["persistent"] = [{"label": "Loyal", "value": 10}]
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The room is quiet.",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I wait",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    chars = storage.get_characters(slug)
    assert chars[0]["states"]["temporal"][0]["value"] == 2
    assert chars[0]["states"]["persistent"][0]["value"] == 11


# ── Test: Persona ticked at end of turn ───────────────────


@pytest.mark.asyncio
async def test_persona_ticked_at_end(tmp_path):
    """Active persona states are ticked after the pipeline."""
    persona = new_persona("Aldric")
    persona["states"]["temporal"] = [{"label": "Cautious", "value": 5}]
    adv, slug = _setup_adventure(tmp_path, persona=persona, active_persona_slug="aldric")
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The path ahead is dark.",
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I walk forward",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    local_personas = storage.get_adventure_personas(slug)
    assert local_personas[0]["states"]["temporal"][0]["value"] == 4


# ── Test: Messages appended to storage ────────────────────


@pytest.mark.asyncio
async def test_messages_persisted_to_storage(tmp_path):
    """Pipeline appends all new messages to adventure storage."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "Gareth is here.",
        json.dumps({"state_changes": []}),
        "I nod.",
        "Gareth(friendly): Welcome!",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="Hello",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    stored_msgs = storage.get_messages(slug)
    roles = [m["role"] for m in stored_msgs]
    # player, narrator(Phase 1), intention, dialog(round)
    assert roles == ["player", "narrator", "intention", "dialog"]


# ── Test: Nickname activates extractor ────────────────────


@pytest.mark.asyncio
async def test_nickname_triggers_phase1_extractor(tmp_path):
    """Character nickname in narration triggers the Phase 1 extractor."""
    gareth = new_character("Gareth")
    gareth["nicknames"] = ["Cap", "Captain"]
    gareth["chattiness"] = 0
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "Cap raises his mug from the corner.",
        json.dumps({"state_changes": [{"category": "temporal", "label": "Relaxed", "value": 6}]}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I look around",
            adventure=adv,
            config=_config(intention=False),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    assert llm_seq.call_count == 3
    chars = storage.get_characters(slug)
    assert any(s["label"] == "Relaxed" for s in chars[0]["states"]["temporal"])


# ── Test: Narrator text in individual messages ─────────────


@pytest.mark.asyncio
async def test_narrator_text_in_individual_messages(tmp_path):
    """Each narrator and dialog message contains its own text."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "The door opens.",
        "I greet the newcomer.",
        "Gareth(warm): Welcome, friend!",
        json.dumps({"state_changes": []}),
        json.dumps({"lorebook_entries": []}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        result = await run_pipeline(
            slug=slug,
            player_message="I enter",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=storage.get_characters(slug),
        )

    narrator_msgs = [m for m in result["messages"] if m["role"] == "narrator"]
    assert any("The door opens." in m["text"] for m in narrator_msgs)

    dialog_msgs = [m for m in result["messages"] if m["role"] == "dialog"]
    assert len(dialog_msgs) == 1
    assert dialog_msgs[0]["text"] == "Welcome, friend!"
    assert dialog_msgs[0]["character"] == "Gareth"
    assert dialog_msgs[0]["emotion"] == "warm"


# ── Test: Lorebook entries are actually saved ─────────────


@pytest.mark.asyncio
async def test_lorebook_entries_saved(tmp_path):
    """Lorebook extractor results are persisted to storage."""
    adv, slug = _setup_adventure(tmp_path)
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "You find an ancient inscription on the wall.",
        json.dumps({"lorebook_entries": [
            {"title": "Ancient Inscription", "content": "Strange runes on the wall.", "keywords": ["runes", "wall"]},
        ]}),
    ])

    with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=llm_seq):
        await run_pipeline(
            slug=slug,
            player_message="I examine the wall",
            adventure=adv,
            config=_config(),
            story_roles=story_roles,
            history=[],
            characters=[],
        )

    entries = storage.get_lorebook(slug)
    assert len(entries) == 1
    assert entries[0]["title"] == "Ancient Inscription"
