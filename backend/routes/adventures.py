"""Adventure CRUD + messages + chat pipeline endpoints."""

from fastapi import APIRouter, HTTPException

from backend import storage
from backend.pipeline import run_pipeline

from .models import ChatBody, UpdateAdventure

router = APIRouter()


@router.get("/adventures")
async def list_adventures():
    """List all running adventures."""
    return storage.list_adventures()


@router.get("/adventures/{slug}")
async def get_adventure(slug: str):
    """Get a single adventure by slug."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return adventure


@router.delete("/adventures/{slug}")
async def delete_adventure(slug: str):
    """Delete an adventure and all its data."""
    if not storage.delete_adventure(slug):
        raise HTTPException(404, "Adventure not found")
    return {"ok": True}


@router.patch("/adventures/{slug}")
async def update_adventure(slug: str, body: UpdateAdventure):
    """Update adventure fields (player_name, active_persona)."""
    fields = body.model_dump(exclude_none=True)
    updated = storage.update_adventure(slug, fields)
    if not updated:
        raise HTTPException(404, "Adventure not found")
    return updated


@router.get("/adventures/{slug}/messages")
async def get_messages(slug: str):
    """Get chat message history for an adventure."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_messages(slug)


@router.delete("/adventures/{slug}/messages/{index}")
async def delete_message(slug: str, index: int):
    """Delete a single message by index."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    try:
        messages = storage.delete_message(slug, index)
    except IndexError:
        raise HTTPException(404, "Message not found")
    return messages


@router.post("/adventures/{slug}/chat")
async def adventure_chat(slug: str, body: ChatBody):
    """Send a player message and run the chat pipeline."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")

    config = storage.get_config()
    story_roles = storage.get_story_roles(slug)
    history = storage.get_messages(slug)
    characters = storage.get_characters(slug)

    try:
        result = await run_pipeline(
            slug=slug,
            player_message=body.message,
            adventure=adventure,
            config=config,
            story_roles=story_roles,
            history=history,
            characters=characters,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    return result
