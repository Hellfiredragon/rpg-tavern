"""Template CRUD + embark endpoints."""

from fastapi import APIRouter, HTTPException

from backend import storage

from .models import CreateTemplate, EmbarkBody, UpdateTemplate

router = APIRouter()


@router.get("/templates")
async def list_templates():
    """List all templates (presets merged with user-created)."""
    return storage.list_templates()


@router.post("/templates", status_code=201)
async def create_template(body: CreateTemplate):
    """Create a new template."""
    try:
        return storage.create_template(body.title, body.description)
    except FileExistsError as e:
        raise HTTPException(409, str(e))


@router.get("/templates/{slug}")
async def get_template(slug: str):
    """Get a single template by slug."""
    template = storage.get_template(slug)
    if not template:
        raise HTTPException(404, "Template not found")
    return template


@router.patch("/templates/{slug}")
async def update_template(slug: str, body: UpdateTemplate):
    """Update template fields (title, description, intro)."""
    fields = body.model_dump(exclude_none=True)
    try:
        updated = storage.update_template(slug, fields)
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    if not updated:
        raise HTTPException(404, "Template not found")
    return updated


@router.delete("/templates/{slug}")
async def delete_template(slug: str):
    """Delete a template (or remove user override to reveal preset)."""
    if not storage.delete_template(slug):
        raise HTTPException(404, "Template not found")
    return {"ok": True}


@router.post("/templates/{slug}/embark", status_code=201)
async def embark_template(slug: str, body: EmbarkBody):
    """Create a running adventure from this template."""
    adventure = storage.embark_template(slug, body.title, body.player_name)
    if not adventure:
        raise HTTPException(404, "Template not found")
    return adventure
