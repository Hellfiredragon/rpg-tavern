"""LLM output extractors for character states and lorebook entries."""

import json
import logging
from typing import Any

from backend import storage
from backend.characters import CATEGORY_MAX_VALUES

logger = logging.getLogger(__name__)


def _parse_json_output(text: str) -> dict | None:
    """Parse JSON from LLM output, stripping markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines[1:] if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError as e:
        logger.warning(f"Extractor output is not valid JSON: {e}")
        return None


def apply_character_extractor(
    slug: str, character: dict, text: str, characters: list[dict]
) -> None:
    """Parse character extractor output and apply state changes for one character."""
    data = _parse_json_output(text)
    if not data:
        return

    state_changes = data.get("state_changes", [])
    if not state_changes:
        return

    for change in state_changes:
        # Accept both flat format and nested format
        updates = change.get("updates", [change]) if "updates" in change else [change]
        for update in updates:
            category = update.get("category")
            if category not in ("core", "persistent", "temporal"):
                continue
            label = update.get("label", "")
            value = update.get("value", 0)
            if not label or not isinstance(value, (int, float)):
                continue
            value = int(value)
            cap = CATEGORY_MAX_VALUES.get(category)
            if cap is not None and value > cap:
                value = cap
            found = False
            for state in character["states"][category]:
                if state["label"].lower() == label.lower():
                    state["value"] = value
                    found = True
                    break
            if not found:
                character["states"][category].append({"label": label, "value": value})

    storage.save_characters(slug, characters)


def apply_persona_extractor(
    slug: str, persona: dict, text: str
) -> None:
    """Parse extractor output and apply state changes for the active persona.

    Copy-on-write: ensures the persona is saved to adventure-local storage.
    """
    data = _parse_json_output(text)
    if not data:
        return

    state_changes = data.get("state_changes", [])
    if not state_changes:
        return

    for change in state_changes:
        updates = change.get("updates", [change]) if "updates" in change else [change]
        for update in updates:
            category = update.get("category")
            if category not in ("core", "persistent", "temporal"):
                continue
            label = update.get("label", "")
            value = update.get("value", 0)
            if not label or not isinstance(value, (int, float)):
                continue
            value = int(value)
            cap = CATEGORY_MAX_VALUES.get(category)
            if cap is not None and value > cap:
                value = cap
            found = False
            for state in persona["states"][category]:
                if state["label"].lower() == label.lower():
                    state["value"] = value
                    found = True
                    break
            if not found:
                persona["states"][category].append({"label": label, "value": value})

    # Copy-on-write: save persona to adventure-local
    local_personas = storage.get_adventure_personas(slug)
    replaced = False
    for i, lp in enumerate(local_personas):
        if lp["slug"] == persona["slug"]:
            local_personas[i] = persona
            replaced = True
            break
    if not replaced:
        local_personas.append(persona)
    storage.save_adventure_personas(slug, local_personas)


def apply_lorebook_extractor(slug: str, text: str) -> None:
    """Parse lorebook extractor output and add new entries."""
    data = _parse_json_output(text)
    if not data:
        return

    new_entries = data.get("lorebook_entries", [])
    if not new_entries:
        return

    lorebook = storage.get_lorebook(slug)
    existing_titles = {e["title"].lower() for e in lorebook}
    for entry in new_entries:
        title = entry.get("title", "")
        if not title or title.lower() in existing_titles:
            continue
        lorebook.append({
            "title": title,
            "content": entry.get("content", ""),
            "keywords": entry.get("keywords", []),
        })
        existing_titles.add(title.lower())
    storage.save_lorebook(slug, lorebook)
