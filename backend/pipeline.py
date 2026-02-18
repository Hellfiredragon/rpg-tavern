"""RPG turn execution engine.

Orchestrates a single player turn:
  1. Generate narration via KoboldCpp
  2. Extract relevant lorebook keys from the narration via KoboldCpp
  3. Fetch matching lorebook entries via MCP tool call

Returns a TurnResult with the narration text and activated lore entries.
"""

import json
from dataclasses import dataclass, field

from backend import llm


@dataclass
class TurnResult:
    narration: str
    activated_lore: dict[str, dict] = field(default_factory=dict)


def _narration_prompt(player_input: str, lorebook_keys: list[str]) -> str:
    key_list = ", ".join(lorebook_keys) if lorebook_keys else "(none)"
    return (
        "You are the narrator of an RPG set in a tavern.\n"
        f"Known lorebook entries (for reference): {key_list}\n\n"
        f'The player says: "{player_input}"\n\n'
        "Narrate what the player observes in 2-3 vivid sentences:"
    )


def _extraction_prompt(narration: str, lorebook_keys: list[str]) -> str:
    key_list = ", ".join(lorebook_keys) if lorebook_keys else "(none)"
    return (
        f"Lorebook keys: {key_list}\n\n"
        f'Narration: "{narration}"\n\n'
        "Which of the above lorebook keys are mentioned or implied in this narration?\n"
        'Reply with a JSON array only, e.g. ["key1"]. Reply with [] if none match:'
    )


async def run_turn(
    player_input: str,
    lorebook_keys: list[str],
    mcp_client,
) -> TurnResult:
    """Execute one player turn: narrate, extract keys, fetch lore via MCP."""
    # Step 1: generate narration
    narration = await llm.generate(_narration_prompt(player_input, lorebook_keys))

    # Step 2: extract which lorebook keys appear in the narration
    raw = await llm.generate(_extraction_prompt(narration, lorebook_keys), max_length=100, temperature=0.0)
    try:
        extracted_keys = json.loads(raw.strip())
        if not isinstance(extracted_keys, list):
            extracted_keys = []
    except (json.JSONDecodeError, ValueError):
        extracted_keys = []

    # Step 3: look up lore entries via MCP
    # FastMCP returns one TextContent per entry, each containing a JSON-encoded dict
    activated_lore: dict[str, dict] = {}
    if extracted_keys:
        mcp_result = await mcp_client.call_tool("lookup_lorebook", {"keys": extracted_keys})
        for content_item in mcp_result.content:
            entry = json.loads(content_item.text)
            key = entry.get("key") or entry.get("name", "")
            if key:
                activated_lore[key] = entry

    return TurnResult(narration=narration, activated_lore=activated_lore)
