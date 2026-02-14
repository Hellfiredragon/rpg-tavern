"""Lorebook CRUD endpoints."""

from fastapi import APIRouter, HTTPException

from backend import storage

from .models import LorebookEntry

router = APIRouter()


@router.get("/adventures/{slug}/lorebook")
async def get_lorebook(slug: str):
    """Get lorebook entries for an adventure."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_lorebook(slug)


@router.post("/adventures/{slug}/lorebook", status_code=201)
async def add_lorebook_entry(slug: str, body: LorebookEntry):
    """Add a new lorebook entry."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    entries = storage.get_lorebook(slug)
    entries.append(body.model_dump())
    storage.save_lorebook(slug, entries)
    return entries


@router.patch("/adventures/{slug}/lorebook/{index}")
async def update_lorebook_entry(slug: str, index: int, body: LorebookEntry):
    """Update a lorebook entry by index."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    entries = storage.get_lorebook(slug)
    if index < 0 or index >= len(entries):
        raise HTTPException(404, "Lorebook entry not found")
    entries[index] = body.model_dump()
    storage.save_lorebook(slug, entries)
    return entries


@router.delete("/adventures/{slug}/lorebook/{index}")
async def delete_lorebook_entry(slug: str, index: int):
    """Delete a lorebook entry by index."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    entries = storage.get_lorebook(slug)
    if index < 0 or index >= len(entries):
        raise HTTPException(404, "Lorebook entry not found")
    entries.pop(index)
    storage.save_lorebook(slug, entries)
    return entries
