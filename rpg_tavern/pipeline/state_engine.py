"""Character / persona state engine.

Applies one extractor turn's symbolic operations (amplify / suppress /
overflow / evolution) to a state map.  No numeric values are ever shown to
the LLM — only the symbolic operation names are.

State map structure (input and output):
    {
        "temporary":  {"<state name>": <int 0–20>},
        "persistent": {"<state name>": <int 0–30>},
        "identity":   {"<state name>": <int 0–30>},
    }

Rules (from character_state.md):

    amplify existing state   +3, capped at 20
    amplify new state        create in temporary at 3 (no +3 on top)
    suppress existing state  −3, floored at 0; temporary removed if value == 0
    overflow (persistent)    +3, capped at 30; at 30 → promote to identity at 20
    evolution                rename the identity state created by overflow (only at 30)

Drift (non-mentioned states) is intentionally out of scope here — it is a
separate, lower-frequency operation applied between sessions.
"""

from __future__ import annotations

import copy

from rpg_tavern.models import ExtractorOutput

_AMPLIFY_DELTA = 3
_AMPLIFY_CAP = 20
_SUPPRESS_DELTA = 3
_OVERFLOW_DELTA = 3
_OVERFLOW_CAP = 30
_IDENTITY_START = 20  # value assigned when a persistent state promotes to identity


def apply_extraction(states: dict, output: ExtractorOutput) -> dict:
    """Return a new state map after applying *output* to *states*.

    The input is never mutated.
    """
    result: dict[str, dict[str, int]] = {
        "temporary":  dict(states.get("temporary", {})),
        "persistent": dict(states.get("persistent", {})),
        "identity":   dict(states.get("identity", {})),
    }

    # ── Amplify ──────────────────────────────────────────────────────────────
    for name in output.amplify:
        if name in result["temporary"]:
            result["temporary"][name] = min(
                result["temporary"][name] + _AMPLIFY_DELTA, _AMPLIFY_CAP
            )
        elif name in result["persistent"]:
            result["persistent"][name] = min(
                result["persistent"][name] + _AMPLIFY_DELTA, _AMPLIFY_CAP
            )
        elif name in result["identity"]:
            result["identity"][name] = min(
                result["identity"][name] + _AMPLIFY_DELTA, _AMPLIFY_CAP
            )
        else:
            # Brand-new state: create as temporary at 3 (no additional +3)
            result["temporary"][name] = 3

    # ── Suppress ─────────────────────────────────────────────────────────────
    for name in output.suppress:
        for category in ("temporary", "persistent", "identity"):
            if name in result[category]:
                new_val = max(result[category][name] - _SUPPRESS_DELTA, 0)
                if category == "temporary" and new_val == 0:
                    del result["temporary"][name]
                else:
                    result[category][name] = new_val
                break  # state exists in exactly one category

    # ── Overflow (persistent only) ────────────────────────────────────────────
    overflow = output.overflow
    if overflow and overflow in result["persistent"]:
        new_val = min(result["persistent"][overflow] + _OVERFLOW_DELTA, _OVERFLOW_CAP)
        if new_val >= _OVERFLOW_CAP:
            del result["persistent"][overflow]
            identity_name = output.evolution if output.evolution else overflow
            result["identity"][identity_name] = _IDENTITY_START
        else:
            result["persistent"][overflow] = new_val

    return result
