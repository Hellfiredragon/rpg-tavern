from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import storage

router = APIRouter()


class CreateAdventure(BaseModel):
    name: str
    description: str = ""


class UpdateAdventure(BaseModel):
    name: str | None = None
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
    return storage.create_adventure(body.name, body.description)


@router.get("/adventures/{adventure_id}")
async def get_adventure(adventure_id: str):
    adventure = storage.get_adventure(adventure_id)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return adventure


@router.patch("/adventures/{adventure_id}")
async def update_adventure(adventure_id: str, body: UpdateAdventure):
    fields = body.model_dump(exclude_none=True)
    updated = storage.update_adventure(adventure_id, fields)
    if not updated:
        raise HTTPException(404, "Adventure not found")
    return updated


@router.post("/adventures/{adventure_id}/embark", status_code=201)
async def embark_adventure(adventure_id: str):
    running = storage.embark_adventure(adventure_id)
    if not running:
        raise HTTPException(404, "Adventure not found")
    return running


@router.delete("/adventures/{adventure_id}")
async def delete_adventure(adventure_id: str):
    if not storage.delete_adventure(adventure_id):
        raise HTTPException(404, "Adventure not found")
    return {"ok": True}
