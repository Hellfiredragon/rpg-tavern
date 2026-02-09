"""Handlebars prompt rendering for story roles."""

from collections.abc import Callable
from typing import Any

import pybars


_compiler = pybars.Compiler()
_cache: dict[str, Callable] = {}


class PromptError(Exception):
    """Raised when a Handlebars template fails to compile or render."""


def render_prompt(template_str: str, context: dict[str, Any]) -> str:
    """Compile and render a Handlebars template with the given context.

    Templates are cached by source string to avoid recompilation.
    """
    try:
        compiled = _cache.get(template_str)
        if compiled is None:
            compiled = _compiler.compile(template_str)
            _cache[template_str] = compiled
        return compiled(context)
    except Exception as e:
        raise PromptError(f"Template error: {e}") from e


def build_context(
    adventure: dict[str, Any],
    messages: list[dict[str, Any]],
    player_message: str,
    narration: str | None = None,
) -> dict[str, Any]:
    """Assemble template variables from adventure state.

    Returns a dict suitable for passing to render_prompt().
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
        "messages": enriched,
        "history": "\n".join(history_parts),
    }
    if narration is not None:
        ctx["narration"] = narration
    return ctx
