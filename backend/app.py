import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.routes import router
from backend import storage

load_dotenv(Path(__file__).parent.parent / ".env")

STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_DATA_DIR = Path(__file__).parent.parent / "data"


def create_app(data_dir: Path | None = None) -> FastAPI:
    resolved = data_dir or Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
    storage.init_storage(resolved)

    app = FastAPI(title="RPG Tavern")
    app.include_router(router, prefix="/api")

    if STATIC_DIR.exists() and not os.getenv("VITE_DEV", ""):
        # Serve static assets (JS, CSS, etc.)
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

        # SPA fallback: all non-API routes serve index.html
        @app.get("/{path:path}")
        async def spa_fallback(path: str):
            return FileResponse(STATIC_DIR / "index.html")

    return app


# Default app instance for uvicorn (uses DATA_DIR env var or default)
app = create_app()
