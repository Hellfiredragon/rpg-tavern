"""Character state logic — categories, thresholds, ticking, and prompt context."""

from backend.storage import slugify

CATEGORY_LIMITS = {"core": 3, "persistent": 10, "temporal": 10}

TICK_RATES = {"core": 2, "persistent": 1, "temporal": -1}

# (min_value, max_value, template_string)  — max is inclusive
THRESHOLD_LEVELS = [
    (0, 5, None),  # silent
    (6, 10, "feels an urge related to {label}"),
    (11, 16, "{label} drives their actions"),
    (17, 20, "{label} is very important to them"),
    (21, None, "{label} is their absolute focus"),
]


def describe_state(label: str, value: int) -> str | None:
    """Return a threshold description for a state, or None if silent (<6)."""
    for min_v, max_v, template in THRESHOLD_LEVELS:
        if max_v is None:
            if value >= min_v:
                return template.format(label=label)
        elif min_v <= value <= max_v:
            if template is None:
                return None
            return template.format(label=label)
    return None


def new_character(name: str) -> dict:
    """Create a character dict with slug, empty state lists, overflow_pending=False."""
    return {
        "name": name,
        "slug": slugify(name),
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }


def tick_character(character: dict) -> dict:
    """Apply tick rates, remove zeroed states, promote temporal->persistent, check overflow."""
    states = character["states"]

    for category in ("core", "persistent", "temporal"):
        rate = TICK_RATES[category]
        new_list = []
        for state in states[category]:
            state["value"] = state["value"] + rate
            if state["value"] > 0:
                new_list.append(state)
        states[category] = new_list

    # Promote temporal states reaching value 20+ to persistent
    remaining_temporal = []
    for state in states["temporal"]:
        if state["value"] >= 20 and len(states["persistent"]) < CATEGORY_LIMITS["persistent"]:
            states["persistent"].append(state)
        else:
            remaining_temporal.append(state)
    states["temporal"] = remaining_temporal

    # Check overflow
    overflow = False
    for category, limit in CATEGORY_LIMITS.items():
        if len(states[category]) > limit:
            overflow = True
            break
    character["overflow_pending"] = overflow

    return character


def character_prompt_context(characters: list[dict]) -> dict:
    """Build Handlebars context for characters.

    Returns {"characters": [...], "characters_summary": "..."} where summary
    lists each character with their non-silent states described at threshold level.
    """
    enriched = []
    summary_parts: list[str] = []

    for char in characters:
        char_descriptions: list[str] = []
        for category in ("core", "persistent", "temporal"):
            for state in char["states"].get(category, []):
                desc = describe_state(state["label"], state["value"])
                if desc is not None:
                    char_descriptions.append(desc)

        enriched.append({
            "name": char["name"],
            "slug": char["slug"],
            "descriptions": char_descriptions,
        })

        if char_descriptions:
            joined = "; ".join(char_descriptions)
            summary_parts.append(f"{char['name']}: {joined}")
        else:
            summary_parts.append(f"{char['name']}: (no notable states)")

    return {
        "characters": enriched,
        "characters_summary": "\n".join(summary_parts),
    }
