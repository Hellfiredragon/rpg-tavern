"""Create demo templates for development/testing."""

import json
import shutil
from datetime import datetime, timezone

from backend import storage
from backend.characters import new_character

DEMO_TEMPLATES = [
    {
        "title": "Dragon's Hollow",
        "description": "Deep in the mountain pass lies a village terrorized by a young dragon. "
        "The townsfolk need a hero — but things are not as simple as they seem.",
        "intro": "You stand at the edge of Dragon's Hollow as dusk settles over the "
        "mountain pass. Smoke curls from a handful of chimneys, but half the "
        "village lies in charred ruins. The townsfolk eye you warily from behind "
        "shuttered windows. A weathered signpost reads: 'Welcome to Dragon's "
        "Hollow — Population: Declining.'",
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
        t = storage.create_template(tmpl["title"], tmpl["description"])
        if "intro" in tmpl:
            storage.update_template(t["slug"], {"intro": tmpl["intro"]})

    # Embark a demo adventure so story roles are visible out of the box
    adventure = storage.embark_template("dragons-hollow", "Dragon's Hollow Demo Run")

    # Add demo characters with sample states, nicknames, and chattiness
    gareth = new_character("Gareth")
    gareth["nicknames"] = ["Captain", "Cap"]
    gareth["chattiness"] = 70
    gareth["states"]["core"] = [{"label": "Loyal to the King", "value": 18}]
    gareth["states"]["persistent"] = [
        {"label": "Loves Elena", "value": 12},
        {"label": "Grumpy", "value": 8},
    ]
    gareth["states"]["temporal"] = [{"label": "Angry", "value": 4}]

    elena = new_character("Elena")
    elena["nicknames"] = ["Lena", "The Healer"]
    elena["chattiness"] = 60
    elena["states"]["persistent"] = [
        {"label": "Healer's oath", "value": 14},
        {"label": "Curious about the dragon", "value": 9},
    ]
    elena["states"]["temporal"] = [{"label": "Worried about Gareth", "value": 7}]

    thrak = new_character("Thrak")
    thrak["nicknames"] = ["The Brute"]
    thrak["chattiness"] = 30
    thrak["states"]["core"] = [{"label": "Survival instinct", "value": 19}]
    thrak["states"]["temporal"] = [
        {"label": "Hungry", "value": 6},
        {"label": "Suspicious of strangers", "value": 11},
    ]

    storage.save_characters(adventure["slug"], [gareth, elena, thrak])

    # Add demo lorebook entries
    lorebook_entries = [
        {
            "title": "Fafnir the Dragon",
            "content": "A young mountain dragon, barely a century old. Fafnir was driven from "
            "his mother's lair and claimed Dragon's Hollow as his territory. He is more "
            "frightened than fearsome, but his fire breath has already destroyed half the village.",
            "keywords": ["fafnir", "dragon", "mountain"],
        },
        {
            "title": "Dragon's Hollow Village",
            "content": "A small mining village nestled in a mountain pass. Once prosperous from "
            "iron ore trade, now half-ruined by dragon attacks. The remaining villagers are "
            "desperate but resourceful.",
            "keywords": ["village", "hollow", "mining", "iron"],
        },
        {
            "title": "The Dragonbane Amulet",
            "content": "An ancient artifact rumored to be hidden in the old mine shafts beneath "
            "the village. Said to grant protection against dragonfire. The village elder "
            "mentions it only in whispers.",
            "keywords": ["amulet", "dragonbane", "artifact", "mine"],
        },
    ]
    storage.save_lorebook(adventure["slug"], lorebook_entries)

    # Add demo messages with segment format
    now = datetime.now(timezone.utc).isoformat()
    demo_messages = [
        {
            "role": "player",
            "text": "I approach the village elder",
            "ts": now,
        },
        {
            "role": "narrator",
            "text": "The elder rises from his bench, eyes narrowing.\n"
            "Gareth(stern): Another adventurer? We've had enough of those.\n"
            "Elena(hopeful): Wait, Gareth. Maybe this one can help.",
            "segments": [
                {"type": "narration", "text": "The elder rises from his bench, eyes narrowing."},
                {"type": "dialog", "character": "Gareth", "emotion": "stern", "text": "Another adventurer? We've had enough of those."},
                {"type": "dialog", "character": "Elena", "emotion": "hopeful", "text": "Wait, Gareth. Maybe this one can help."},
            ],
            "ts": now,
        },
    ]
    storage.append_messages(adventure["slug"], demo_messages)

    print(f"Created {len(DEMO_TEMPLATES)} demo templates + 1 demo adventure + 3 characters + 3 lorebook entries + demo messages.")
