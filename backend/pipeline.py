"""Intention/resolution chat pipeline.

Executes the full turn loop for one player message:
  1. Resolve player intention — narrator LLM produces narration + dialog segments.
  2. Character extractor — update states for each character named in the narration.
  3. Persona extractor — same for the active player persona if named.
  4. Round loop (up to max_rounds, default 3):
     a. Activate characters (name/nickname match always; otherwise chattiness roll).
     b. Each active character generates an intention (character_intention role).
     c. Narrator resolves the intention into new segments.
     d. Character extractor updates that character's states.
     e. Persona extractor runs if persona named in round narration.
  5. Lorebook extractor — extract new world facts from all narrations.
  6. Tick all character + persona states, combine segments into one narrator message.

Story roles (4, each with a Handlebars prompt template + LLM connection):
  narrator            — resolves intentions into narration + dialog
  character_intention — generates what a character wants to do
  extractor           — updates character/persona states after each resolution
  lorebook_extractor  — extracts new world facts once per turn

Connection resolution: per-adventure story-roles.json connection field first,
then global config.json story_roles mapping, then None (role skipped).

Narrator output format (parsed by parse_narrator_output):
  Narration text.
  CharacterName(emotion): Dialog text.

Message format: {"role": "narrator", "text": "...", "segments": [...]}
  Segments: {"type": "narration"|"dialog", "text": "...", "character"?, "emotion"?}
  Intention messages (sandbox only): {"role": "intention", "character": "...", "text": "..."}
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from backend import llm, storage
from backend.characters import (
    CATEGORY_MAX_VALUES,
    activate_characters,
    character_prompt_context,
    enrich_states,
    tick_character,
)
from backend.lorebook import format_lorebook, match_lorebook_entries
from backend.prompts import PromptError, build_context, render_prompt

logger = logging.getLogger(__name__)


# ── Segment types ──────────────────────────────────────────


Segment = dict[str, str]  # {"type": "narration"|"dialog", "text": ..., ...}


def parse_narrator_output(text: str, known_names: list[str]) -> list[Segment]:
    """Parse narrator output into narration and dialog segments.

    Dialog format: Name(emotion): Dialog text
    Where Name must be in known_names (case-insensitive match).
    Adjacent narration lines are merged into a single segment.
    Unknown names are treated as narration (graceful fallback).
    """
    if not text or not text.strip():
        return [{"type": "narration", "text": ""}]

    # Build regex pattern for known names
    name_lookup: dict[str, str] = {}
    for name in known_names:
        name_lookup[name.lower()] = name

    # Pattern: KnownName(emotion): text
    # We build a dynamic pattern matching any known name
    segments: list[Segment] = []
    current_narration: list[str] = []

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            if current_narration:
                current_narration.append("")
            continue

        # Try matching dialog pattern: Name(emotion): text
        match = re.match(r'^([A-Za-z][\w\s]*?)\(([^)]+)\):\s*(.+)$', stripped)
        if match:
            raw_name = match.group(1).strip()
            if raw_name.lower() in name_lookup:
                # Flush narration
                if current_narration:
                    segments.append({
                        "type": "narration",
                        "text": "\n".join(current_narration).strip(),
                    })
                    current_narration = []
                segments.append({
                    "type": "dialog",
                    "character": name_lookup[raw_name.lower()],
                    "emotion": match.group(2).strip(),
                    "text": match.group(3).strip(),
                })
                continue

        # Not dialog — accumulate as narration
        current_narration.append(stripped)

    # Flush remaining narration
    if current_narration:
        segments.append({
            "type": "narration",
            "text": "\n".join(current_narration).strip(),
        })

    # Filter empty narration segments
    segments = [s for s in segments if s.get("text", "").strip() or s["type"] == "dialog"]

    return segments if segments else [{"type": "narration", "text": ""}]


def segments_to_text(segments: list[Segment]) -> str:
    """Convert segments back to plain text for prompt history."""
    parts: list[str] = []
    for seg in segments:
        if seg["type"] == "dialog":
            parts.append(f"{seg['character']}({seg['emotion']}): {seg['text']}")
        else:
            parts.append(seg["text"])
    return "\n".join(parts)


# ── Extractor helpers ──────────────────────────────────────


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


# ── Connection resolution ──────────────────────────────────


def _resolve_connection(config: dict, story_roles: dict, role_name: str) -> dict | None:
    """Find the LLM connection assigned to a story role.

    Checks per-adventure story_roles first (connection field on each role),
    then falls back to the global config story_roles mapping.
    """
    conn_name = ""
    role = story_roles.get(role_name)
    if isinstance(role, dict):
        conn_name = role.get("connection", "")
    if not conn_name:
        conn_name = config.get("story_roles", {}).get(role_name, "")
    if not conn_name:
        return None
    for conn in config["llm_connections"]:
        if conn["name"] == conn_name:
            return conn
    return None


# ── Pipeline ───────────────────────────────────────────────


async def run_pipeline(
    slug: str,
    player_message: str,
    adventure: dict,
    config: dict,
    story_roles: dict,
    history: list[dict],
    characters: list[dict],
) -> dict[str, Any]:
    """Execute the intention/resolution pipeline for one player turn.

    Returns {"messages": [...]} with all new messages to append.
    """
    now = datetime.now(timezone.utc).isoformat()
    player_msg = {"role": "player", "text": player_message, "ts": now}
    new_messages: list[dict] = [player_msg]
    all_segments: list[Segment] = []

    # Resolve connections
    narrator_conn = _resolve_connection(config, story_roles, "narrator")
    if not narrator_conn:
        raise ValueError("Narrator role is not assigned — configure it in Settings")

    intention_conn = _resolve_connection(config, story_roles, "character_intention")
    extractor_conn = _resolve_connection(config, story_roles, "extractor")

    max_rounds = story_roles.get("max_rounds", 3)
    sandbox = story_roles.get("sandbox", False)

    # Player name (fallback for old adventures without the field)
    player_name = adventure.get("player_name", "") or "the adventurer"

    # ── Persona resolution ──
    active_persona: dict | None = None
    active_persona_slug = adventure.get("active_persona", "")
    player_description: str | None = None
    player_states: list[dict] | None = None
    if active_persona_slug:
        merged_personas = storage.get_merged_personas(slug)
        for p in merged_personas:
            if p["slug"] == active_persona_slug:
                active_persona = p
                break
    if active_persona:
        player_name = active_persona["name"]
        if active_persona.get("description"):
            player_description = active_persona["description"]
        player_states = enrich_states(active_persona)

    # Character prompt context (visible states only, for narrator)
    char_ctx = character_prompt_context(characters) if characters else None

    # Lorebook matching
    lorebook_all = storage.get_lorebook(slug)
    match_texts = [player_message]
    match_texts.extend(m["text"] for m in history[-5:])
    matched_entries = match_lorebook_entries(lorebook_all, match_texts)
    lorebook_str = format_lorebook(matched_entries)

    # Known character names (for parser)
    known_names = []
    for char in characters:
        known_names.append(char["name"])
        known_names.extend(char.get("nicknames", []))
    # Add player/persona names
    if active_persona:
        known_names.append(active_persona["name"])
        known_names.extend(active_persona.get("nicknames", []))
    else:
        raw_player_name = adventure.get("player_name", "")
        if raw_player_name:
            known_names.append(raw_player_name)

    # Helper to build base context
    def _base_ctx(**extra: Any) -> dict:
        return build_context(
            adventure, history, player_message,
            chars=char_ctx,
            lore_text=lorebook_str if lorebook_str else None,
            lore_entries=matched_entries if matched_entries else None,
            player_name=player_name,
            player_description=player_description,
            player_states=player_states,
            **extra,
        )

    # ── Phase 1: Resolve player intention ─────────────────

    narration_so_far_parts: list[str] = []

    narrator_prompt_tpl = story_roles.get("narrator", {}).get("prompt", "")
    if narrator_prompt_tpl:
        ctx = _base_ctx(intention=player_message)
        try:
            prompt = render_prompt(narrator_prompt_tpl, ctx)
        except PromptError as e:
            raise ValueError(f"Prompt template error (narrator): {e}")

        narrator_text = await llm.generate(
            narrator_conn["provider_url"],
            narrator_conn.get("api_key", ""),
            prompt,
        )

        segments = parse_narrator_output(narrator_text, known_names)
        all_segments.extend(segments)
        narration_so_far_parts.append(segments_to_text(segments))

    narration_so_far = "\n\n".join(narration_so_far_parts)

    # ── Character extractor for characters named in player resolution ──

    if extractor_conn and characters:
        char_extractor_tpl = story_roles.get("extractor", {}).get("prompt", "")
        if char_extractor_tpl and narration_so_far:
            for char in characters:
                names = [char["name"].lower()] + [n.lower() for n in char.get("nicknames", [])]
                if any(name in narration_so_far.lower() for name in names):
                    ext_ctx = _base_ctx(
                        narration=narration_so_far,
                        char_name=char["name"],
                        char_all_states=enrich_states(char, include_silent=True),
                    )
                    try:
                        ext_prompt = render_prompt(char_extractor_tpl, ext_ctx)
                    except PromptError:
                        continue
                    ext_text = await llm.generate(
                        extractor_conn["provider_url"],
                        extractor_conn.get("api_key", ""),
                        ext_prompt,
                    )
                    apply_character_extractor(slug, char, ext_text, characters)
            # Refresh char_ctx after updates
            char_ctx = character_prompt_context(characters) if characters else None

    # ── Persona extractor for player resolution ──

    if extractor_conn and active_persona and narration_so_far:
        char_extractor_tpl = story_roles.get("extractor", {}).get("prompt", "")
        if char_extractor_tpl:
            p_names = [active_persona["name"].lower()] + [n.lower() for n in active_persona.get("nicknames", [])]
            if any(name in narration_so_far.lower() for name in p_names):
                ext_ctx = _base_ctx(
                    narration=narration_so_far,
                    char_name=active_persona["name"],
                    char_all_states=enrich_states(active_persona, include_silent=True),
                )
                try:
                    ext_prompt = render_prompt(char_extractor_tpl, ext_ctx)
                    ext_text = await llm.generate(
                        extractor_conn["provider_url"],
                        extractor_conn.get("api_key", ""),
                        ext_prompt,
                    )
                    apply_persona_extractor(slug, active_persona, ext_text)
                    player_states = enrich_states(active_persona)
                except PromptError:
                    pass

    # ── Rounds: character intentions + resolutions ────────

    round_all_narrations: list[str] = [narration_so_far]

    for round_num in range(max_rounds):
        if not characters or not intention_conn:
            break

        active_chars = activate_characters(
            characters, narration_so_far, player_message
        )
        if not active_chars:
            break

        any_acted = False
        round_narration_parts: list[str] = []

        for char in active_chars:
            # ── Generate intention ──
            char_intention_tpl = story_roles.get("character_intention", {}).get("prompt", "")
            if not char_intention_tpl:
                continue

            char_states_list = enrich_states(char)
            int_ctx = _base_ctx(
                narration_so_far=narration_so_far,
                char_name=char["name"],
                char_description=char.get("description", ""),
                char_states=char_states_list,
            )
            try:
                int_prompt = render_prompt(char_intention_tpl, int_ctx)
            except PromptError:
                continue

            intention_text = await llm.generate(
                intention_conn["provider_url"],
                intention_conn.get("api_key", ""),
                int_prompt,
            )

            # Store intention message (visible in sandbox mode)
            if sandbox:
                new_messages.append({
                    "role": "intention",
                    "character": char["name"],
                    "text": intention_text.strip(),
                    "ts": now,
                })

            # ── Narrator resolves intention ──
            if narrator_prompt_tpl:
                resolve_ctx = _base_ctx(
                    intention=f"{char['name']}: {intention_text.strip()}",
                    narration_so_far=narration_so_far,
                    char_name=char["name"],
                    char_states=char_states_list,
                )
                try:
                    resolve_prompt = render_prompt(narrator_prompt_tpl, resolve_ctx)
                except PromptError:
                    continue

                resolution_text = await llm.generate(
                    narrator_conn["provider_url"],
                    narrator_conn.get("api_key", ""),
                    resolve_prompt,
                )

                segments = parse_narrator_output(resolution_text, known_names)
                all_segments.extend(segments)
                resolution_plain = segments_to_text(segments)
                narration_so_far_parts.append(resolution_plain)
                narration_so_far = "\n\n".join(narration_so_far_parts)
                round_narration_parts.append(resolution_plain)
                any_acted = True

                # ── Character extractor ──
                if extractor_conn:
                    char_ext_tpl = story_roles.get("extractor", {}).get("prompt", "")
                    if char_ext_tpl:
                        ext_ctx = _base_ctx(
                            narration=resolution_plain,
                            char_name=char["name"],
                            char_all_states=enrich_states(char, include_silent=True),
                        )
                        try:
                            ext_prompt = render_prompt(char_ext_tpl, ext_ctx)
                        except PromptError:
                            continue
                        ext_text = await llm.generate(
                            extractor_conn["provider_url"],
                            extractor_conn.get("api_key", ""),
                            ext_prompt,
                        )
                        apply_character_extractor(slug, char, ext_text, characters)

                # ── Persona extractor (round) ──
                if extractor_conn and active_persona:
                    p_ext_tpl = story_roles.get("extractor", {}).get("prompt", "")
                    if p_ext_tpl:
                        p_names = [active_persona["name"].lower()] + [n.lower() for n in active_persona.get("nicknames", [])]
                        if any(name in resolution_plain.lower() for name in p_names):
                            p_ext_ctx = _base_ctx(
                                narration=resolution_plain,
                                char_name=active_persona["name"],
                                char_all_states=enrich_states(active_persona, include_silent=True),
                            )
                            try:
                                p_ext_prompt = render_prompt(p_ext_tpl, p_ext_ctx)
                                p_ext_text = await llm.generate(
                                    extractor_conn["provider_url"],
                                    extractor_conn.get("api_key", ""),
                                    p_ext_prompt,
                                )
                                apply_persona_extractor(slug, active_persona, p_ext_text)
                                player_states = enrich_states(active_persona)
                            except PromptError:
                                pass

        if round_narration_parts:
            round_all_narrations.append("\n\n".join(round_narration_parts))

        # Refresh char_ctx after round
        char_ctx = character_prompt_context(characters) if characters else None

        if not any_acted:
            break

    # ── Lorebook extractor per round ──────────────────────

    lorebook_ext_conn = _resolve_connection(config, story_roles, "lorebook_extractor")
    lorebook_ext_tpl = story_roles.get("lorebook_extractor", {}).get("prompt", "")
    if lorebook_ext_conn and lorebook_ext_tpl and round_all_narrations:
        round_narrations_str = "\n\n---\n\n".join(round_all_narrations)
        lb_ctx = _base_ctx(round_narrations=round_narrations_str)
        try:
            lb_prompt = render_prompt(lorebook_ext_tpl, lb_ctx)
            lb_text = await llm.generate(
                lorebook_ext_conn["provider_url"],
                lorebook_ext_conn.get("api_key", ""),
                lb_prompt,
            )
            apply_lorebook_extractor(slug, lb_text)
        except (PromptError, Exception) as e:
            logger.warning(f"Lorebook extractor failed: {e}")

    # ── Tick character states ─────────────────────────────

    if characters:
        for char in characters:
            tick_character(char)
        storage.save_characters(slug, characters)

    # ── Tick persona states ──────────────────────────────

    if active_persona:
        tick_character(active_persona)
        # Save to adventure-local
        local_personas = storage.get_adventure_personas(slug)
        replaced = False
        for i, lp in enumerate(local_personas):
            if lp["slug"] == active_persona["slug"]:
                local_personas[i] = active_persona
                replaced = True
                break
        if not replaced:
            local_personas.append(active_persona)
        storage.save_adventure_personas(slug, local_personas)

    # ── Build narrator message with segments ──────────────

    combined_text = segments_to_text(all_segments)
    narrator_msg = {
        "role": "narrator",
        "text": combined_text,
        "segments": all_segments,
        "ts": now,
    }
    new_messages.append(narrator_msg)

    storage.append_messages(slug, new_messages)
    return {"messages": new_messages}
