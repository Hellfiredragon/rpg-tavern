"""Core domain models.

All pipeline stages and storage functions operate on these types.
Pydantic is used for validation and serialisation at every data boundary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MessageType = Literal[
    "narration",
    "dialog",
    "intention",
    "thought",
    "scene_marker",
    "system",
]


class Message(BaseModel):
    """A single entry in an adventure's append-only message stream."""

    turn_id: int
    seq: int
    owner: str  # "narrator" | "system" | <persona_id> | <character_id>
    type: MessageType
    content: str
    mood: str | None = None  # present on dialog messages only


class Character(BaseModel):
    """An NPC in the adventure."""

    id: str
    name: str
    description: str
    chattiness: int = 50  # 0–100; governs activation probability
    states: list[dict] = Field(default_factory=list)


class Persona(BaseModel):
    """A player-controlled persona."""

    id: str
    name: str
    description: str
    states: list[dict] = Field(default_factory=list)


class Adventure(BaseModel):
    """Adventure metadata stored on disk."""

    slug: str
    title: str
    setting: str
