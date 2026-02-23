"""Message visibility filtering for pipeline stages.

Each stage receives only the messages it is allowed to see.  The rules are
derived from the visibility matrix in ``docs/agent/pipeline.md``.
"""

from __future__ import annotations

from rpg_tavern.models import Message

# Message types that are always treated as "public narrative"
_NARRATIVE_TYPES = frozenset({"narration", "dialog"})


def filter_messages(
    messages: list[Message],
    stage: str,
    own_id: str,
    current_turn_id: int,
) -> list[Message]:
    """Return the subset of *messages* visible to *stage*.

    Args:
        messages:        The full message stream up to and including the
                         current turn's messages already appended.
        stage:           Pipeline stage name — one of ``narrator``,
                         ``character_dialog``, ``persona_dialog``,
                         ``persona_extractor``, ``character_extractor``,
                         ``npc_intent``, ``lore_extractor``.
        own_id:          The character or persona id for ownership checks
                         (used for intention / thought filtering).
        current_turn_id: The turn that is currently being processed.

    Returns:
        Filtered list in the original order.
    """
    if stage == "narrator":
        return _filter_narrator(messages, own_id, current_turn_id)
    if stage in ("character_dialog", "persona_dialog"):
        return _filter_dialog_stage(messages, current_turn_id)
    if stage in ("persona_extractor", "character_extractor"):
        return _filter_extractor(messages, own_id, current_turn_id)
    if stage == "npc_intent":
        return _filter_npc_intent(messages, own_id, current_turn_id)
    if stage == "lore_extractor":
        return _filter_lore_extractor(messages, current_turn_id)
    # Unknown stage — return nothing; caller should log a warning
    return []


# ---------------------------------------------------------------------------
# Per-stage filters
# ---------------------------------------------------------------------------

def _filter_narrator(
    messages: list[Message], own_id: str, current_turn_id: int
) -> list[Message]:
    """Narrator sees all past narration/dialog + the one intention it is resolving."""
    result = []
    for m in messages:
        if m.type in _NARRATIVE_TYPES:
            result.append(m)
        elif m.type == "intention" and m.turn_id == current_turn_id and m.owner == own_id:
            result.append(m)
    return result


def _filter_dialog_stage(
    messages: list[Message], current_turn_id: int
) -> list[Message]:
    """Character/Persona Dialog sees all past narration and dialog; no intentions."""
    return [m for m in messages if m.type in _NARRATIVE_TYPES]


def _filter_extractor(
    messages: list[Message], own_id: str, current_turn_id: int
) -> list[Message]:
    """Extractors see narration/dialog from before this round + their own last intention."""
    past_narrative = [
        m for m in messages
        if m.type in _NARRATIVE_TYPES and m.turn_id < current_turn_id
    ]
    # Own last intention from any past turn
    own_intentions = [
        m for m in messages
        if m.type == "intention" and m.owner == own_id and m.turn_id < current_turn_id
    ]
    last_intention = [own_intentions[-1]] if own_intentions else []
    return past_narrative + last_intention


def _filter_npc_intent(
    messages: list[Message], own_id: str, current_turn_id: int
) -> list[Message]:
    """NPC Intent sees all past narration/dialog + own past intentions."""
    result = []
    for m in messages:
        if m.type in _NARRATIVE_TYPES and m.turn_id < current_turn_id:
            result.append(m)
        elif m.type == "intention" and m.owner == own_id and m.turn_id < current_turn_id:
            result.append(m)
    return result


def _filter_lore_extractor(
    messages: list[Message], current_turn_id: int
) -> list[Message]:
    """Lore Extractor sees only the current round's narration and dialog."""
    return [
        m for m in messages
        if m.type in _NARRATIVE_TYPES and m.turn_id == current_turn_id
    ]
