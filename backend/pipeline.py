"""RPG turn execution engine.

Orchestrates a single player turn:
  1. Generate narration via KoboldCpp — no lorebook context, pure storytelling
  2. Run extractor via KoboldCpp — narration + all existing entries → JSON of new entries
  3. Store each new/updated entry via MCP store_lorebook_entry

Returns a TurnResult with the narration text and the entries stored this turn.
"""

import json
from dataclasses import dataclass, field

from backend import llm
from backend.lorebook import Lorebook


@dataclass
class TurnResult:
    narration: str
    stored_entries: list[dict] = field(default_factory=list)


def _narration_prompt(player_input: str) -> str:
    return (
        "You are the narrator of an RPG set in a tavern.\n\n"
        f'The player says: "{player_input}"\n\n'
        "Narrate what the player observes in 2-3 vivid sentences:"
    )


def _extraction_prompt(narration: str, lorebook: Lorebook) -> str:
    if lorebook:
        entries_text = "\n".join(
            f'- {key}: {entry.get("description", "")}'
            for key, entry in lorebook.items()
        )
        existing = f"Existing lorebook entries:\n{entries_text}"
    else:
        existing = "Existing lorebook entries: (none)"
    return (
        f"{existing}\n\n"
        f'Narration: "{narration}"\n\n'
        "Extract any new people, places, objects, or facts that appear in the narration "
        "but are not already captured in the lorebook above. "
        'For each, output a JSON object with "key" (snake_case), "name", and "description".\n'
        "Reply with a JSON array of objects. Reply with [] if nothing new was learned:"
    )


async def run_turn(
    player_input: str,
    lorebook: Lorebook,
    mcp_client,
) -> TurnResult:
    """Execute one player turn: narrate, extract new lore, store via MCP."""
    # Step 1: generate narration — narrator has no lorebook knowledge
    narration = await llm.generate(_narration_prompt(player_input))

    # Step 2: extract new/updated lorebook entries from the narration
    raw = await llm.generate(
        _extraction_prompt(narration, lorebook), max_length=300, temperature=0.0
    )
    try:
        new_entries: list[dict] = json.loads(raw.strip())
        if not isinstance(new_entries, list):
            new_entries = []
    except (json.JSONDecodeError, ValueError):
        new_entries = []

    # Step 3: store each entry via MCP
    stored: list[dict] = []
    for entry in new_entries:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key", "").strip()
        name = entry.get("name", "").strip()
        description = entry.get("description", "").strip()
        if not (key and name):
            continue
        result = await mcp_client.call_tool(
            "store_lorebook_entry",
            {"key": key, "name": name, "description": description},
        )
        # FastMCP returns one TextContent per result; parse the stored entry back
        if result.content:
            stored.append(json.loads(result.content[0].text))

    return TurnResult(narration=narration, stored_entries=stored)
