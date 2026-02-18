"""In-memory lorebook data model.

A lorebook is a dict mapping string keys to entry dicts (name, description, etc.).
Supports loading from JSON and looking up entries by key list.
"""

import json

Lorebook = dict[str, dict]


def load_lorebook(path: str) -> Lorebook:
    """Load a lorebook from a JSON file and return it as a dict keyed by entry key."""
    with open(path) as f:
        data = json.load(f)
    # Support both {key: entry} and {"entries": [{key, ...}, ...]} formats
    if isinstance(data, dict) and "entries" not in data:
        return data
    entries = data.get("entries", data) if isinstance(data, dict) else data
    return {entry["key"]: entry for entry in entries}


def lookup(lorebook: Lorebook, keys: list[str]) -> list[dict]:
    """Return lorebook entries for each key that exists in the lorebook."""
    return [lorebook[k] for k in keys if k in lorebook]
