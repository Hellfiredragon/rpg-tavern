from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import llm, storage

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


def _build_prompt(description: str, history: list[dict], new_intent: str) -> str:
    """Build a text-adventure prompt from description + history + new intent."""
    parts = [description, ""]
    for msg in history:
        if msg["role"] == "player":
            parts.append(f"> {msg['text']}")
        else:
            parts.append(msg["text"])
        parts.append("")
    parts.append(f"> {new_intent}")
    parts.append("")
    return "\n".join(parts)


@router.post("/adventures/{slug}/chat")
async def adventure_chat(slug: str, body: ChatBody):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")

    config = storage.get_config()
    narrator_conn_name = config["story_roles"].get("narrator")
    if not narrator_conn_name:
        raise HTTPException(400, "Narrator role is not assigned — configure it in Settings")

    connection = None
    for conn in config["llm_connections"]:
        if conn["name"] == narrator_conn_name:
            connection = conn
            break
    if not connection:
        raise HTTPException(400, f"Connection '{narrator_conn_name}' not found")

    history = storage.get_messages(slug)
    prompt = _build_prompt(adventure["description"], history, body.message)
    text = await llm.generate(connection["provider_url"], connection.get("api_key", ""), prompt)

    now = datetime.now(timezone.utc).isoformat()
    player_msg = {"role": "player", "text": body.message, "ts": now}
    narrator_msg = {"role": "narrator", "text": text, "ts": now}
    storage.append_messages(slug, [player_msg, narrator_msg])

    return {"messages": [player_msg, narrator_msg]}


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
