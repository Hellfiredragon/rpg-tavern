"""Pipeline orchestrator — runs one player turn end-to-end.

Turn flow:
  1. Append player intention to the stream.
  2. Call the Narrator → returns a beat script (JSON array).
  3. Expand beats in order:
       narration        → append narrator/narration message directly
       persona_verbatim → append persona/dialog from beat content (no LLM call)
       persona_cue      → call persona_dialog LLM → append persona/dialog
       cue              → call character_dialog LLM → append character/dialog
  4. Call persona_extractor (state changes not yet applied in this iteration).
  5. Call lore_extractor → parse entries → upsert into lorebook.
  6. Persist all new messages to storage.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from rpg_tavern.llm import LLM
from rpg_tavern.models import Message
from rpg_tavern.storage import Storage

logger = logging.getLogger(__name__)


async def run_turn(
    *,
    storage: Storage,
    adventure_slug: str,
    persona_id: str,
    intention: str,
    llm: LLM,
) -> list[Message]:
    """Execute one player turn and return the new messages appended this turn."""

    existing = storage.get_messages(adventure_slug)
    turn_id = max((m.turn_id for m in existing), default=0) + 1
    seq = max((m.seq for m in existing), default=0)

    new_messages: list[Message] = []

    def _append(owner: str, type: str, content: str, mood: str | None = None) -> Message:
        nonlocal seq
        seq += 1
        msg = Message(
            turn_id=turn_id, seq=seq,
            owner=owner, type=type,
            content=content, mood=mood,
        )
        new_messages.append(msg)
        return msg

    # 1. Intention
    _append(owner=persona_id, type="intention", content=intention)

    # 2. Narrator
    narrator_output = await llm("narrator", _narrator_prompt(adventure_slug, storage, intention, existing))
    beats = _parse_beat_script(narrator_output)

    # 3. Beat expansion
    for beat in beats:
        beat_type = beat.get("type")

        if beat_type == "narration":
            _append(owner="narrator", type="narration", content=beat["content"])

        elif beat_type == "persona_verbatim":
            # Player already wrote the words — no LLM call
            _append(
                owner=persona_id, type="dialog",
                content=beat["content"], mood=beat.get("mood"),
            )

        elif beat_type == "persona_cue":
            text = await llm("persona_dialog", _dialog_prompt(beat, new_messages))
            _append(
                owner=persona_id, type="dialog",
                content=text.strip(), mood=beat.get("mood"),
            )

        elif beat_type == "cue":
            text = await llm("character_dialog", _dialog_prompt(beat, new_messages))
            _append(
                owner=beat["character"], type="dialog",
                content=text.strip(), mood=beat.get("mood"),
            )

        else:
            logger.warning("Unknown beat type %r — skipped", beat_type)

    # 4. Persona extractor (state changes deferred to a future iteration)
    await llm("persona_extractor", _extractor_prompt(persona_id, intention))

    # 5. Lore extractor
    round_msgs = [m for m in new_messages if m.type in ("narration", "dialog")]
    lore_output = await llm("lore_extractor", _lore_prompt(round_msgs))
    lore_entries = _parse_lore_output(lore_output)
    if lore_entries:
        storage.append_lorebook_entries(adventure_slug, lore_entries)

    # 6. Persist
    storage.append_messages(adventure_slug, new_messages)

    return new_messages


# ---------------------------------------------------------------------------
# Beat-script parsing
# ---------------------------------------------------------------------------

def _parse_beat_script(output: str) -> list[dict[str, Any]]:
    try:
        beats = json.loads(output)
    except json.JSONDecodeError as e:
        raise ValueError(f"Narrator returned invalid JSON: {e}") from e
    if not isinstance(beats, list):
        raise ValueError(f"Narrator beat script must be a JSON array, got {type(beats).__name__}")
    return beats


def _parse_lore_output(output: str) -> list[dict]:
    try:
        data = json.loads(output)
        return data.get("entries", [])
    except (json.JSONDecodeError, AttributeError):
        logger.warning("Lore extractor returned invalid JSON: %r", output)
        return []


# ---------------------------------------------------------------------------
# Minimal prompts (PoC stage — full Handlebars templates come later)
# ---------------------------------------------------------------------------

def _narrator_prompt(
    slug: str, storage: Storage, intention: str, history: list[Message]
) -> str:
    adv = storage.get_adventure(slug)
    setting = adv.setting if adv else ""
    history_text = "\n".join(
        f"[{m.type}:{m.owner}] {m.content}" for m in history[-20:]
    )
    return (
        f"Setting: {setting}\n\n"
        f"History:\n{history_text}\n\n"
        f"Intention: {intention}\n\n"
        "Return a beat script as a JSON array. Each element is one of:\n"
        '  {"type":"narration","content":"<prose, no spoken words>"}\n'
        '  {"type":"cue","character":"<id>","mood":"<emotion>","context":"<hint>"}\n'
        '  {"type":"persona_verbatim","mood":"<emotion>","content":"<exact words from intention>"}\n'
        '  {"type":"persona_cue","mood":"<emotion>","context":"<hint>"}\n'
        "Return only the JSON array, no other text."
    )


def _dialog_prompt(beat: dict, context_msgs: list[Message]) -> str:
    context = "\n".join(f"[{m.type}:{m.owner}] {m.content}" for m in context_msgs[-10:])
    return (
        f"Character: {beat.get('character', beat.get('persona', 'unknown'))}\n"
        f"Mood: {beat.get('mood', '')}\n"
        f"Context: {beat.get('context', '')}\n\n"
        f"Scene so far:\n{context}\n\n"
        "Speak one line in character. Return only the spoken words, nothing else."
    )


def _extractor_prompt(persona_id: str, intention: str) -> str:
    return (
        f"Persona: {persona_id}\n"
        f"Intention: {intention}\n\n"
        'Return JSON: {"state_changes": []}'
    )


def _lore_prompt(round_messages: list[Message]) -> str:
    text = "\n".join(m.content for m in round_messages)
    return (
        f"New narration and dialog this round:\n{text}\n\n"
        "Extract new world facts as JSON:\n"
        '{"entries": [{"key": "<slug>", "content": "<fact>"}]}\n'
        'Return {"entries": []} if nothing notable.'
    )
