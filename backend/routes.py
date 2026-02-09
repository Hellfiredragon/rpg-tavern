from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import llm, storage
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

        ctx = build_context(adventure, history, body.message, narration=narration)
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

        ctx = build_context(adventure, history, body.message, narration=narration)
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

    storage.append_messages(slug, new_messages)
    return {"messages": new_messages}


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
