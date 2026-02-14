"""FastAPI API endpoints under /api.

Endpoint groups: templates, adventures, personas (global + per-adventure),
characters, lorebook, story-roles, chat (pipeline), settings, check-connection,
name-suggestion. Each adventure's child resources (characters, personas,
lorebook, story-roles, messages) are nested under /api/adventures/{slug}/.

Run scripts/routes.sh to print all routes with descriptions.
"""

from fastapi import APIRouter

from .adventures import router as adventures_router
from .characters import router as characters_router
from .lorebook import router as lorebook_router
from .personas import router as personas_router
from .settings import router as settings_router
from .story_roles import router as story_roles_router
from .templates import router as templates_router

router = APIRouter()
router.include_router(settings_router)
router.include_router(templates_router)
router.include_router(adventures_router)
router.include_router(characters_router)
router.include_router(personas_router)
router.include_router(lorebook_router)
router.include_router(story_roles_router)
