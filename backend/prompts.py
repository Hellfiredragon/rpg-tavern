"""Handlebars prompt rendering for story roles."""

from collections.abc import Callable
from typing import Any

import pybars


_compiler = pybars.Compiler()
_cache: dict[str, Callable] = {}


class PromptError(Exception):
    """Raised when a Handlebars template fails to compile or render."""


# ── Custom Handlebars helpers ────────────────────────────


def _helper_take(this, options, items, count):
    """{{#take array N}}...{{/take}} — iterate over the first N items."""
    result = []
    for item in list(items)[:int(count)]:
        result.extend(options["fn"](item))
    return result


def _helper_last(this, options, items, count):
    """{{#last array N}}...{{/last}} — iterate over the last N items."""
    result = []
    for item in list(items)[-int(count):]:
        result.extend(options["fn"](item))
    return result


_HELPERS: dict[str, Callable] = {
    "take": _helper_take,
    "last": _helper_last,
}


def render_prompt(template_str: str, context: dict[str, Any]) -> str:
    """Compile and render a Handlebars template with the given context.

    Templates are cached by source string to avoid recompilation.
    """
    try:
        compiled = _cache.get(template_str)
        if compiled is None:
            compiled = _compiler.compile(template_str)
            _cache[template_str] = compiled
        return compiled(context, helpers=_HELPERS)
    except Exception as e:
        raise PromptError(f"Template error: {e}") from e


def build_context(
    adventure: dict[str, Any],
    messages: list[dict[str, Any]],
    player_message: str,
    narration: str | None = None,
    characters: dict[str, Any] | None = None,
    lorebook: str | None = None,
    lorebook_entries: list[dict[str, Any]] | None = None,
    active_characters: list[dict[str, Any]] | None = None,
    active_characters_summary: str | None = None,
    intention: str | None = None,
    char_name: str | None = None,
    char_description: str | None = None,
    char_states: str | None = None,
    char_all_states: str | None = None,
    narration_so_far: str | None = None,
    round_narrations: str | None = None,
) -> dict[str, Any]:
    """Assemble template variables from adventure state.

    Returns a dict suitable for passing to render_prompt().
    Builds nested objects (char, chars, turn, lore, msgs) for short
    Handlebars paths, and keeps old flat keys as backward-compat aliases.
    """
    enriched = []
    for msg in messages:
        enriched.append({
            "role": msg["role"],
            "text": msg["text"],
            "ts": msg.get("ts", ""),
            "is_player": msg["role"] == "player",
            "is_narrator": msg["role"] == "narrator",
        })

    # Pre-formatted history string (> for player, bare for narrator)
    history_parts: list[str] = []
    for msg in messages:
        if msg["role"] == "player":
            history_parts.append(f"> {msg['text']}")
        else:
            history_parts.append(msg["text"])
        history_parts.append("")

    ctx: dict[str, Any] = {
        "title": adventure.get("title", ""),
        "description": adventure.get("description", ""),
        "message": player_message,
        "messages": enriched,  # backward compat alias
        "msgs": enriched,      # new short name
        "history": "\n".join(history_parts),
    }
    if narration is not None:
        ctx["narration"] = narration

    # ── chars (characters collection) ──
    if characters is not None:
        chars_list = characters.get("characters", [])
        chars_summary = characters.get("characters_summary", "")
        ctx["chars"] = {"list": chars_list, "summary": chars_summary}
        # backward compat
        ctx["characters"] = chars_list
        ctx["characters_summary"] = chars_summary
    if active_characters is not None:
        ctx.setdefault("chars", {})["active"] = active_characters
        ctx["active_characters"] = active_characters  # backward compat
    if active_characters_summary is not None:
        ctx.setdefault("chars", {})["active_summary"] = active_characters_summary
        ctx["active_characters_summary"] = active_characters_summary  # backward compat

    # ── lore (lorebook) ──
    if lorebook is not None:
        ctx.setdefault("lore", {})["text"] = lorebook
        ctx["lorebook"] = lorebook  # backward compat
    if lorebook_entries is not None:
        ctx.setdefault("lore", {})["entries"] = lorebook_entries
        ctx["lorebook_entries"] = lorebook_entries  # backward compat

    # ── Pipeline-specific context ──
    if intention is not None:
        ctx["intention"] = intention

    # ── char (single character) ──
    if char_name is not None:
        ctx.setdefault("char", {})["name"] = char_name
        ctx["character_name"] = char_name  # backward compat
    if char_description is not None:
        ctx.setdefault("char", {})["description"] = char_description
        ctx["character_description"] = char_description  # backward compat
    if char_states is not None:
        ctx.setdefault("char", {})["states"] = char_states
        ctx["character_states"] = char_states  # backward compat
    if char_all_states is not None:
        ctx.setdefault("char", {})["all_states"] = char_all_states
        ctx["character_all_states"] = char_all_states  # backward compat

    # ── turn (current turn context) ──
    if narration_so_far is not None:
        ctx.setdefault("turn", {})["narration"] = narration_so_far
        ctx["narration_so_far"] = narration_so_far  # backward compat
    if round_narrations is not None:
        ctx.setdefault("turn", {})["round_narrations"] = round_narrations
        ctx["round_narrations"] = round_narrations  # backward compat

    return ctx
