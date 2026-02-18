"""FastMCP server exposing lorebook read/write as MCP tools.

Tools:
  - lookup_lorebook(keys)       — fetch entries by key
  - store_lorebook_entry(...)   — upsert a single entry (key, name, description)

The lorebook is an in-memory dict replaced via set_lorebook() for tests, or
loaded from data/lorebook.json when run as __main__.

Usage:
    uv run python -m backend.mcp_server
"""

from mcp.server.fastmcp import FastMCP

from backend.lorebook import Lorebook, load_lorebook

mcp = FastMCP("rpg-lorebook")

_lorebook: Lorebook = {}


def set_lorebook(lorebook: Lorebook) -> None:
    """Replace the active lorebook (used in tests)."""
    global _lorebook
    _lorebook = lorebook


def get_lorebook() -> Lorebook:
    """Return the active lorebook (used in tests to inspect stored state)."""
    return _lorebook


@mcp.tool()
def lookup_lorebook(keys: list[str]) -> list[dict]:
    """Look up lorebook entries by key and return matching entries."""
    from backend.lorebook import lookup
    return lookup(_lorebook, keys)


@mcp.tool()
def store_lorebook_entry(key: str, name: str, description: str) -> dict:
    """Upsert a lorebook entry. Returns the stored entry."""
    entry = {"key": key, "name": name, "description": description}
    _lorebook[key] = entry
    return entry


if __name__ == "__main__":
    import os
    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "lorebook.json")
    set_lorebook(load_lorebook(data_path))
    mcp.run()
