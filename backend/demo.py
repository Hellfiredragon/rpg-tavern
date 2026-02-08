"""Create demo templates for development/testing."""

import shutil

from backend import storage

DEMO_TEMPLATES = [
    {
        "title": "Dragon's Hollow",
        "description": "Deep in the mountain pass lies a village terrorized by a young dragon. "
        "The townsfolk need a hero — but things are not as simple as they seem.",
    },
    {
        "title": "The Lost Caravan",
        "description": "A merchant caravan vanished on the road between two cities. "
        "You've been hired to find the survivors and recover the cargo.",
    },
]


def create_demo_data() -> None:
    """Wipe existing templates/adventures and create fresh demo data."""
    if storage.templates_dir().exists():
        shutil.rmtree(storage.templates_dir())
    if storage.adventures_dir().exists():
        shutil.rmtree(storage.adventures_dir())
    storage.templates_dir().mkdir(parents=True, exist_ok=True)
    storage.adventures_dir().mkdir(parents=True, exist_ok=True)

    for tmpl in DEMO_TEMPLATES:
        storage.create_template(tmpl["title"], tmpl["description"])
    print(f"Created {len(DEMO_TEMPLATES)} demo templates.")
