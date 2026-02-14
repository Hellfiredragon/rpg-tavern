"""Story role get/update endpoints."""

from fastapi import APIRouter, HTTPException

from backend import storage

router = APIRouter()


@router.get("/adventures/{slug}/story-roles")
async def get_story_roles(slug: str):
    """Get per-adventure story role settings (prompts, connections, pipeline config)."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_story_roles(slug)


@router.patch("/adventures/{slug}/story-roles")
async def update_story_roles(slug: str, body: dict):
    """Update story role settings (partial merge)."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.update_story_roles(slug, body)
