"""Main pipeline loop: intention/resolution with character rounds.

Emits individual messages per narration paragraph and dialog line (role=narrator
or role=dialog). Character intentions are always stored (role=intention)."""

import logging
from datetime import datetime, timezone
from typing import Any

from backend import llm, storage
from backend.characters import (
    activate_characters,
    character_prompt_context,
    enrich_states,
    tick_character,
)
from backend.lorebook import format_lorebook, match_lorebook_entries
from backend.prompts import PromptError, build_context, render_prompt

from .extractors import (
    apply_character_extractor,
    apply_lorebook_extractor,
    apply_persona_extractor,
)
from .segments import Segment, parse_narrator_output, segments_to_text

logger = logging.getLogger(__name__)


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

    # Resolve connections
    narrator_conn = _resolve_connection(config, story_roles, "narrator")
    if not narrator_conn:
        raise ValueError("Narrator role is not assigned — configure it in Settings")

    intention_conn = _resolve_connection(config, story_roles, "character_intention")
    extractor_conn = _resolve_connection(config, story_roles, "extractor")

    max_rounds = story_roles.get("max_rounds", 3)

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

    # Helper: convert parsed segments into individual messages
    def _segments_to_messages(segments: list[Segment]) -> list[dict]:
        msgs: list[dict] = []
        for seg in segments:
            if seg["type"] == "dialog":
                msgs.append({
                    "role": "dialog",
                    "character": seg["character"],
                    "emotion": seg.get("emotion", ""),
                    "text": seg["text"],
                    "ts": now,
                })
            else:
                if seg["text"].strip():
                    msgs.append({
                        "role": "narrator",
                        "text": seg["text"],
                        "ts": now,
                    })
        return msgs

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
        new_messages.extend(_segments_to_messages(segments))
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

            # Store intention message (always visible)
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
                new_messages.extend(_segments_to_messages(segments))
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

    storage.append_messages(slug, new_messages)
    return {"messages": new_messages}
