"""Intention/resolution chat pipeline.

Executes the full turn loop for one player message:
  1. Resolve player intention — narrator LLM produces narration + dialog segments.
  2. Character extractor — update states for each character named in the narration.
  3. Persona extractor — same for the active player persona if named.
  4. Round loop (up to max_rounds, default 3):
     a. Activate characters (name/nickname match always; otherwise chattiness roll).
     b. Each active character generates an intention (character_intention role).
     c. Narrator resolves the intention into new segments.
     d. Character extractor updates that character's states.
     e. Persona extractor runs if persona named in round narration.
  5. Lorebook extractor — extract new world facts from all narrations.
  6. Tick all character + persona states, combine segments into one narrator message.

Story roles (4, each with a Handlebars prompt template + LLM connection):
  narrator            — resolves intentions into narration + dialog
  character_intention — generates what a character wants to do
  extractor           — updates character/persona states after each resolution
  lorebook_extractor  — extracts new world facts once per turn

Connection resolution: per-adventure story-roles.json connection field first,
then global config.json story_roles mapping, then None (role skipped).

Narrator output format (parsed by parse_narrator_output):
  Narration text.
  CharacterName(emotion): Dialog text.

Message format: {"role": "narrator", "text": "...", "segments": [...]}
  Segments: {"type": "narration"|"dialog", "text": "...", "character"?, "emotion"?}
  Intention messages (sandbox only): {"role": "intention", "character": "...", "text": "..."}
"""

from backend import llm  # noqa: F401 — keep for mock path compatibility

from .core import run_pipeline  # noqa: F401
from .extractors import (  # noqa: F401
    apply_character_extractor,
    apply_lorebook_extractor,
    apply_persona_extractor,
)
from .segments import (  # noqa: F401
    Segment,
    parse_narrator_output,
    segments_to_text,
)
