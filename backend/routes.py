from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import llm, storage
from backend.characters import character_prompt_context, new_character, tick_character
from backend.prompts import PromptError, build_context, render_prompt

router = APIRouter()


class CreateTemplate(BaseModel):
    title: str
    description: str = ""


class UpdateTemplate(BaseModel):
    title: str | None = None
    description: str | None = None


class EmbarkBody(BaseModel):
    title: str


class ChatBody(BaseModel):
    message: str


class CreateCharacter(BaseModel):
    name: str


class UpdateCharacterStates(BaseModel):
    states: dict[str, list[dict]] | None = None


@router.get("/health")
async def health():
    return {"status": "ok"}


# ── Templates ─────────────────────────────────────────────


@router.get("/templates")
async def list_templates():
    return storage.list_templates()


@router.post("/templates", status_code=201)
async def create_template(body: CreateTemplate):
    try:
        return storage.create_template(body.title, body.description)
    except FileExistsError as e:
        raise HTTPException(409, str(e))


@router.get("/templates/{slug}")
async def get_template(slug: str):
    template = storage.get_template(slug)
    if not template:
        raise HTTPException(404, "Template not found")
    return template


@router.patch("/templates/{slug}")
async def update_template(slug: str, body: UpdateTemplate):
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
    if not storage.delete_template(slug):
        raise HTTPException(404, "Template not found")
    return {"ok": True}


@router.post("/templates/{slug}/embark", status_code=201)
async def embark_template(slug: str, body: EmbarkBody):
    adventure = storage.embark_template(slug, body.title)
    if not adventure:
        raise HTTPException(404, "Template not found")
    return adventure


# ── Adventures ────────────────────────────────────────────


@router.get("/adventures")
async def list_adventures():
    return storage.list_adventures()


@router.get("/adventures/{slug}")
async def get_adventure(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return adventure


@router.delete("/adventures/{slug}")
async def delete_adventure(slug: str):
    if not storage.delete_adventure(slug):
        raise HTTPException(404, "Adventure not found")
    return {"ok": True}


@router.get("/adventures/{slug}/messages")
async def get_messages(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_messages(slug)


def _resolve_connection(config: dict, role_name: str) -> dict | None:
    """Find the LLM connection assigned to a story role. Returns None if unassigned."""
    conn_name = config["story_roles"].get(role_name)
    if not conn_name:
        return None
    for conn in config["llm_connections"]:
        if conn["name"] == conn_name:
            return conn
    return None


# Role execution order — determines priority within each phase
_ROLE_ORDER = ["narrator", "character_writer", "extractor"]


@router.post("/adventures/{slug}/chat")
async def adventure_chat(slug: str, body: ChatBody):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")

    config = storage.get_config()
    story_roles = storage.get_story_roles(slug)
    history = storage.get_messages(slug)
    characters = storage.get_characters(slug)
    char_ctx = character_prompt_context(characters) if characters else None

    now = datetime.now(timezone.utc).isoformat()
    player_msg = {"role": "player", "text": body.message, "ts": now}
    new_messages = [player_msg]
    narration: str | None = None

    # Phase 1: on_player_message
    for role_name in _ROLE_ORDER:
        role_cfg = story_roles.get(role_name, {})
        if role_cfg.get("when") != "on_player_message":
            continue

        connection = _resolve_connection(config, role_name)
        if role_name == "narrator" and not connection:
            raise HTTPException(
                400, "Narrator role is not assigned — configure it in Settings"
            )
        if not connection:
            continue

        ctx = build_context(
            adventure, history, body.message,
            narration=narration, characters=char_ctx,
        )
        template_str = role_cfg.get("prompt", "")
        if not template_str:
            continue
        try:
            prompt = render_prompt(template_str, ctx)
        except PromptError as e:
            raise HTTPException(400, f"Prompt template error ({role_name}): {e}")

        text = await llm.generate(
            connection["provider_url"], connection.get("api_key", ""), prompt
        )
        msg = {"role": role_name, "text": text, "ts": now}
        new_messages.append(msg)
        if role_name == "narrator":
            narration = text

    # Phase 2: after_narration
    for role_name in _ROLE_ORDER:
        role_cfg = story_roles.get(role_name, {})
        if role_cfg.get("when") != "after_narration":
            continue

        connection = _resolve_connection(config, role_name)
        if not connection:
            continue

        ctx = build_context(
            adventure, history, body.message,
            narration=narration, characters=char_ctx,
        )
        template_str = role_cfg.get("prompt", "")
        if not template_str:
            continue
        try:
            prompt = render_prompt(template_str, ctx)
        except PromptError as e:
            raise HTTPException(400, f"Prompt template error ({role_name}): {e}")

        text = await llm.generate(
            connection["provider_url"], connection.get("api_key", ""), prompt
        )
        msg = {"role": role_name, "text": text, "ts": now}
        new_messages.append(msg)

    # Tick character states after pipeline phases
    if characters:
        for char in characters:
            tick_character(char)
        storage.save_characters(slug, characters)

    storage.append_messages(slug, new_messages)
    return {"messages": new_messages}


# ── Characters ────────────────────────────────────────────


@router.get("/adventures/{slug}/characters")
async def list_characters(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_characters(slug)


@router.post("/adventures/{slug}/characters", status_code=201)
async def create_character(slug: str, body: CreateCharacter):
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
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    char = storage.get_character(slug, cslug)
    if not char:
        raise HTTPException(404, "Character not found")
    return char


@router.patch("/adventures/{slug}/characters/{cslug}")
async def update_character(slug: str, cslug: str, body: UpdateCharacterStates):
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
    storage.save_characters(slug, characters)
    return found


@router.delete("/adventures/{slug}/characters/{cslug}")
async def delete_character(slug: str, cslug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    characters = storage.get_characters(slug)
    new_list = [c for c in characters if c["slug"] != cslug]
    if len(new_list) == len(characters):
        raise HTTPException(404, "Character not found")
    storage.save_characters(slug, new_list)
    return {"ok": True}


# ── Story Roles (per-adventure) ──────────────────────────


@router.get("/adventures/{slug}/story-roles")
async def get_story_roles(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_story_roles(slug)


@router.patch("/adventures/{slug}/story-roles")
async def update_story_roles(slug: str, body: dict):
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
    return {"name": storage.generate_adventure_name(title)}


# ── Settings ─────────────────────────────────────────────


@router.get("/settings")
async def get_settings():
    return storage.get_config()


@router.patch("/settings")
async def update_settings(body: dict):
    return storage.update_config(body)
