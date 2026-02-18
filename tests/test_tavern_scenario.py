"""PoC test: 'I want to look around' in a tavern.

Verifies the full pipeline — narration → key extraction → MCP lore lookup —
using a mocked KoboldCpp client and the FastMCP in-process test client.
"""

import pytest
from unittest.mock import AsyncMock, patch

import backend.mcp_server as mcp_server
from backend.lorebook import Lorebook
from backend.pipeline import run_turn
from mcp.shared.memory import create_connected_server_and_client_session

LOREBOOK: Lorebook = {
    "barmaid": {"key": "barmaid", "name": "Barmaid", "description": "A cheerful barmaid named Marta."},
    "fireplace": {"key": "fireplace", "name": "Fireplace", "description": "A roaring stone fireplace."},
    "suspicious_figure": {"key": "suspicious_figure", "name": "Suspicious Figure", "description": "A hooded stranger in the corner."},
}

NARRATION = (
    "You glance around the tavern. The barmaid wipes down the bar with a damp cloth, "
    "humming to herself. Warm light from the fireplace flickers across the wooden walls."
)
EXTRACTED_JSON = '["barmaid", "fireplace"]'


@pytest.fixture(autouse=True)
def inject_lorebook():
    mcp_server.set_lorebook(LOREBOOK)


@pytest.mark.asyncio
async def test_look_around():
    llm_sequence = AsyncMock(side_effect=[NARRATION, EXTRACTED_JSON])

    with patch("backend.pipeline.llm.generate", new=llm_sequence):
        async with create_connected_server_and_client_session(mcp_server.mcp) as client:
            result = await run_turn(
                player_input="I want to look around",
                lorebook_keys=list(LOREBOOK.keys()),
                mcp_client=client,
            )

    assert result.narration == NARRATION
    assert "barmaid" in result.activated_lore
    assert "fireplace" in result.activated_lore
    assert "suspicious_figure" not in result.activated_lore
