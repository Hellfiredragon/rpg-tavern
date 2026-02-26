"""Pipeline test fixtures shared across scenario test modules.

The ``stream`` fixture is *file-aware*: it derives the resource filename
from the calling test module's stem, so ``test_medieval_tavern.py``
automatically loads ``tests/resources/medieval_tavern_stream.json``.

The ``storage`` fixture builds a fully-populated ``Storage`` from that
stream data (adventure meta, characters in JSON order, active persona).
It is intentionally generic — any pipeline scenario test that has a
matching resource file gets a working ``storage`` for free.

A test module that defines its own ``storage`` fixture (e.g.
``test_broken_compass.py``) overrides this one, so there is no conflict.
"""

import json
from pathlib import Path

import pytest

from rpg_tavern.models import Character, Persona
from rpg_tavern.storage import Storage

_RESOURCES = Path(__file__).resolve().parent.parent / "resources"


@pytest.fixture
def stream(request) -> dict:
    """Load the JSON resource file that matches the calling test module.

    ``test_medieval_tavern.py`` → ``medieval_tavern_stream.json``

    The resource file must contain at minimum:
      adventure.slug, adventure.title, adventure.setting
      player_name, active_persona, persona_description
      characters  (array, in intended NPC-activation order)
      messages
    """
    module_stem = Path(request.fspath).stem  # e.g. "test_medieval_tavern"
    resource_name = module_stem.removeprefix("test_") + "_stream.json"
    resource_path = _RESOURCES / resource_name
    with open(resource_path) as f:
        return json.load(f)


@pytest.fixture
def storage(tmp_path, stream) -> Storage:
    """Create an adventure populated from the stream resource.

    Characters are inserted in the order they appear in ``stream["characters"]``,
    which controls NPC activation order.
    """
    s = Storage(tmp_path)
    adventure = stream["adventure"]

    s.create_adventure(
        slug=adventure["slug"],
        title=adventure["title"],
        setting=adventure["setting"],
    )

    for char_data in stream["characters"]:
        s.save_character(
            adventure["slug"],
            Character(
                id=char_data["name"],
                name=char_data["name"],
                description=char_data["description"],
                chattiness=char_data["chattiness"],
                baked=char_data.get("baked", False),
                states=char_data.get(
                    "initial_state",
                    {"temporary": {}, "persistent": {}, "identity": {}},
                ),
            ),
        )

    s.save_persona(
        adventure["slug"],
        Persona(
            id=stream["active_persona"],
            name=stream["player_name"],
            description=stream["persona_description"],
        ),
    )

    return s
