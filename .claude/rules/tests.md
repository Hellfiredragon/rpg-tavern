# Test Rules

> Load when: writing or modifying tests.


## Test Location

- Tests are colocated with the module they test: `test_<module>.py` in the same directory.
- Pipeline scenario tests live in `tests/pipeline/`.


## Helper Classes

- Reusable test helpers live in `tests/utils/`, one file per helper class.
- Name the file after the class: `tests/utils/stub_llm.py` → `StubLLM`.
- When a helper is used by more than one test file, it **must** live in `tests/utils/`. Do not duplicate helper classes across test files.
- Keep helpers minimal — they are test infrastructure, not production code. No logging, no config, no inheritance hierarchies.
- Shared constants that accompany a helper (e.g. `EXTRACTOR_EMPTY`, `LORE_EMPTY` alongside `StubLLM`) live in the same file as the helper they belong to.

### Current helpers

| File | Exports | Purpose |
|------|---------|---------|
| `tests/utils/stub_llm.py` | `StubLLM`, `EXTRACTOR_EMPTY`, `LORE_EMPTY` | Deterministic LLM stand-in for pipeline tests. Maps stage name → queued responses. |


## Writing Pipeline Scenario Tests

Follow the development philosophy in `CLAUDE.md`:

1. Design a concrete adventure scenario (location, characters, player inputs, expected outcomes).
2. Build a `StubLLM` with predetermined responses for every LLM stage the pipeline will call.
3. Assert the full message sequence, content, and world state mutations.
4. Call `stub.assert_exhausted()` at the end to catch missing or extra LLM calls.
