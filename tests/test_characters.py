from backend.characters import (
    activate_characters,
    character_prompt_context,
    describe_state,
    enrich_states,
    new_character,
    tick_character,
)


# ── describe_state ──────────────────────────────────────────


def test_describe_state_silent():
    assert describe_state("Angry", 3) is None
    assert describe_state("Angry", 5) is None


def test_describe_state_subconscious():
    result = describe_state("Angry", 6)
    assert result == "feels a subconscious nudge related to Angry"
    assert describe_state("Angry", 10) is not None


def test_describe_state_manifest():
    result = describe_state("Loyal", 11)
    assert result == "Loyal is manifest in their body language"
    assert describe_state("Loyal", 15) is not None


def test_describe_state_dominant():
    result = describe_state("Loves Elena", 16)
    assert result == "Loves Elena dominates their current priorities"
    assert describe_state("Loves Elena", 20) is not None


def test_describe_state_definitive():
    result = describe_state("Rage", 21)
    assert result == "Rage is a core truth they would die for"
    assert describe_state("Rage", 30) is not None


# ── new_character ───────────────────────────────────────────


def test_new_character_structure():
    char = new_character("Gareth the Bold")
    assert char["name"] == "Gareth the Bold"
    assert char["slug"] == "gareth-the-bold"
    assert char["nicknames"] == []
    assert char["chattiness"] == 50
    assert char["states"] == {"core": [], "persistent": [], "temporal": []}
    assert char["overflow_pending"] is False


# ── tick_character ──────────────────────────────────────────


def test_tick_applies_rates():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [{"label": "Loyal", "value": 10}],
            "persistent": [{"label": "Grumpy", "value": 10}],
            "temporal": [{"label": "Angry", "value": 10}],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert char["states"]["core"][0]["value"] == 12  # +2
    assert char["states"]["persistent"][0]["value"] == 11  # +1
    assert char["states"]["temporal"][0]["value"] == 9  # -1


def test_tick_caps_core_at_30():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [{"label": "Loyal", "value": 29}],
            "persistent": [],
            "temporal": [],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert char["states"]["core"][0]["value"] == 30  # 29+2=31, capped to 30


def test_tick_caps_persistent_at_20():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [],
            "persistent": [{"label": "Grumpy", "value": 20}],
            "temporal": [],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert char["states"]["persistent"][0]["value"] == 20  # 20+1=21, capped to 20


def test_tick_removes_zeroed_states():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [],
            "persistent": [],
            "temporal": [{"label": "Fleeting", "value": 1}],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert len(char["states"]["temporal"]) == 0


def test_tick_promotes_temporal_to_persistent():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [],
            "persistent": [],
            "temporal": [{"label": "Growing", "value": 21}],  # after -1 tick = 20
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert len(char["states"]["temporal"]) == 0
    assert len(char["states"]["persistent"]) == 1
    assert char["states"]["persistent"][0]["label"] == "Growing"
    assert char["states"]["persistent"][0]["value"] == 20


def test_tick_overflow_when_exceeding_limit():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [
                {"label": "A", "value": 10},
                {"label": "B", "value": 10},
                {"label": "C", "value": 10},
                {"label": "D", "value": 10},  # 4 > limit of 3
            ],
            "persistent": [],
            "temporal": [],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert char["overflow_pending"] is True


def test_tick_no_overflow_within_limits():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [{"label": "A", "value": 10}],
            "persistent": [],
            "temporal": [],
        },
        "overflow_pending": False,
    }
    tick_character(char)
    assert char["overflow_pending"] is False


# ── character_prompt_context ────────────────────────────────


def test_prompt_context_builds_summary():
    chars = [
        {
            "name": "Gareth",
            "slug": "gareth",
            "states": {
                "core": [{"label": "Loyal", "value": 18}],
                "persistent": [{"label": "Grumpy", "value": 8}],
                "temporal": [{"label": "Sleepy", "value": 3}],
            },
            "overflow_pending": False,
        }
    ]
    ctx = character_prompt_context(chars)
    assert len(ctx["list"]) == 1
    assert ctx["list"][0]["name"] == "Gareth"
    # Silent state (Sleepy=3) should not appear in descriptions
    descs = ctx["list"][0]["descriptions"]
    assert any("Loyal" in d for d in descs)
    assert any("Grumpy" in d for d in descs)
    assert not any("Sleepy" in d for d in descs)
    # Summary includes non-silent
    assert "Gareth" in ctx["summary"]
    assert "Loyal" in ctx["summary"]


def test_prompt_context_empty_characters():
    ctx = character_prompt_context([])
    assert ctx["list"] == []
    assert ctx["summary"] == ""


