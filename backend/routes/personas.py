"""Global + adventure-scoped persona endpoints (including promote/localize)."""

from fastapi import APIRouter, HTTPException

from backend import storage
from backend.characters import new_persona

from .models import CreatePersona, UpdatePersona

router = APIRouter()


# ── Personas (global) ────────────────────────────────────


@router.get("/personas")
async def list_global_personas():
    """List global personas."""
    return storage.get_global_personas()


@router.post("/personas", status_code=201)
async def create_global_persona(body: CreatePersona):
    """Create a new global persona."""
    personas = storage.get_global_personas()
    persona = new_persona(body.name)
    if any(p["slug"] == persona["slug"] for p in personas):
        raise HTTPException(409, f"Persona '{body.name}' already exists")
    personas.append(persona)
    storage.save_global_personas(personas)
    return persona


@router.patch("/personas/{pslug}")
async def update_global_persona(pslug: str, body: UpdatePersona):
    """Update a global persona's states, nicknames, or description."""
    personas = storage.get_global_personas()
    found = None
    for p in personas:
        if p["slug"] == pslug:
            found = p
            break
    if not found:
        raise HTTPException(404, "Persona not found")
    if body.states:
        for category in ("core", "persistent", "temporal"):
            if category in body.states:
                found["states"][category] = body.states[category]
    if body.nicknames is not None:
        found["nicknames"] = body.nicknames
    if body.description is not None:
        found["description"] = body.description
    storage.save_global_personas(personas)
    return found


@router.delete("/personas/{pslug}")
async def delete_global_persona(pslug: str):
    """Delete a global persona."""
    personas = storage.get_global_personas()
    new_list = [p for p in personas if p["slug"] != pslug]
    if len(new_list) == len(personas):
        raise HTTPException(404, "Persona not found")
    storage.save_global_personas(new_list)
    return {"ok": True}


# ── Personas (adventure-scoped) ──────────────────────────


@router.get("/adventures/{slug}/personas")
async def list_adventure_personas(slug: str):
    """List merged personas (adventure-local + global, local wins by slug)."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_merged_personas(slug)


@router.post("/adventures/{slug}/personas", status_code=201)
async def create_adventure_persona(slug: str, body: CreatePersona):
    """Create an adventure-local persona."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    personas = storage.get_adventure_personas(slug)
    persona = new_persona(body.name)
    # Check collision in both adventure-local and global
    merged = storage.get_merged_personas(slug)
    if any(p["slug"] == persona["slug"] for p in merged):
        raise HTTPException(409, f"Persona '{body.name}' already exists")
    personas.append(persona)
    storage.save_adventure_personas(slug, personas)
    return persona


@router.patch("/adventures/{slug}/personas/{pslug}")
async def update_adventure_persona(slug: str, pslug: str, body: UpdatePersona):
    """Update an adventure persona (copy-on-write from global if needed)."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    # Copy-on-write: if only global, copy to adventure first
    local_personas = storage.get_adventure_personas(slug)
    found = None
    for p in local_personas:
        if p["slug"] == pslug:
            found = p
            break
    if not found:
        # Check if global persona exists — copy to adventure
        global_personas = storage.get_global_personas()
        for p in global_personas:
            if p["slug"] == pslug:
                found = dict(p)  # shallow copy
                local_personas.append(found)
                break
    if not found:
        raise HTTPException(404, "Persona not found")
    if body.states:
        for category in ("core", "persistent", "temporal"):
            if category in body.states:
                found["states"][category] = body.states[category]
    if body.nicknames is not None:
        found["nicknames"] = body.nicknames
    if body.description is not None:
        found["description"] = body.description
    storage.save_adventure_personas(slug, local_personas)
    return found


@router.delete("/adventures/{slug}/personas/{pslug}")
async def delete_adventure_persona(slug: str, pslug: str):
    """Delete an adventure-local persona (reveals global if exists)."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    personas = storage.get_adventure_personas(slug)
    new_list = [p for p in personas if p["slug"] != pslug]
    if len(new_list) == len(personas):
        raise HTTPException(404, "Persona not found")
    storage.save_adventure_personas(slug, new_list)
    return {"ok": True}


@router.post("/adventures/{slug}/personas/{pslug}/promote")
async def promote_persona(slug: str, pslug: str):
    """Copy adventure-local persona to global."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    local_personas = storage.get_adventure_personas(slug)
    found = None
    for p in local_personas:
        if p["slug"] == pslug:
            found = p
            break
    if not found:
        raise HTTPException(404, "Adventure persona not found")
    global_personas = storage.get_global_personas()
    # Replace or append
    replaced = False
    for i, gp in enumerate(global_personas):
        if gp["slug"] == pslug:
            global_personas[i] = dict(found)
            replaced = True
            break
    if not replaced:
        global_personas.append(dict(found))
    storage.save_global_personas(global_personas)
    # Remove the adventure-local copy so the global one takes over
    local_personas = [p for p in local_personas if p["slug"] != pslug]
    storage.save_adventure_personas(slug, local_personas)
    return {"ok": True}


@router.post("/adventures/{slug}/personas/{pslug}/localize")
async def localize_persona(slug: str, pslug: str):
    """Copy global persona to adventure-local."""
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    global_personas = storage.get_global_personas()
    found = None
    for p in global_personas:
        if p["slug"] == pslug:
            found = p
            break
    if not found:
        raise HTTPException(404, "Global persona not found")
    local_personas = storage.get_adventure_personas(slug)
    # Replace or append
    replaced = False
    for i, lp in enumerate(local_personas):
        if lp["slug"] == pslug:
            local_personas[i] = dict(found)
            replaced = True
            break
    if not replaced:
        local_personas.append(dict(found))
    storage.save_adventure_personas(slug, local_personas)
    return {"ok": True}
