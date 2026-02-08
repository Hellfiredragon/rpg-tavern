"""Create demo adventures for development/testing."""

import shutil

from backend import storage

DEMO_ADVENTURES = [
    {
        "name": "The Cursed Tavern",
        "description": "A mysterious fog surrounds the old tavern at the crossroads. "
        "Locals whisper about cursed patrons who never left. "
        "Will you uncover the truth — or join them?",
    },
    {
        "name": "Dragon's Hollow",
        "description": "Deep in the mountain pass lies a village terrorized by a young dragon. "
        "The townsfolk need a hero — but things are not as simple as they seem.",
    },
    {
        "name": "The Lost Caravan",
        "description": "A merchant caravan vanished on the road between two cities. "
        "You've been hired to find the survivors and recover the cargo.",
    },
]


def create_demo_data() -> None:
    """Wipe existing adventures and create fresh demo data."""
    if storage.adventures_dir().exists():
        shutil.rmtree(storage.adventures_dir())
    storage.adventures_dir().mkdir(parents=True, exist_ok=True)

    for adv in DEMO_ADVENTURES:
        storage.create_adventure(adv["name"], adv["description"])
    print(f"Created {len(DEMO_ADVENTURES)} demo adventures.")
