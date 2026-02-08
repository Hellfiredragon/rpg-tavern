from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import storage

router = APIRouter()


class CreateAdventure(BaseModel):
    name: str
    description: str = ""


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


@router.delete("/adventures/{adventure_id}")
async def delete_adventure(adventure_id: str):
    if not storage.delete_adventure(adventure_id):
        raise HTTPException(404, "Adventure not found")
    return {"ok": True}
