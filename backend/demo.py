"""Create demo templates for development/testing."""

import shutil

from backend import storage
from backend.characters import new_character

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

    # Embark a demo adventure so story roles are visible out of the box
    adventure = storage.embark_template("dragons-hollow", "Dragon's Hollow Demo Run")

    # Add demo characters with sample states
    gareth = new_character("Gareth")
    gareth["states"]["core"] = [{"label": "Loyal to the King", "value": 18}]
    gareth["states"]["persistent"] = [
        {"label": "Loves Elena", "value": 12},
        {"label": "Grumpy", "value": 8},
    ]
    gareth["states"]["temporal"] = [{"label": "Angry", "value": 4}]

    elena = new_character("Elena")
    elena["states"]["persistent"] = [
        {"label": "Healer's oath", "value": 14},
        {"label": "Curious about the dragon", "value": 9},
    ]
    elena["states"]["temporal"] = [{"label": "Worried about Gareth", "value": 7}]

    thrak = new_character("Thrak")
    thrak["states"]["core"] = [{"label": "Survival instinct", "value": 19}]
    thrak["states"]["temporal"] = [
        {"label": "Hungry", "value": 6},
        {"label": "Suspicious of strangers", "value": 11},
    ]

    storage.save_characters(adventure["slug"], [gareth, elena, thrak])

    print(f"Created {len(DEMO_TEMPLATES)} demo templates + 1 demo adventure + 3 demo characters.")
