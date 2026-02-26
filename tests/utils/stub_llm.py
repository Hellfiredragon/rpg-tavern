"""Deterministic LLM stand-in for pipeline tests.

Provide a dict mapping stage name → list of responses (in call order).
Raises if a stage is called more times than responses were provided.
"""

import json


class StubLLM:
    def __init__(self, responses: dict[str, list[str]]) -> None:
        self._queues: dict[str, list[str]] = {k: list(v) for k, v in responses.items()}
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, stage: str, prompt: str) -> str:
        self.calls.append((stage, prompt))
        queue = self._queues.get(stage)
        if not queue:
            raise AssertionError(
                f"StubLLM: unexpected call to stage={stage!r} "
                f"(no responses queued). calls so far: {self.calls}"
            )
        return queue.pop(0)

    def assert_exhausted(self) -> None:
        """Assert every queued response was consumed — catches missing LLM calls."""
        leftover = {k: v for k, v in self._queues.items() if v}
        if leftover:
            stages = ", ".join(f"{k}({len(v)})" for k, v in leftover.items())
            raise AssertionError(f"StubLLM: unused responses remain: {stages}")


EXTRACTOR_EMPTY = json.dumps({"state_changes": []})
LORE_EMPTY = json.dumps({"entries": []})
