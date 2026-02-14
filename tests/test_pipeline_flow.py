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


def _config(narrator=True, intention=True, extractor=True):
    """Build a config dict with optional connection assignments."""
    conns = [{"name": "llm", "provider_url": "http://localhost:5001", "api_key": ""}]
    return {
        "llm_connections": conns,
        "story_roles": {
            "narrator": "llm" if narrator else "",
            "character_intention": "llm" if intention else "",
            "extractor": "llm" if extractor else "",
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
    """Player intention → narrator → extractor → char intention → narrator → extractor → lorebook.

    Verifies the exact LLM call sequence and message structure for a single round.
    """
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100  # always activates
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        # Call 0: narrator resolves player intention
        "The tavern door creaks open. Gareth looks up from his ale.",
        # Call 1: extractor for Gareth (Phase 1 — Gareth named in narration)
        json.dumps({"state_changes": [{"category": "temporal", "label": "Alert", "value": 7}]}),
        # Call 2: Gareth's character intention (round 1)
        "I want to see who just walked in.",
        # Call 3: narrator resolves Gareth's intention
        "Gareth(cautious): Who goes there?\nHe reaches for his sword hilt.",
        # Call 4: extractor for Gareth (round 1)
        json.dumps({"state_changes": [{"category": "temporal", "label": "Suspicious", "value": 8}]}),
        # Call 5: lorebook extractor
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

    # Exactly 6 LLM calls
    assert llm_seq.call_count == 6

    # Messages: player + narrator (no sandbox)
    msgs = result["messages"]
    assert len(msgs) == 2
    assert msgs[0]["role"] == "player"
    assert msgs[0]["text"] == "I push open the tavern door"
    assert msgs[1]["role"] == "narrator"

    # Narrator segments: Phase 1 narration + round 1 dialog+narration
    segs = msgs[1]["segments"]
    narration_segs = [s for s in segs if s["type"] == "narration" and s["text"].strip()]
    dialog_segs = [s for s in segs if s["type"] == "dialog"]
    assert len(narration_segs) >= 1
    assert len(dialog_segs) == 1
    assert dialog_segs[0]["character"] == "Gareth"
    assert dialog_segs[0]["emotion"] == "cautious"

    # Character states were updated by extractor
    chars = storage.get_characters(slug)
    temporal_labels = {s["label"] for s in chars[0]["states"]["temporal"]}
    assert "Alert" in temporal_labels
    assert "Suspicious" in temporal_labels


@pytest.mark.asyncio
async def test_full_flow_message_order_with_sandbox(tmp_path):
    """In sandbox mode, intention messages appear between player and narrator."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1
    story_roles["sandbox"] = True

    llm_seq = LLMSequence([
        "The room is dim.",                                             # narrator phase 1
        # (no phase 1 extractor — narration doesn't mention Gareth)
        "I reach for my sword.",                                       # Gareth intention
        "Gareth(wary): He draws his blade slowly.",                    # narrator round 1
        json.dumps({"state_changes": []}),                             # extractor round 1
        json.dumps({"lorebook_entries": []}),                          # lorebook
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
    # player → intention → narrator
    assert roles == ["player", "intention", "narrator"]

    intention_msg = msgs[1]
    assert intention_msg["character"] == "Gareth"
    assert intention_msg["text"] == "I reach for my sword."


@pytest.mark.asyncio
async def test_nonsandbox_hides_intentions(tmp_path):
    """With sandbox=False, intention messages are NOT in the output."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1
    story_roles["sandbox"] = False

    llm_seq = LLMSequence([
        "The room is dim.",                    # narrator phase 1
        json.dumps({"state_changes": []}),     # extractor phase 1
        "I draw my weapon.",                   # Gareth intention (still generated, just not shown)
        "Gareth(alert): Who goes there?",      # narrator round 1
        json.dumps({"state_changes": []}),     # extractor round 1
        json.dumps({"lorebook_entries": []}),  # lorebook
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

    roles = [m["role"] for m in result["messages"]]
    assert "intention" not in roles
    assert roles == ["player", "narrator"]


# ── Test: Multiple characters in one round ────────────────


@pytest.mark.asyncio
async def test_multiple_characters_one_round(tmp_path):
    """Two characters both activate in a single round — each gets intention + resolution."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    elena = new_character("Elena")
    elena["chattiness"] = 100

    adv, slug = _setup_adventure(tmp_path, characters=[gareth, elena])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1
    story_roles["sandbox"] = True

    llm_seq = LLMSequence([
        # Phase 1
        "A stranger enters. Gareth and Elena notice immediately.",
        # Extractor for Gareth (named in phase 1)
        json.dumps({"state_changes": []}),
        # Extractor for Elena (named in phase 1)
        json.dumps({"state_changes": []}),
        # Round 1: Gareth intention
        "I want to confront the stranger.",
        # Round 1: narrator resolves Gareth
        "Gareth(stern): State your business.",
        # Round 1: extractor for Gareth
        json.dumps({"state_changes": []}),
        # Round 1: Elena intention
        "I'll observe from a distance.",
        # Round 1: narrator resolves Elena
        "Elena watches quietly from behind the bar.\nElena(curious): Interesting...",
        # Round 1: extractor for Elena
        json.dumps({"state_changes": []}),
        # Lorebook extractor
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
    roles = [m["role"] for m in msgs]
    # player → intention(Gareth) → intention(Elena) → narrator
    assert roles == ["player", "intention", "intention", "narrator"]
    assert msgs[1]["character"] == "Gareth"
    assert msgs[2]["character"] == "Elena"

    # Narrator segments include dialog from both characters
    segs = msgs[-1]["segments"]
    dialog_chars = [s["character"] for s in segs if s["type"] == "dialog"]
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

    # Call sequence: narrator, extractor(phase1, Gareth named), then 2 rounds
    # of (intention, narrator, extractor), then lorebook = 9 calls total
    llm_seq = LLMSequence([
        "Gareth sits in the corner.",          # 0: narrator phase 1
        json.dumps({"state_changes": []}),     # 1: extractor phase 1 (Gareth named)
        "I look around.",                      # 2: Gareth intention (round 1)
        "Gareth glances about.",               # 3: narrator round 1
        json.dumps({"state_changes": []}),     # 4: extractor round 1
        "I keep watching.",                    # 5: Gareth intention (round 2)
        "Gareth continues to watch.",          # 6: narrator round 2
        json.dumps({"state_changes": []}),     # 7: extractor round 2
        json.dumps({"lorebook_entries": []}),  # 8: lorebook
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

    # Exactly 9 LLM calls: narrator + ext_p1 + 2*(intention + narrator + extractor) + lorebook
    assert llm_seq.call_count == 9


# ── Test: No characters → no rounds ──────────────────────


@pytest.mark.asyncio
async def test_no_characters_skips_rounds(tmp_path):
    """Without characters, the round loop is skipped entirely."""
    adv, slug = _setup_adventure(tmp_path, characters=[])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The empty tavern greets you with silence.",  # narrator phase 1
        json.dumps({"lorebook_entries": []}),         # lorebook extractor
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

    # Only 2 LLM calls: narrator + lorebook
    assert llm_seq.call_count == 2
    assert len(result["messages"]) == 2
    assert result["messages"][1]["segments"][0]["text"] == "The empty tavern greets you with silence."


# ── Test: Character with 0 chattiness not named → not activated ──


@pytest.mark.asyncio
async def test_zero_chattiness_not_named_skips_character(tmp_path):
    """A character with 0% chattiness who isn't named in narration won't activate."""
    bob = new_character("Bob")
    bob["chattiness"] = 0
    adv, slug = _setup_adventure(tmp_path, characters=[bob])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        # narrator phase 1 — does NOT mention Bob
        "The tavern is empty and quiet.",
        # lorebook extractor
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

    # Only narrator + lorebook — no character rounds
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
        # narrator phase 1 — mentions Gareth
        "Gareth waves from the bar.",
        # extractor for Gareth (Phase 1)
        json.dumps({"state_changes": [{"category": "temporal", "label": "Friendly", "value": 9}]}),
        # lorebook extractor
        json.dumps({"lorebook_entries": []}),
    ])

    # Disable intention connection to isolate the Phase 1 extractor
    # (otherwise Gareth would activate in rounds too since he's named)
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

    # 3 calls: narrator, extractor, lorebook
    assert llm_seq.call_count == 3

    # Character state was updated
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
        # narrator phase 1 — does NOT mention Bob
        "The tavern is silent.",
        # lorebook extractor
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

    # Only 2 calls: narrator + lorebook (no extractor for Bob)
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
        phase1_narration,                      # 0: narrator phase 1
        # (no phase 1 extractor — Gareth not mentioned in phase 1)
        "I want to check the fireplace.",      # 1: Gareth intention
        round1_narration,                      # 2: narrator round 1
        json.dumps({"state_changes": []}),     # 3: extractor round 1
        json.dumps({"lorebook_entries": []}),  # 4: lorebook extractor
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

    # The lorebook extractor prompt (last call, index 4) should contain both narrations
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
        # narrator phase 1 — mentions Aldric
        "Aldric steps into the dim tavern.",
        # persona extractor (Aldric named)
        json.dumps({"state_changes": [{"category": "temporal", "label": "Cautious", "value": 8}]}),
        # lorebook extractor
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

    # 3 calls: narrator, persona extractor, lorebook
    assert llm_seq.call_count == 3

    # Persona states updated in adventure-local storage
    local_personas = storage.get_adventure_personas(slug)
    assert len(local_personas) == 1
    assert any(s["label"] == "Cautious" for s in local_personas[0]["states"]["temporal"])


# ── Test: Empty narrator response ─────────────────────────


@pytest.mark.asyncio
async def test_empty_narrator_response(tmp_path):
    """When narrator returns empty text, pipeline still produces a valid message."""
    adv, slug = _setup_adventure(tmp_path)
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "",                                    # narrator returns empty
        json.dumps({"lorebook_entries": []}),  # lorebook extractor
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

    # Should still have player + narrator
    assert len(result["messages"]) == 2
    narrator_msg = result["messages"][1]
    assert narrator_msg["role"] == "narrator"
    # Segments exist even if empty
    assert narrator_msg["segments"] is not None


@pytest.mark.asyncio
async def test_empty_narrator_with_character_rounds(tmp_path):
    """When narrator returns empty for both Phase 1 and rounds,
    empty segments accumulate but the pipeline doesn't crash."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 2

    # Every narrator call returns empty; intentions return text
    async def mock_gen(url, key, prompt):
        # If prompt contains "Intention" or uses the character_intention template,
        # we detect it by whether the prompt talks about "what YOU want to do"
        if "what YOU want to do" in prompt or "State what" in prompt:
            return "I want to do something."
        if "state_changes" in prompt or "state changes" in prompt or "State Label" in prompt:
            return json.dumps({"state_changes": []})
        if "lorebook" in prompt.lower() or "world facts" in prompt.lower():
            return json.dumps({"lorebook_entries": []})
        # Narrator calls return empty
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

    # Pipeline should not crash
    narrator_msg = result["messages"][-1]
    assert narrator_msg["role"] == "narrator"


# ── Test: No intention connection → no character rounds ───


@pytest.mark.asyncio
async def test_no_intention_connection_skips_rounds(tmp_path):
    """Without character_intention connection, rounds are skipped even with characters."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "Gareth nods at you.",                 # narrator phase 1
        json.dumps({"state_changes": []}),     # extractor for Gareth
        json.dumps({"lorebook_entries": []}),  # lorebook
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

    # Only 3 calls: narrator + extractor + lorebook. No intention or round narrator.
    assert llm_seq.call_count == 3
    assert len(result["messages"]) == 2  # player + narrator only


# ── Test: No extractor connection → states not updated ────


@pytest.mark.asyncio
async def test_no_extractor_connection_skips_extraction(tmp_path):
    """Without extractor connection, character states are not updated."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "Gareth looks up.",           # narrator phase 1
        "I want to investigate.",     # Gareth intention
        "Gareth searches the room.",  # narrator round 1
        # No extractor calls at all
        # No lorebook either (extractor conn is used for lorebook)
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

    # 3 calls: narrator, intention, narrator (no extractors)
    assert llm_seq.call_count == 3

    # Character states unchanged
    chars = storage.get_characters(slug)
    assert chars[0]["states"]["temporal"] == []


# ── Test: Characters are ticked at end of turn ────────────


@pytest.mark.asyncio
async def test_character_states_ticked_at_end(tmp_path):
    """Character states are ticked (temporal decay, persistent growth) after the pipeline."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 0  # won't activate
    gareth["states"]["temporal"] = [{"label": "Angry", "value": 3}]
    gareth["states"]["persistent"] = [{"label": "Loyal", "value": 10}]
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)

    llm_seq = LLMSequence([
        "The room is quiet.",                  # narrator phase 1
        json.dumps({"lorebook_entries": []}),  # lorebook
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
    # temporal ticks -1: 3-1=2
    assert chars[0]["states"]["temporal"][0]["value"] == 2
    # persistent ticks +1: 10+1=11
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
        "The path ahead is dark.",             # narrator
        json.dumps({"lorebook_entries": []}),  # lorebook
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
    # temporal ticks -1: 5-1=4
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
    story_roles["sandbox"] = True

    llm_seq = LLMSequence([
        "Gareth is here.",                     # narrator phase 1
        json.dumps({"state_changes": []}),     # extractor
        "I nod.",                              # Gareth intention
        "Gareth(friendly): Welcome!",          # narrator round 1
        json.dumps({"state_changes": []}),     # extractor
        json.dumps({"lorebook_entries": []}),  # lorebook
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

    # Messages are persisted
    stored_msgs = storage.get_messages(slug)
    roles = [m["role"] for m in stored_msgs]
    assert roles == ["player", "intention", "narrator"]


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
        # narrator mentions "Cap" but not "Gareth"
        "Cap raises his mug from the corner.",
        # extractor for Gareth (triggered by nickname "Cap")
        json.dumps({"state_changes": [{"category": "temporal", "label": "Relaxed", "value": 6}]}),
        # lorebook
        json.dumps({"lorebook_entries": []}),
    ])

    # Disable intention connection to prevent rounds (nickname in narration_so_far
    # would activate Gareth in every round despite chattiness=0)
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


# ── Test: Combined segments text field ────────────────────


@pytest.mark.asyncio
async def test_narrator_text_field_matches_segments(tmp_path):
    """The narrator message text field is the plain-text version of all segments."""
    gareth = new_character("Gareth")
    gareth["chattiness"] = 100
    adv, slug = _setup_adventure(tmp_path, characters=[gareth])
    story_roles = storage.get_story_roles(slug)
    story_roles["max_rounds"] = 1

    llm_seq = LLMSequence([
        "The door opens.",                     # 0: narrator phase 1
        # (no phase 1 extractor — Gareth not mentioned)
        "I greet the newcomer.",               # 1: Gareth intention
        "Gareth(warm): Welcome, friend!",      # 2: narrator round 1
        json.dumps({"state_changes": []}),     # 3: extractor round 1
        json.dumps({"lorebook_entries": []}),  # 4: lorebook
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

    narrator_msg = result["messages"][-1]
    # text field should contain both phase1 narration and round dialog
    assert "The door opens." in narrator_msg["text"]
    assert "Gareth(warm): Welcome, friend!" in narrator_msg["text"]


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
