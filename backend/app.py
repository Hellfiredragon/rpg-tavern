import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.routes import router

load_dotenv(Path(__file__).parent.parent / ".env")

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="RPG Tavern")
app.include_router(router, prefix="/api")

# In production (no Vite dev server), serve built frontend assets
if STATIC_DIR.exists() and not os.getenv("VITE_DEV", ""):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
