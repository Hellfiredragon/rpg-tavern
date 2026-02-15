"""Multi-turn pipeline story test: The Haunted Library.

Walks through a 3-turn story with two characters (Mira, Shade) and a player
persona (Kael), asserting exact LLM call sequences, state values, message
structure, lorebook dedup, and storage side-effects after each turn.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend import storage
from backend.characters import new_character, new_persona
from backend.pipeline import run_pipeline


# ── Helpers ──────────────────────────────────────────────


def _config():
    """All connections assigned."""
    conns = [{"name": "llm", "provider_url": "http://localhost:5001", "api_key": ""}]
    return {
        "llm_connections": conns,
        "story_roles": {
            "narrator": "llm",
            "character_intention": "llm",
            "extractor": "llm",
            "lorebook_extractor": "llm",
        },
    }


class LLMSequence:
    """Track LLM calls in order and return canned responses."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self._index = 0

    def __call__(self, url, key, prompt):
        self.calls.append((url, key, prompt))
        idx = self._index
        self._index += 1
        return self.responses[idx] if idx < len(self.responses) else ""

    @property
    def call_count(self):
        return len(self.calls)


def _state_value(entity, category, label):
    """Get the value of a state by category and label, or None if missing."""
    for s in entity["states"][category]:
        if s["label"] == label:
            return s["value"]
    return None


# ── The Haunted Library ──────────────────────────────────


