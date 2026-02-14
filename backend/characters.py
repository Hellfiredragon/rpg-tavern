"""Character state logic — categories, thresholds, ticking, activation, and prompt context.

State categories (max slots / max value / tick rate per round):
  core       3 / 30 / +2  — rarely change, life crisis if challenged
  persistent 10 / 20 / +1 — current beliefs, relationships
  temporal   10 / -- / -1 — short-lived emotions (promotes to persistent at 20+)

Value thresholds control visibility in prompts:
  0-5   silent      — only extractor sees raw values
  6-10  subconscious — "feels a subconscious nudge related to {label}"
  11-15 manifest    — "{label} is manifest in their body language"
  16-20 dominant    — "{label} dominates their current priorities"
  21-30 definitive  — "{label} is a core truth they would die for"

Tick rules: values capped per category after tick; states at 0 removed;
temporal at 20+ promotes to persistent if slots available; overflow_pending
set if a category exceeds max slots.

Activation: name/nickname in narration → always active; else chattiness roll.

Prompt context: character_prompt_context() returns {"list": [...], "summary": "..."}.
enrich_states() builds per-state dicts with level flags for template use.
"""

import random

from backend.storage import slugify

CATEGORY_LIMITS = {"core": 3, "persistent": 10, "temporal": 10}

CATEGORY_MAX_VALUES = {"core": 30, "persistent": 20, "temporal": None}

TICK_RATES = {"core": 2, "persistent": 1, "temporal": -1}

# (min_value, max_value, template_string)  — max is inclusive
THRESHOLD_LEVELS = [
    (0, 5, None),  # silent
    (6, 10, "feels a subconscious nudge related to {label}"),
    (11, 15, "{label} is manifest in their body language"),
    (16, 20, "{label} dominates their current priorities"),
    (21, 30, "{label} is a core truth they would die for"),
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
        "nicknames": [],
        "chattiness": 50,
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }


def new_persona(name: str) -> dict:
    """Create a persona dict — like a character but with description instead of chattiness."""
    return {
        "name": name,
        "slug": slugify(name),
        "nicknames": [],
        "description": "",
        "states": {"core": [], "persistent": [], "temporal": []},
        "overflow_pending": False,
    }


def tick_character(character: dict) -> dict:
    """Apply tick rates, remove zeroed states, promote temporal->persistent, check overflow."""
    states = character["states"]

    for category in ("core", "persistent", "temporal"):
        rate = TICK_RATES[category]
        cap = CATEGORY_MAX_VALUES[category]
        new_list = []
        for state in states[category]:
            state["value"] = state["value"] + rate
            if cap is not None and state["value"] > cap:
                state["value"] = cap
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


def _state_level(value: int) -> str:
    """Return the threshold level name for a numeric value."""
    if value < 6:
        return "silent"
    if value <= 10:
        return "subconscious"
    if value <= 15:
        return "manifest"
    if value <= 20:
        return "dominant"
    return "definitive"


def enrich_states(character: dict, *, include_silent: bool = False) -> list[dict]:
    """Return state objects with level flags for Handlebars templates.

    Each object has: label, value, category, level, description,
    and boolean flags: is_silent, is_subconscious, is_manifest,
    is_dominant, is_definitive.

    When include_silent=False (default), states with value < 6 are omitted.
    """
    result = []
    for category in ("core", "persistent", "temporal"):
        for state in character["states"].get(category, []):
            value = state["value"]
            level = _state_level(value)
            if not include_silent and level == "silent":
                continue
            result.append({
                "label": state["label"],
                "value": value,
                "category": category,
                "level": level,
                "description": describe_state(state["label"], value) or "",
                "is_silent": level == "silent",
                "is_subconscious": level == "subconscious",
                "is_manifest": level == "manifest",
                "is_dominant": level == "dominant",
                "is_definitive": level == "definitive",
            })
    return result


def character_prompt_context(characters: list[dict]) -> dict:
    """Build Handlebars context for the chars object.

    Returns {"list": [...], "summary": "..."} where summary lists each
    character with their non-silent states described at threshold level.
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
            "nicknames": char.get("nicknames", []),
            "descriptions": char_descriptions,
        })

        if char_descriptions:
            joined = "; ".join(char_descriptions)
            summary_parts.append(f"{char['name']}: {joined}")
        else:
            summary_parts.append(f"{char['name']}: (no notable states)")

    return {
        "list": enriched,
        "summary": "\n".join(summary_parts),
    }


def activate_characters(
    characters: list[dict], narration: str, player_message: str
) -> list[dict]:
    """Determine which characters are active this turn.

    1. Name or nickname appears in narration or player message → always active
    2. Otherwise: random(0, 100) < chattiness → active
    """
    text = (narration + " " + player_message).lower()
    active = []
    for char in characters:
        names = [char["name"].lower()]
        names.extend(n.lower() for n in char.get("nicknames", []))
        if any(name in text for name in names):
            active.append(char)
        elif random.randint(0, 99) < char.get("chattiness", 50):
            active.append(char)
    return active
