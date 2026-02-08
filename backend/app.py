import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
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
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app


# Default app instance for uvicorn (uses DATA_DIR env var or default)
app = create_app()
