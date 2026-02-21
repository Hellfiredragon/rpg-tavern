"""JSON file storage.

All state is stored in flat JSON files under a configurable base directory.
There is no database or ORM — reads and writes go through plain helper
methods that load and dump JSON.

Directory layout:

    {base}/
      adventures/
        {slug}.json           ← adventure metadata
        {slug}/
          characters.json     ← list of Character objects
          personas.json       ← list of Persona objects
          messages.json       ← append-only Message stream
          lorebook.json       ← list of lore entry dicts, keyed by "key"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rpg_tavern.models import Adventure, Character, Message, Persona


class Storage:
    def __init__(self, base_path: Path) -> None:
        self._base = base_path
        self._adv_root = base_path / "adventures"
        self._adv_root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Internal path helpers
    # ------------------------------------------------------------------

    def _adv_file(self, slug: str) -> Path:
        return self._adv_root / f"{slug}.json"

    def _adv_dir(self, slug: str) -> Path:
        return self._adv_root / slug

    def _read_json(self, path: Path) -> Any:
        return json.loads(path.read_text())

    def _write_json(self, path: Path, data: Any) -> None:
        path.write_text(json.dumps(data, indent=2))

    # ------------------------------------------------------------------
    # Adventures
    # ------------------------------------------------------------------

    def create_adventure(self, slug: str, title: str, setting: str) -> Adventure:
        adv = Adventure(slug=slug, title=title, setting=setting)
        self._adv_file(slug).write_text(adv.model_dump_json(indent=2))
        self._adv_dir(slug).mkdir(exist_ok=True)
        return adv

    def get_adventure(self, slug: str) -> Adventure | None:
        path = self._adv_file(slug)
        if not path.exists():
            return None
        return Adventure.model_validate_json(path.read_text())

    # ------------------------------------------------------------------
    # Characters
    # ------------------------------------------------------------------

    def save_character(self, adventure_slug: str, character: Character) -> None:
        """Upsert a character by id."""
        chars = self.get_characters(adventure_slug)
        for i, c in enumerate(chars):
            if c.id == character.id:
                chars[i] = character
                break
        else:
            chars.append(character)
        self._write_json(
            self._adv_dir(adventure_slug) / "characters.json",
            [c.model_dump() for c in chars],
        )

    def get_characters(self, adventure_slug: str) -> list[Character]:
        path = self._adv_dir(adventure_slug) / "characters.json"
        if not path.exists():
            return []
        return [Character.model_validate(c) for c in self._read_json(path)]

    # ------------------------------------------------------------------
    # Personas
    # ------------------------------------------------------------------

    def save_persona(self, adventure_slug: str, persona: Persona) -> None:
        """Upsert a persona by id."""
        personas = self.get_personas(adventure_slug)
        for i, p in enumerate(personas):
            if p.id == persona.id:
                personas[i] = persona
                break
        else:
            personas.append(persona)
        self._write_json(
            self._adv_dir(adventure_slug) / "personas.json",
            [p.model_dump() for p in personas],
        )

    def get_personas(self, adventure_slug: str) -> list[Persona]:
        path = self._adv_dir(adventure_slug) / "personas.json"
        if not path.exists():
            return []
        return [Persona.model_validate(p) for p in self._read_json(path)]

    # ------------------------------------------------------------------
    # Messages (append-only)
    # ------------------------------------------------------------------

    def get_messages(self, adventure_slug: str) -> list[Message]:
        path = self._adv_dir(adventure_slug) / "messages.json"
        if not path.exists():
            return []
        return [Message.model_validate(m) for m in self._read_json(path)]

    def append_messages(self, adventure_slug: str, messages: list[Message]) -> None:
        existing = self.get_messages(adventure_slug)
        existing.extend(messages)
        self._write_json(
            self._adv_dir(adventure_slug) / "messages.json",
            [m.model_dump() for m in existing],
        )

    # ------------------------------------------------------------------
    # Lorebook
    # ------------------------------------------------------------------

    def get_lorebook(self, adventure_slug: str) -> list[dict]:
        path = self._adv_dir(adventure_slug) / "lorebook.json"
        if not path.exists():
            return []
        return self._read_json(path)

    def append_lorebook_entries(
        self, adventure_slug: str, entries: list[dict]
    ) -> None:
        """Upsert entries by key — existing keys are overwritten."""
        existing = {e["key"]: e for e in self.get_lorebook(adventure_slug)}
        for entry in entries:
            existing[entry["key"]] = entry
        self._write_json(
            self._adv_dir(adventure_slug) / "lorebook.json",
            list(existing.values()),
        )
