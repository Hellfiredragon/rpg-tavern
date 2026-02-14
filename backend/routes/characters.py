"""Character CRUD endpoints."""

from fastapi import APIRouter, HTTPException

from backend import storage
from backend.characters import new_character

from .models import CreateCharacter, UpdateCharacterStates

router = APIRouter()


@router.get("/adventures/{slug}/characters")
async def list_characters(slug: str):
    """List all characters in an adventure."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_characters(slug)


@router.post("/adventures/{slug}/characters", status_code=201)
async def create_character(slug: str, body: CreateCharacter):
    """Create a new character in an adventure."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    characters = storage.get_characters(slug)
    char = new_character(body.name)
    # Check for slug collision
    if any(c["slug"] == char["slug"] for c in characters):
        raise HTTPException(409, f"Character '{body.name}' already exists")
    characters.append(char)
    storage.save_characters(slug, characters)
    return char


@router.get("/adventures/{slug}/characters/{cslug}")
async def get_character_endpoint(slug: str, cslug: str):
    """Get a single character by slug."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    char = storage.get_character(slug, cslug)
    if not char:
        raise HTTPException(404, "Character not found")
    return char


@router.patch("/adventures/{slug}/characters/{cslug}")
async def update_character(slug: str, cslug: str, body: UpdateCharacterStates):
    """Update character states, nicknames, or chattiness."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    characters = storage.get_characters(slug)
    found = None
    for char in characters:
        if char["slug"] == cslug:
            found = char
            break
    if not found:
        raise HTTPException(404, "Character not found")
    if body.states:
        for category in ("core", "persistent", "temporal"):
            if category in body.states:
                found["states"][category] = body.states[category]
    if body.nicknames is not None:
        found["nicknames"] = body.nicknames
    if body.chattiness is not None:
        found["chattiness"] = max(0, min(100, body.chattiness))
    storage.save_characters(slug, characters)
    return found


@router.delete("/adventures/{slug}/characters/{cslug}")
async def delete_character(slug: str, cslug: str):
    """Remove a character from an adventure."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    characters = storage.get_characters(slug)
    new_list = [c for c in characters if c["slug"] != cslug]
    if len(new_list) == len(characters):
        raise HTTPException(404, "Character not found")
    storage.save_characters(slug, new_list)
    return {"ok": True}
