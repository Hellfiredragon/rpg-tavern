from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import llm, storage
from backend.characters import (
    CATEGORY_MAX_VALUES,
    activate_characters,
    character_prompt_context,
    new_character,
    tick_character,
)
from backend.lorebook import format_lorebook, match_lorebook_entries
from backend.prompts import PromptError, build_context, render_prompt

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


class ChatBody(BaseModel):
    message: str


class CreateCharacter(BaseModel):
    name: str


class UpdateCharacterStates(BaseModel):
    states: dict[str, list[dict]] | None = None
    nicknames: list[str] | None = None
    chattiness: int | None = None


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


def _apply_extractor_output(slug: str, text: str) -> None:
    """Parse extractor JSON output and apply state changes + lorebook entries.

    Best-effort: if JSON is invalid, log warning and continue.
    """
    import json
    import logging

    logger = logging.getLogger(__name__)

    # Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Remove first line (```json or ```) and last line (```)
        lines = [l for l in lines[1:] if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"Extractor output is not valid JSON: {e}")
        return

    if not isinstance(data, dict):
        return

    # Apply state changes
    state_changes = data.get("state_changes", [])
    if state_changes:
        characters = storage.get_characters(slug)
        char_by_name = {c["name"].lower(): c for c in characters}
        for change in state_changes:
            char_name = change.get("character", "").lower()
            char = char_by_name.get(char_name)
            if not char:
                continue
            for update in change.get("updates", []):
                category = update.get("category")
                if category not in ("core", "persistent", "temporal"):
                    continue
                label = update.get("label", "")
                value = update.get("value", 0)
                if not label or not isinstance(value, (int, float)):
                    continue
                value = int(value)
                cap = CATEGORY_MAX_VALUES.get(category)
                if cap is not None and value > cap:
                    value = cap
                # Update existing or add new
                found = False
                for state in char["states"][category]:
                    if state["label"].lower() == label.lower():
                        state["value"] = value
                        found = True
                        break
                if not found:
                    char["states"][category].append(
                        {"label": label, "value": value}
                    )
        storage.save_characters(slug, characters)

    # Apply lorebook entries
    new_entries = data.get("lorebook_entries", [])
    if new_entries:
        lorebook = storage.get_lorebook(slug)
        existing_titles = {e["title"].lower() for e in lorebook}
        for entry in new_entries:
            title = entry.get("title", "")
            if not title or title.lower() in existing_titles:
                continue
            lorebook.append({
                "title": title,
                "content": entry.get("content", ""),
                "keywords": entry.get("keywords", []),
            })
            existing_titles.add(title.lower())
        storage.save_lorebook(slug, lorebook)


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

    # Lorebook matching: scan player message + last 5 messages
    lorebook_all = storage.get_lorebook(slug)
    match_texts = [body.message]
    match_texts.extend(m["text"] for m in history[-5:])
    matched_entries = match_lorebook_entries(lorebook_all, match_texts)
    lorebook_str = format_lorebook(matched_entries)

    now = datetime.now(timezone.utc).isoformat()
    player_msg = {"role": "player", "text": body.message, "ts": now}
    new_messages = [player_msg]
    narration: str | None = None
    active_chars: list[dict] | None = None
    active_chars_summary: str | None = None

    def _build_ctx() -> dict:
        return build_context(
            adventure, history, body.message,
            narration=narration, characters=char_ctx,
            lorebook=lorebook_str if lorebook_str else None,
            lorebook_entries=matched_entries if matched_entries else None,
            active_characters=active_chars,
            active_characters_summary=active_chars_summary,
        )

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

        template_str = role_cfg.get("prompt", "")
        if not template_str:
            continue
        try:
            prompt = render_prompt(template_str, _build_ctx())
        except PromptError as e:
            raise HTTPException(400, f"Prompt template error ({role_name}): {e}")

        text = await llm.generate(
            connection["provider_url"], connection.get("api_key", ""), prompt
        )

        if role_name == "narrator":
            narration = text

        where = role_cfg.get("where", "chat")
        if where == "system":
            if role_name == "extractor":
                _apply_extractor_output(slug, text)
        else:
            msg = {"role": role_name, "text": text, "ts": now}
            new_messages.append(msg)

    # Character activation (after narration is available)
    if characters and narration:
        active_chars_raw = activate_characters(
            characters, narration, body.message
        )
        if active_chars_raw:
            ac_ctx = character_prompt_context(active_chars_raw)
            active_chars = ac_ctx.get("characters", [])
            active_chars_summary = ac_ctx.get("characters_summary", "")

    # Phase 2: after_narration
    for role_name in _ROLE_ORDER:
        role_cfg = story_roles.get(role_name, {})
        if role_cfg.get("when") != "after_narration":
            continue

        connection = _resolve_connection(config, role_name)
        if not connection:
            continue

        template_str = role_cfg.get("prompt", "")
        if not template_str:
            continue
        try:
            prompt = render_prompt(template_str, _build_ctx())
        except PromptError as e:
            raise HTTPException(400, f"Prompt template error ({role_name}): {e}")

        text = await llm.generate(
            connection["provider_url"], connection.get("api_key", ""), prompt
        )

        where = role_cfg.get("where", "chat")
        if where == "system":
            if role_name == "extractor":
                _apply_extractor_output(slug, text)
        else:
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
    if body.nicknames is not None:
        found["nicknames"] = body.nicknames
    if body.chattiness is not None:
        found["chattiness"] = max(0, min(100, body.chattiness))
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


# ── Lorebook ─────────────────────────────────────────────


class LorebookEntry(BaseModel):
    title: str
    content: str
    keywords: list[str]


@router.get("/adventures/{slug}/lorebook")
async def get_lorebook(slug: str):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    return storage.get_lorebook(slug)


@router.post("/adventures/{slug}/lorebook", status_code=201)
async def add_lorebook_entry(slug: str, body: LorebookEntry):
    adventure = storage.get_adventure(slug)
    if not adventure:
        raise HTTPException(404, "Adventure not found")
    entries = storage.get_lorebook(slug)
    entries.append(body.model_dump())
    storage.save_lorebook(slug, entries)
    return entries


@router.patch("/adventures/{slug}/lorebook/{index}")
async def update_lorebook_entry(slug: str, index: int, body: LorebookEntry):
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
