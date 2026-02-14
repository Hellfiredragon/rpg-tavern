"""Health check, settings, connection check, and name suggestion endpoints."""

from fastapi import APIRouter

from backend import storage

from .models import CheckConnectionBody

router = APIRouter()


@router.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


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


@router.get("/name-suggestion")
async def name_suggestion(title: str):
    """Generate a random adventure name for a template title."""
    return {"name": storage.generate_adventure_name(title)}


@router.get("/settings")
async def get_settings():
    """Get global app settings (connections, story role defaults, display, fonts)."""
    return storage.get_config()


@router.patch("/settings")
async def update_settings(body: dict):
    """Update global app settings (partial merge)."""
    return storage.update_config(body)
