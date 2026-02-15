"""Chat message storage (append-only log per adventure)."""

import json
from typing import Any

from .adventures import touch_adventure
from .core import adventures_dir


def get_messages(slug: str) -> list[dict[str, Any]]:
    """Load messages for an adventure. Returns [] if none exist."""
    path = adventures_dir() / slug / "messages.json"
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def append_messages(slug: str, messages: list[dict[str, Any]]) -> None:
    """Append messages to an adventure's chat log."""
    path = adventures_dir() / slug / "messages.json"
    existing = get_messages(slug)
    existing.extend(messages)
    path.write_text(json.dumps(existing, indent=2))
    touch_adventure(slug)


def delete_message(slug: str, index: int) -> list[dict[str, Any]]:
    """Delete a message by index. Returns updated message list."""
    messages = get_messages(slug)
    if index < 0 or index >= len(messages):
        raise IndexError(f"Message index {index} out of range")
    messages.pop(index)
    path = adventures_dir() / slug / "messages.json"
    path.write_text(json.dumps(messages, indent=2))
    touch_adventure(slug)
    return messages
