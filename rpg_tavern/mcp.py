"""Minimal MCP (Model Context Protocol) client layer.

All world-state mutations in the pipeline must go through MCP tools, not
through direct Storage calls.  This module defines the protocol and an
in-process implementation backed by a Storage instance.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from rpg_tavern.models import ExtractorOutput
from rpg_tavern.storage import Storage


@runtime_checkable
class McpClient(Protocol):
    """Protocol for MCP tool dispatch.

    Any object that implements these methods can be injected into the
    pipeline.  The in-process client below is used in tests and for local
    development without a running MCP server.
    """

    def update_character_state(
        self,
        adventure_slug: str,
        char_id: str,
        output: ExtractorOutput,
    ) -> None: ...

    def update_persona_state(
        self,
        adventure_slug: str,
        persona_id: str,
        output: ExtractorOutput,
    ) -> None: ...

    def store_lorebook_entry(
        self,
        adventure_slug: str,
        key: str,
        content: str,
    ) -> None: ...


class InProcessMcpClient:
    """MCP client that runs directly against a Storage instance.

    Used in tests and local development.  No network, no serialisation.
    """

    def __init__(self, storage: Storage) -> None:
        self._storage = storage

    def update_character_state(
        self,
        adventure_slug: str,
        char_id: str,
        output: ExtractorOutput,
    ) -> None:
        self._storage.apply_character_extraction(adventure_slug, char_id, output)

    def update_persona_state(
        self,
        adventure_slug: str,
        persona_id: str,
        output: ExtractorOutput,
    ) -> None:
        self._storage.apply_persona_extraction(adventure_slug, persona_id, output)

    def store_lorebook_entry(
        self,
        adventure_slug: str,
        key: str,
        content: str,
    ) -> None:
        self._storage.append_lorebook_entries(
            adventure_slug, [{"key": key, "content": content}]
        )
