"""FastAPI API endpoints under /api.

Endpoint groups: templates, adventures, personas (global + per-adventure),
characters, lorebook, story-roles, chat (pipeline), settings, check-connection,
name-suggestion. Each adventure's child resources (characters, personas,
lorebook, story-roles, messages) are nested under /api/adventures/{slug}/.

Run scripts/routes.sh to print all routes with descriptions.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import storage
from backend.characters import (
    CATEGORY_MAX_VALUES,
    new_character,
    new_persona,
)
from backend.pipeline import run_pipeline

router = APIRouter()


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


@router.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


# ── Templates ─────────────────────────────────────────────


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


# ── Adventures ────────────────────────────────────────────


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


# ── Characters ────────────────────────────────────────────


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


# ── Lorebook ─────────────────────────────────────────────


class LorebookEntry(BaseModel):
    title: str
    content: str
    keywords: list[str]


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


# ── Story Roles (per-adventure) ──────────────────────────


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


# ── Connection Check ──────────────────────────────────────


class CheckConnectionBody(BaseModel):
    provider_url: str
    api_key: str = ""


@router.post("/check-connection")
async def check_connection(body: CheckConnectionBody):
    """Quick health check against an LLM provider URL."""
    import httpx

    url = f"{body.provider_url.rstrip('/')}/api/v1/model"
    headers: dict[str, str] = {}
    if body.api_key:
        headers["Authorization"] = f"Bearer {body.api_key}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
        return {"ok": True}
    except Exception:
        return {"ok": False}


# ── Utility ───────────────────────────────────────────────


@router.get("/name-suggestion")
async def name_suggestion(title: str):
    """Generate a random adventure name for a template title."""
    return {"name": storage.generate_adventure_name(title)}


# ── Settings ─────────────────────────────────────────────


@router.get("/settings")
async def get_settings():
    """Get global app settings (connections, story role defaults, display, fonts)."""
    return storage.get_config()


@router.patch("/settings")
async def update_settings(body: dict):
    """Update global app settings (partial merge)."""
    return storage.update_config(body)
