"""Tavern scenario tests for the RPG pipeline PoC.

Covers the full pipeline — narration → extraction → MCP store — using a mocked
KoboldCpp client and the FastMCP in-process test client.

Variants:
  test_look_around          — extractor finds two new entries, both are stored
  test_nothing_new          — extractor returns [], lorebook unchanged
  test_update_existing      — extractor refines a known entry (upsert)
  test_discover_novel_entity — narration introduces an entity with no prior lore
"""

import copy
import pytest
from unittest.mock import AsyncMock, patch

import backend.mcp_server as mcp_server
from backend.lorebook import Lorebook
from backend.pipeline import run_turn
from mcp.shared.memory import create_connected_server_and_client_session

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

BASE_LOREBOOK: Lorebook = {
    "barmaid": {"key": "barmaid", "name": "Barmaid", "description": "A cheerful barmaid."},
    "fireplace": {"key": "fireplace", "name": "Fireplace", "description": "A roaring stone fireplace."},
    "suspicious_figure": {"key": "suspicious_figure", "name": "Suspicious Figure", "description": "A hooded stranger in the corner."},
}


@pytest.fixture(autouse=True)
def fresh_lorebook():
    """Give each test its own deep copy so MCP mutations don't bleed across tests."""
    mcp_server.set_lorebook(copy.deepcopy(BASE_LOREBOOK))


async def _run(player_input: str, llm_responses: list[str], lorebook: Lorebook | None = None) -> tuple:
    """Helper: patch llm.generate with a sequence and run a turn. Returns (result, lorebook_after)."""
    if lorebook is None:
        lorebook = mcp_server.get_lorebook()
    llm_seq = AsyncMock(side_effect=llm_responses)
    with patch("backend.pipeline.llm.generate", new=llm_seq):
        async with create_connected_server_and_client_session(mcp_server.mcp) as client:
            result = await run_turn(
                player_input=player_input,
                lorebook=lorebook,
                mcp_client=client,
            )
    return result, mcp_server.get_lorebook()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

LOOK_AROUND_NARRATION = (
    "You glance around the tavern. The barmaid wipes down the bar with a damp cloth, "
    "humming to herself. Warm light from the fireplace flickers across the wooden walls."
)


async def test_look_around():
    """Extractor discovers two new entries; both are stored in the lorebook."""
    extracted = '[{"key":"barmaid","name":"Barmaid","description":"Cheerful barmaid who keeps the bar spotless."},{"key":"fireplace","name":"Fireplace","description":"A stone fireplace casting warm amber light."}]'

    result, lorebook_after = await _run(
        "I want to look around",
        [LOOK_AROUND_NARRATION, extracted],
        lorebook={},  # start empty so both are genuinely new
    )

    assert result.narration == LOOK_AROUND_NARRATION
    assert len(result.stored_entries) == 2
    stored_keys = {e["key"] for e in result.stored_entries}
    assert stored_keys == {"barmaid", "fireplace"}
    # entries persisted in lorebook
    assert "barmaid" in lorebook_after
    assert "fireplace" in lorebook_after


async def test_nothing_new():
    """When the extractor finds nothing, no entries are stored and the lorebook is unchanged."""
    narration = "The evening is quiet. Nothing stands out to the weary traveller."

    result, lorebook_after = await _run(
        "I sit by the fire and rest",
        [narration, "[]"],
    )

    assert result.narration == narration
    assert result.stored_entries == []
    # lorebook unchanged
    assert lorebook_after == mcp_server.get_lorebook()


async def test_update_existing_entry():
    """Extractor refines a known entry — upsert replaces the old description."""
    narration = (
        "The barmaid introduces herself as Marta and mentions she has worked here for twenty years."
    )
    extracted = '[{"key":"barmaid","name":"Barmaid","description":"Marta, a barmaid with twenty years of service at the tavern."}]'

    result, lorebook_after = await _run(
        "I ask the barmaid her name",
        [narration, extracted],
    )

    assert result.narration == narration
    assert len(result.stored_entries) == 1
    assert result.stored_entries[0]["key"] == "barmaid"
    # description updated
    assert "Marta" in lorebook_after["barmaid"]["description"]
    assert "twenty years" in lorebook_after["barmaid"]["description"]


async def test_discover_novel_entity():
    """Narration reveals a brand-new entity not present in the lorebook at all."""
    narration = (
        "Behind the bar you notice a peculiar talking raven perched on a silver stand. "
        "It cocks its head and croaks: 'Another fool seeks fortune here.'"
    )
    extracted = '[{"key":"talking_raven","name":"Talking Raven","description":"A silver-perched raven that speaks in cryptic warnings."}]'

    result, lorebook_after = await _run(
        "I look behind the bar",
        [narration, extracted],
    )

    assert result.narration == narration
    assert len(result.stored_entries) == 1
    assert result.stored_entries[0]["key"] == "talking_raven"
    assert "talking_raven" in lorebook_after
    # pre-existing entries untouched
    assert "barmaid" in lorebook_after
    assert "fireplace" in lorebook_after
