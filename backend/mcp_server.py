"""FastMCP server exposing lorebook lookup as an MCP tool.

Runs as a stdio MCP server. The lorebook is loaded from data/lorebook.json
(relative to the project root) at import time, or can be replaced via
set_lorebook() for testing.

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


@mcp.tool()
def lookup_lorebook(keys: list[str]) -> list[dict]:
    """Look up lorebook entries by key and return matching entries."""
    from backend.lorebook import lookup
    return lookup(_lorebook, keys)


if __name__ == "__main__":
    import os
    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "lorebook.json")
    set_lorebook(load_lorebook(data_path))
    mcp.run()
