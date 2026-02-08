from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import storage

router = APIRouter()


class CreateAdventure(BaseModel):
    title: str
    description: str = ""


class UpdateAdventure(BaseModel):
    title: str | None = None
    description: str | None = None
    variant: str | None = None


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/adventures")
async def list_adventures():
    return storage.list_adventures()


@router.post("/adventures", status_code=201)
async def create_adventure(body: CreateAdventure):
    try:
        return storage.create_adventure(body.title, body.description)
    except FileExistsError as e:
        raise HTTPException(409, str(e))


@router.get("/adventures/{slug}")
async def get_adventure(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return adventure


@router.patch("/adventures/{slug}")
async def update_adventure(slug: str, body: UpdateAdventure):
    fields = body.model_dump(exclude_none=True)
    try:
        updated = storage.update_adventure(slug, fields)
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    if not updated:
        raise HTTPException(404, "Adventure not found")
    return updated


@router.post("/adventures/{slug}/embark", status_code=201)
async def embark_adventure(slug: str):
    running = storage.embark_adventure(slug)
    if not running:
        raise HTTPException(404, "Adventure not found")
    return running


@router.delete("/adventures/{slug}")
async def delete_adventure(slug: str):
    if not storage.delete_adventure(slug):
        raise HTTPException(404, "Adventure not found")
    return {"ok": True}
