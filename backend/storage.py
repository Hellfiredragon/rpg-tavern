"""File-based JSON storage for adventures and world state."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_data_dir: Path | None = None


def init_storage(data_dir: Path) -> None:
    global _data_dir
    _data_dir = data_dir
    _data_dir.mkdir(parents=True, exist_ok=True)
    adventures_dir().mkdir(exist_ok=True)


def data_dir() -> Path:
    assert _data_dir is not None, "Call init_storage() before using storage"
    return _data_dir


def adventures_dir() -> Path:
    return data_dir() / "adventures"


def list_adventures() -> list[dict[str, Any]]:
    results = []
    for path in sorted(adventures_dir().iterdir()):
        meta = path / "adventure.json"
        if meta.is_file():
            results.append(json.loads(meta.read_text()))
    return results


def get_adventure(adventure_id: str) -> dict[str, Any] | None:
    meta = adventures_dir() / adventure_id / "adventure.json"
    if not meta.is_file():
        return None
    return json.loads(meta.read_text())


def create_adventure(name: str, description: str = "") -> dict[str, Any]:
    adventure_id = uuid.uuid4().hex[:12]
    adventure = {
        "id": adventure_id,
        "name": name,
        "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    folder = adventures_dir() / adventure_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "adventure.json").write_text(json.dumps(adventure, indent=2))
    return adventure


def delete_adventure(adventure_id: str) -> bool:
    import shutil
    folder = adventures_dir() / adventure_id
    if not folder.is_dir():
        return False
    shutil.rmtree(folder)
    return True