class TestHauntedLibrary:
    """3-turn story testing state accumulation, temporal decay, and lorebook dedup."""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        storage.init_storage(tmp_path)
        storage.create_template("The Haunted Library", "A crumbling library haunted by a restless ghost")
        adv = storage.embark_template("the-haunted-library", "Haunted Library Run")
        self.slug = adv["slug"]

        # Characters
        mira = new_character("Mira")
        mira["chattiness"] = 100  # always active
        shade = new_character("Shade")
        shade["chattiness"] = 0  # only active when named
        storage.save_characters(self.slug, [mira, shade])

        # Persona
        kael = new_persona("Kael")
        storage.save_global_personas([kael])
        storage.update_adventure(self.slug, {"active_persona": "kael"})
        self.adventure = storage.get_adventure(self.slug)

        # Story roles
        self.story_roles = storage.get_story_roles(self.slug)
        self.story_roles["max_rounds"] = 1

        self.config = _config()

    # ── Turn 1: "I enter the library" ────────────────────

    @pytest.mark.asyncio
    async def test_turn_1(self):
        """Phase 1 narrator + Mira extractor + Mira round + lorebook = 6 LLM calls."""
        seq = LLMSequence([
            # Phase 1 narrator
            "The dusty library stretches endlessly.\nMira(warm): Welcome, traveler.",
            # Phase 1 extractor — Mira named
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Curious", "value": 7},
                {"category": "persistent", "label": "Protective", "value": 5},
            ]}),
            # Round 1 — Mira intention
            "I want to show the newcomer around",
            # Round 1 — Narrator resolves Mira
            "Mira(helpful): Follow me to the restricted section.",
            # Round 1 — Extractor Mira
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Helpful", "value": 8},
            ]}),
            # Lorebook extractor
            json.dumps({"lorebook_entries": [
                {"title": "Restricted Section", "content": "A locked wing of the library.", "keywords": ["restricted", "library"]},
            ]}),
        ])

        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq):
            result = await run_pipeline(
                slug=self.slug,
                player_message="I enter the library",
                adventure=self.adventure,
                config=self.config,
                story_roles=self.story_roles,
                history=[],
                characters=storage.get_characters(self.slug),
            )

        # LLM call count
        assert seq.call_count == 6

        # Message roles (intentions always visible)
        msgs = result["messages"]
        roles = [m["role"] for m in msgs]
        # player, narrator(Phase 1), dialog(Mira warm), intention(Mira), dialog(Mira helpful)
        assert roles[0] == "player"
        assert "narrator" in roles
        assert "intention" in roles

        intention_msgs = [m for m in msgs if m["role"] == "intention"]
        assert len(intention_msgs) == 1
        assert intention_msgs[0]["character"] == "Mira"

        # Dialog messages from Phase 1 and round
        dialog_msgs = [m for m in msgs if m["role"] == "dialog"]
        assert len(dialog_msgs) == 2
        assert dialog_msgs[0]["character"] == "Mira"
        assert dialog_msgs[0]["emotion"] == "warm"
        assert dialog_msgs[1]["character"] == "Mira"
        assert dialog_msgs[1]["emotion"] == "helpful"

        # Character states after extractor + tick
        chars = storage.get_characters(self.slug)
        mira = chars[0]
        assert _state_value(mira, "temporal", "Curious") == 6   # 7 - 1
        assert _state_value(mira, "temporal", "Helpful") == 7   # 8 - 1
        assert _state_value(mira, "persistent", "Protective") == 6  # 5 + 1
        # Shade: no states
        shade = chars[1]
        assert shade["states"]["temporal"] == []
        assert shade["states"]["persistent"] == []

        # Persona: Kael not named → no states, but still ticked (empty is fine)
        local_personas = storage.get_adventure_personas(self.slug)
        # Kael may or may not be in local storage yet (no extractor ran)
        if local_personas:
            kael = local_personas[0]
            assert kael["states"]["temporal"] == []

        # Lorebook: 1 entry
        lorebook = storage.get_lorebook(self.slug)
        assert len(lorebook) == 1
        assert lorebook[0]["title"] == "Restricted Section"

        # Stored messages: player + narrator + dialog + intention + dialog = 5
        stored = storage.get_messages(self.slug)
        assert len(stored) == 5

    # ── Turn 2: "I ask about the ghost rumors" ───────────

    @pytest.mark.asyncio
    async def test_turn_2(self):
        """Both characters active, persona extractor fires, lorebook dedup. 11 LLM calls."""
        # Run turn 1 first
        seq1 = LLMSequence([
            "The dusty library stretches endlessly.\nMira(warm): Welcome, traveler.",
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Curious", "value": 7},
                {"category": "persistent", "label": "Protective", "value": 5},
            ]}),
            "I want to show the newcomer around",
            "Mira(helpful): Follow me to the restricted section.",
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Helpful", "value": 8},
            ]}),
            json.dumps({"lorebook_entries": [
                {"title": "Restricted Section", "content": "A locked wing of the library.", "keywords": ["restricted", "library"]},
            ]}),
        ])

        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq1):
            await run_pipeline(
                slug=self.slug,
                player_message="I enter the library",
                adventure=self.adventure,
                config=self.config,
                story_roles=self.story_roles,
                history=[],
                characters=storage.get_characters(self.slug),
            )

        # Now turn 2
        history = storage.get_messages(self.slug)
        seq2 = LLMSequence([
            # Phase 1 narrator
            "A cold wind blows through the stacks.\nShade(menacing): Who dares speak of me?\nMira gasps.",
            # Phase 1 extractor — Mira named ("Mira gasps")
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Fearful", "value": 9},
            ]}),
            # Phase 1 extractor — Shade named
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Agitated", "value": 10},
            ]}),
            # Round 1 — Mira intention
            "I want to warn Kael about Shade",
            # Round 1 — Narrator resolves Mira
            "Mira(fearful): Kael, you must leave now!",
            # Round 1 — Extractor Mira
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Anxious", "value": 8},
            ]}),
            # Round 1 — Persona extractor (Kael named in resolution)
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Warned", "value": 6},
            ]}),
            # Round 1 — Shade intention
            "I want to intimidate the intruders",
            # Round 1 — Narrator resolves Shade
            "Shade(furious): This is MY domain!",
            # Round 1 — Extractor Shade
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Aggressive", "value": 12},
            ]}),
            # Lorebook extractor (dedup: Restricted Section already exists)
            json.dumps({"lorebook_entries": [
                {"title": "Restricted Section", "content": "...", "keywords": ["restricted"]},
                {"title": "Ghost Lore", "content": "Ancient tales of spectral beings.", "keywords": ["ghost", "shade"]},
            ]}),
        ])

        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq2):
            result = await run_pipeline(
                slug=self.slug,
                player_message="I ask about the ghost rumors",
                adventure=self.adventure,
                config=self.config,
                story_roles=self.story_roles,
                history=history,
                characters=storage.get_characters(self.slug),
            )

        # LLM call count
        assert seq2.call_count == 11

        # Message roles
        msgs = result["messages"]
        intention_msgs = [m for m in msgs if m["role"] == "intention"]
        assert len(intention_msgs) == 2
        assert intention_msgs[0]["character"] == "Mira"
        assert intention_msgs[1]["character"] == "Shade"

        # Dialog messages from Phase 1 + rounds
        dialog_msgs = [m for m in msgs if m["role"] == "dialog"]
        dialog_chars = [m["character"] for m in dialog_msgs]
        assert "Shade" in dialog_chars
        assert "Mira" in dialog_chars

        # Character states after extractor + tick
        chars = storage.get_characters(self.slug)
        mira = chars[0]
        assert _state_value(mira, "temporal", "Curious") == 5    # 7→6(T1)→5(T2)
        assert _state_value(mira, "temporal", "Helpful") == 6    # 8→7(T1)→6(T2)
        assert _state_value(mira, "temporal", "Fearful") == 8    # 9-1
        assert _state_value(mira, "temporal", "Anxious") == 7    # 8-1
        assert _state_value(mira, "persistent", "Protective") == 7  # 5→6(T1)→7(T2)

        shade = chars[1]
        assert _state_value(shade, "temporal", "Agitated") == 9    # 10-1
        assert _state_value(shade, "temporal", "Aggressive") == 11  # 12-1

        # Persona states (Kael warned)
        local_personas = storage.get_adventure_personas(self.slug)
        kael = next(p for p in local_personas if p["slug"] == "kael")
        assert _state_value(kael, "temporal", "Warned") == 5  # 6-1

        # Lorebook: dedup — Restricted Section not duplicated, Ghost Lore added
        lorebook = storage.get_lorebook(self.slug)
        assert len(lorebook) == 2
        titles = {e["title"] for e in lorebook}
        assert titles == {"Restricted Section", "Ghost Lore"}

        # Stored messages: turn 1 (5) + turn 2 messages
        stored = storage.get_messages(self.slug)
        # Count turn 2 msgs: player + narrator + dialog(Shade) + narrator(Mira gasps) +
        # intention(Mira) + dialog(Mira fearful) + intention(Shade) + dialog(Shade furious)
        # Total stored should be turn1(5) + turn2 messages
        turn2_msgs = result["messages"]
        assert len(stored) == 5 + len(turn2_msgs)

    # ── Turn 3: "I read the binding spell aloud" ─────────

    @pytest.mark.asyncio
    async def test_turn_3(self):
        """Persona named in Phase 1, Mira active via chattiness, persistent state on Shade."""
        # Run turns 1 and 2 first
        seq1 = LLMSequence([
            "The dusty library stretches endlessly.\nMira(warm): Welcome, traveler.",
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Curious", "value": 7},
                {"category": "persistent", "label": "Protective", "value": 5},
            ]}),
            "I want to show the newcomer around",
            "Mira(helpful): Follow me to the restricted section.",
            json.dumps({"state_changes": [{"category": "temporal", "label": "Helpful", "value": 8}]}),
            json.dumps({"lorebook_entries": [
                {"title": "Restricted Section", "content": "A locked wing.", "keywords": ["restricted"]},
            ]}),
        ])
        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq1):
            await run_pipeline(
                slug=self.slug, player_message="I enter the library",
                adventure=self.adventure, config=self.config,
                story_roles=self.story_roles, history=[],
                characters=storage.get_characters(self.slug),
            )

        history1 = storage.get_messages(self.slug)
        seq2 = LLMSequence([
            "A cold wind blows through the stacks.\nShade(menacing): Who dares speak of me?\nMira gasps.",
            json.dumps({"state_changes": [{"category": "temporal", "label": "Fearful", "value": 9}]}),
            json.dumps({"state_changes": [{"category": "temporal", "label": "Agitated", "value": 10}]}),
            "I want to warn Kael about Shade",
            "Mira(fearful): Kael, you must leave now!",
            json.dumps({"state_changes": [{"category": "temporal", "label": "Anxious", "value": 8}]}),
            json.dumps({"state_changes": [{"category": "temporal", "label": "Warned", "value": 6}]}),
            "I want to intimidate the intruders",
            "Shade(furious): This is MY domain!",
            json.dumps({"state_changes": [{"category": "temporal", "label": "Aggressive", "value": 12}]}),
            json.dumps({"lorebook_entries": [
                {"title": "Restricted Section", "content": "...", "keywords": ["restricted"]},
                {"title": "Ghost Lore", "content": "Ancient tales.", "keywords": ["ghost"]},
            ]}),
        ])
        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq2):
            await run_pipeline(
                slug=self.slug, player_message="I ask about the ghost rumors",
                adventure=self.adventure, config=self.config,
                story_roles=self.story_roles, history=history1,
                characters=storage.get_characters(self.slug),
            )

        # Now turn 3
        history2 = storage.get_messages(self.slug)
        seq3 = LLMSequence([
            # Phase 1 narrator — Kael and Shade named, Mira NOT named
            "Kael's voice echoes through the hall. Shade writhes in spectral light.",
            # Phase 1 extractor — Shade named
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Weakened", "value": 8},
            ]}),
            # Phase 1 persona extractor — Kael named
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Empowered", "value": 10},
            ]}),
            # Round 1 — Mira intention (active via chattiness=100)
            "I want to help channel the spell",
            # Round 1 — Narrator resolves Mira
            "Mira(determined): Hold on, I'll stabilize the barrier!",
            # Round 1 — Extractor Mira
            json.dumps({"state_changes": [
                {"category": "temporal", "label": "Resolute", "value": 9},
            ]}),
            # Round 1 — Shade intention (active: named in narration)
            "I want to break free",
            # Round 1 — Narrator resolves Shade
            "Shade(desperate): No! You cannot bind me!\nThe ghost's form flickers.",
            # Round 1 — Extractor Shade
            json.dumps({"state_changes": [
                {"category": "persistent", "label": "Bound", "value": 12},
            ]}),
            # Lorebook extractor
            json.dumps({"lorebook_entries": [
                {"title": "Binding Spell", "content": "An ancient incantation.", "keywords": ["binding", "spell"]},
            ]}),
        ])

        with patch("backend.pipeline.llm.generate", new_callable=AsyncMock, side_effect=seq3):
            result = await run_pipeline(
                slug=self.slug,
                player_message="I read the binding spell aloud",
                adventure=self.adventure,
                config=self.config,
                story_roles=self.story_roles,
                history=history2,
                characters=storage.get_characters(self.slug),
            )

        # LLM call count: narrator, ext-Shade, persona-ext-Kael, int-Mira, narr-Mira,
        # ext-Mira, int-Shade, narr-Shade, ext-Shade, lorebook = 10
        assert seq3.call_count == 10

        # Message roles — intentions always visible
        msgs = result["messages"]
        intention_msgs = [m for m in msgs if m["role"] == "intention"]
        assert len(intention_msgs) == 2
        assert intention_msgs[0]["character"] == "Mira"
        assert intention_msgs[1]["character"] == "Shade"

        # Dialog messages from round (Mira + Shade)
        dialog_msgs = [m for m in msgs if m["role"] == "dialog"]
        assert len(dialog_msgs) == 2  # Mira(determined) + Shade(desperate)

        # Narration messages (Phase 1 + "The ghost's form flickers")
        narrator_msgs = [m for m in msgs if m["role"] == "narrator"]
        assert len(narrator_msgs) >= 2

        # Character states after extractor + tick
        chars = storage.get_characters(self.slug)
        mira = chars[0]
        assert _state_value(mira, "temporal", "Curious") == 4     # 7→6→5→4
        assert _state_value(mira, "temporal", "Helpful") == 5     # 8→7→6→5
        assert _state_value(mira, "temporal", "Fearful") == 7     # 9→8→7
        assert _state_value(mira, "temporal", "Anxious") == 6     # 8→7→6
        assert _state_value(mira, "temporal", "Resolute") == 8    # 9-1
        assert _state_value(mira, "persistent", "Protective") == 8  # 5→6→7→8

        shade = chars[1]
        assert _state_value(shade, "temporal", "Agitated") == 8     # 10→9→8
        assert _state_value(shade, "temporal", "Aggressive") == 10  # 12→11→10
        assert _state_value(shade, "temporal", "Weakened") == 7     # 8-1
        assert _state_value(shade, "persistent", "Bound") == 13    # 12+1

        # Persona states
        local_personas = storage.get_adventure_personas(self.slug)
        kael = next(p for p in local_personas if p["slug"] == "kael")
        assert _state_value(kael, "temporal", "Warned") == 4     # 6→5→4
        assert _state_value(kael, "temporal", "Empowered") == 9  # 10-1

        # Lorebook: 3 entries total
        lorebook = storage.get_lorebook(self.slug)
        assert len(lorebook) == 3
        titles = {e["title"] for e in lorebook}
        assert titles == {"Restricted Section", "Ghost Lore", "Binding Spell"}
