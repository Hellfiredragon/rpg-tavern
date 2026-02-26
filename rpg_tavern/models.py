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

# State categories as defined in character_state.md
StateCategoryType = Literal["temporary", "persistent", "identity"]


class Message(BaseModel):
    """A single entry in an adventure's append-only message stream."""

    turn_id: int
    seq: int
    owner: str  # "narrator" | "system" | <persona_id> | <character_id>
    type: MessageType
    content: str
    mood: str | None = None  # present on dialog messages only


class ExtractorOutput(BaseModel):
    """Structured output returned by persona and character extractor stages.

    The state engine applies these symbolic operations to the actor's state map.
    No raw numeric values are passed to or from the LLM.
    """

    amplify:   list[str] = Field(default_factory=list)
    suppress:  list[str] = Field(default_factory=list)
    overflow:  str | None = None   # persistent state to escalate; ignored if not persistent
    evolution: str | None = None   # new name when overflow reaches 30; used only then


def _empty_states() -> dict:
    return {"temporary": {}, "persistent": {}, "identity": {}}


class Character(BaseModel):
    """An NPC in the adventure."""

    id: str
    name: str
    description: str
    chattiness: int = 50  # 0–100; governs activation probability
    baked: bool = False   # baked NPCs always activate regardless of chattiness roll
    states: dict = Field(default_factory=_empty_states)


class Persona(BaseModel):
    """A player-controlled persona."""

    id: str
    name: str
    description: str
    states: dict = Field(default_factory=_empty_states)


class Adventure(BaseModel):
    """Adventure metadata stored on disk."""

    slug: str
    title: str
    setting: str