def test_prompt_context_includes_nicknames():
    chars = [
        {
            "name": "Gareth",
            "slug": "gareth",
            "nicknames": ["Cap", "Captain"],
            "states": {"core": [], "persistent": [], "temporal": []},
            "overflow_pending": False,
        }
    ]
    ctx = character_prompt_context(chars)
    assert ctx["list"][0]["nicknames"] == ["Cap", "Captain"]


# ── activate_characters ───────────────────────────────────────


def test_activate_by_name():
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 0},
    ]
    active = activate_characters(chars, "Gareth draws his sword.", "I attack")
    assert len(active) == 1
    assert active[0]["name"] == "Gareth"


def test_activate_by_nickname():
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": ["Cap"], "chattiness": 0},
    ]
    active = activate_characters(chars, "Cap steps forward.", "I look around")
    assert len(active) == 1


def test_activate_by_player_message():
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 0},
    ]
    active = activate_characters(chars, "The wind blows.", "I talk to Gareth")
    assert len(active) == 1


def test_activate_name_case_insensitive():
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 0},
    ]
    active = activate_characters(chars, "GARETH looks up.", "I wait")
    assert len(active) == 1


def test_activate_by_chattiness_100():
    """Chattiness 100 should always activate (random < 100 is always true for 0-100)."""
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 100},
    ]
    # Run 10 times — should always activate
    for _ in range(10):
        active = activate_characters(chars, "Nothing happens.", "I wait")
        assert len(active) == 1


def test_activate_by_chattiness_0():
    """Chattiness 0 should never activate by random (only by name mention)."""
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 0},
    ]
    active = activate_characters(chars, "Nothing happens.", "I wait")
    assert len(active) == 0


def test_activate_mixed():
    """Name-mentioned always active, chattiness-0 inactive, chattiness-100 always."""
    chars = [
        {"name": "Gareth", "slug": "gareth", "nicknames": [], "chattiness": 0},
        {"name": "Elena", "slug": "elena", "nicknames": [], "chattiness": 100},
        {"name": "Thrak", "slug": "thrak", "nicknames": [], "chattiness": 0},
    ]
    active = activate_characters(chars, "Gareth nods.", "I look around")
    names = [c["name"] for c in active]
    assert "Gareth" in names
    assert "Elena" in names
    assert "Thrak" not in names


# ── enrich_states ────────────────────────────────────────────


def test_enrich_states_hides_silent_by_default():
    char = {
        "name": "Gareth",
        "slug": "gareth",
        "states": {
            "core": [{"label": "Loyal", "value": 18}],
            "persistent": [{"label": "Grumpy", "value": 8}],
            "temporal": [{"label": "Sleepy", "value": 3}],  # silent
        },
    }
    states = enrich_states(char)
    labels = [s["label"] for s in states]
    assert "Loyal" in labels
    assert "Grumpy" in labels
    assert "Sleepy" not in labels


def test_enrich_states_include_silent():
    char = {
        "name": "Gareth",
        "slug": "gareth",
        "states": {
            "core": [{"label": "Loyal", "value": 18}],
            "persistent": [],
            "temporal": [{"label": "Sleepy", "value": 3}],
        },
    }
    states = enrich_states(char, include_silent=True)
    labels = [s["label"] for s in states]
    assert "Loyal" in labels
    assert "Sleepy" in labels
    sleepy = [s for s in states if s["label"] == "Sleepy"][0]
    assert sleepy["is_silent"] is True
    assert sleepy["level"] == "silent"


def test_enrich_states_level_flags():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [{"label": "A", "value": 8}, {"label": "B", "value": 12}],
            "persistent": [{"label": "C", "value": 18}],
            "temporal": [{"label": "D", "value": 25}],
        },
    }
    states = enrich_states(char)
    by_label = {s["label"]: s for s in states}
    assert by_label["A"]["level"] == "subconscious"
    assert by_label["A"]["is_subconscious"] is True
    assert by_label["B"]["level"] == "manifest"
    assert by_label["B"]["is_manifest"] is True
    assert by_label["C"]["level"] == "dominant"
    assert by_label["C"]["is_dominant"] is True
    assert by_label["D"]["level"] == "definitive"
    assert by_label["D"]["is_definitive"] is True


def test_enrich_states_has_category_and_description():
    char = {
        "name": "Test",
        "slug": "test",
        "states": {
            "core": [],
            "persistent": [{"label": "Grumpy", "value": 8}],
            "temporal": [],
        },
    }
    states = enrich_states(char)
    assert len(states) == 1
    assert states[0]["category"] == "persistent"
    assert states[0]["description"] != ""
    assert "Grumpy" in states[0]["description"]


def test_enrich_states_empty():
    char = {
        "name": "Elena",
        "slug": "elena",
        "states": {"core": [], "persistent": [], "temporal": []},
    }
    assert enrich_states(char) == []
    assert enrich_states(char, include_silent=True) == []
