"""Global app configuration (connections, story role defaults, display, fonts)."""

import json
from pathlib import Path
from typing import Any

from .core import data_dir

_CONFIG_DEFAULTS: dict[str, Any] = {
    "llm_connections": [],
    "story_roles": {
        "narrator": "",
        "character_intention": "",
        "extractor": "",
        "lorebook_extractor": "",
    },
    "app_width_percent": 100,
    "help_panel_width_percent": 25,
    "font_settings": {
        "narration":  {"family": "Crimson Text", "size": 18, "style": "normal"},
        "dialog":     {"family": "Crimson Text", "size": 18, "style": "normal"},
        "intention":  {"family": "Crimson Text", "size": 14, "style": "italic"},
        "heading":    {"family": "Cinzel",       "size": 18, "style": "normal"},
        "ui":         {"family": "Crimson Text", "size": 18, "style": "normal"},
    },
}


def _config_path() -> Path:
    return data_dir() / "config.json"


def get_config() -> dict[str, Any]:
    """Read config, returning defaults merged with stored values."""
    config: dict[str, Any] = {
        "llm_connections": list(_CONFIG_DEFAULTS["llm_connections"]),
        "story_roles": dict(_CONFIG_DEFAULTS["story_roles"]),
        "app_width_percent": _CONFIG_DEFAULTS["app_width_percent"],
        "help_panel_width_percent": _CONFIG_DEFAULTS["help_panel_width_percent"],
        "font_settings": json.loads(json.dumps(_CONFIG_DEFAULTS["font_settings"])),
    }
    path = _config_path()
    if path.is_file():
        stored = json.loads(path.read_text())
        if "llm_connections" in stored:
            config["llm_connections"] = stored["llm_connections"]
        if "story_roles" in stored:
            roles = stored["story_roles"]
            # Migrate: character_writer → character_intention
            if "character_writer" in roles and "character_intention" not in roles:
                roles["character_intention"] = roles.pop("character_writer")
            elif "character_writer" in roles:
                del roles["character_writer"]
            config["story_roles"].update(roles)
        if "app_width_percent" in stored:
            config["app_width_percent"] = stored["app_width_percent"]
        if "help_panel_width_percent" in stored:
            config["help_panel_width_percent"] = stored["help_panel_width_percent"]
        if "font_settings" in stored:
            for group, vals in stored["font_settings"].items():
                if group in config["font_settings"] and isinstance(vals, dict):
                    config["font_settings"][group].update(vals)
    return config


def update_config(fields: dict[str, Any]) -> dict[str, Any]:
    """Merge fields into config and persist. Returns full config."""
    config = get_config()
    if "llm_connections" in fields:
        config["llm_connections"] = fields["llm_connections"]
    if "story_roles" in fields:
        config["story_roles"].update(fields["story_roles"])
    if "app_width_percent" in fields:
        config["app_width_percent"] = fields["app_width_percent"]
    if "help_panel_width_percent" in fields:
        config["help_panel_width_percent"] = fields["help_panel_width_percent"]
    if "font_settings" in fields:
        for group, vals in fields["font_settings"].items():
            if group in config["font_settings"] and isinstance(vals, dict):
                config["font_settings"][group].update(vals)
    _config_path().write_text(json.dumps(config, indent=2))
    return config
