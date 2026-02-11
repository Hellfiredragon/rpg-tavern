"""Lorebook keyword matching and formatting."""


def match_lorebook_entries(
    entries: list[dict], texts: list[str]
) -> list[dict]:
    """Return entries whose keywords match any of the given texts.

    Matching is case-insensitive substring search. Results are deduplicated
    and returned in original order.
    """
    combined = " ".join(texts).lower()
    seen: set[str] = set()
    matched: list[dict] = []
    for entry in entries:
        if entry["title"] in seen:
            continue
        for keyword in entry.get("keywords", []):
            if keyword.lower() in combined:
                matched.append(entry)
                seen.add(entry["title"])
                break
    return matched


def format_lorebook(entries: list[dict]) -> str:
    """Format matched lorebook entries into a prompt string."""
    if not entries:
        return ""
    parts: list[str] = []
    for entry in entries:
        parts.append(f"[{entry['title']}] {entry['content']}")
    return "\n".join(parts)
