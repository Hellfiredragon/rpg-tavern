"""Pydantic request/response models for API endpoints."""

from pydantic import BaseModel


class CreateTemplate(BaseModel):
    title: str
    description: str = ""


class UpdateTemplate(BaseModel):
    title: str | None = None
    description: str | None = None
    intro: str | None = None


class EmbarkBody(BaseModel):
    title: str
    player_name: str = ""


class UpdateAdventure(BaseModel):
    player_name: str | None = None
    active_persona: str | None = None


class ChatBody(BaseModel):
    message: str


class CreateCharacter(BaseModel):
    name: str


class UpdateCharacterStates(BaseModel):
    states: dict[str, list[dict]] | None = None
    nicknames: list[str] | None = None
    chattiness: int | None = None


class CreatePersona(BaseModel):
    name: str


class UpdatePersona(BaseModel):
    states: dict[str, list[dict]] | None = None
    nicknames: list[str] | None = None
    description: str | None = None


class LorebookEntry(BaseModel):
    title: str
    content: str
    keywords: list[str]


class CheckConnectionBody(BaseModel):
    provider_url: str
    api_key: str = ""
