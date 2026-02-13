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
    *,
    narration: str | None = None,
    chars: dict[str, Any] | None = None,
    lore_text: str | None = None,
    lore_entries: list[dict[str, Any]] | None = None,
    intention: str | None = None,
    char_name: str | None = None,
    char_description: str | None = None,
    char_states: list[dict[str, Any]] | None = None,
    char_all_states: list[dict[str, Any]] | None = None,
    narration_so_far: str | None = None,
    round_narrations: str | None = None,
    player_name: str | None = None,
) -> dict[str, Any]:
    """Assemble template variables from adventure state.

    Returns a dict suitable for passing to render_prompt().
    Nested objects: char, chars, turn, lore, msgs.
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
        "msgs": enriched,
        "history": "\n".join(history_parts),
    }
    if player_name is not None:
        ctx["player_name"] = player_name
    if narration is not None:
        ctx["narration"] = narration
    if chars is not None:
        ctx["chars"] = chars
    if lore_text is not None or lore_entries is not None:
        lore: dict[str, Any] = {}
        if lore_text is not None:
            lore["text"] = lore_text
        if lore_entries is not None:
            lore["entries"] = lore_entries
        ctx["lore"] = lore
    if intention is not None:
        ctx["intention"] = intention
    if char_name is not None or char_description is not None \
            or char_states is not None or char_all_states is not None:
        char: dict[str, Any] = {}
        if char_name is not None:
            char["name"] = char_name
        if char_description is not None:
            char["description"] = char_description
        if char_states is not None:
            char["states"] = char_states
        if char_all_states is not None:
            char["all_states"] = char_all_states
        ctx["char"] = char
    if narration_so_far is not None or round_narrations is not None:
        turn: dict[str, Any] = {}
        if narration_so_far is not None:
            turn["narration"] = narration_so_far
        if round_narrations is not None:
            turn["round_narrations"] = round_narrations
        ctx["turn"] = turn

    return ctx
