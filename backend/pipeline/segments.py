"""Narrator output parsing into narration + dialog segments."""

import re

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
