from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.routes import router

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="RPG Tavern")
app.include_router(router, prefix="/api")

# Serve frontend static files (built assets go here)
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
