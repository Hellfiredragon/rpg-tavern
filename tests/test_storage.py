import pytest

from backend import storage


# ── Slugify ──────────────────────────────────────────────────


def test_slugify_basic():
    assert storage.slugify("Hello World") == "hello-world"


def test_slugify_apostrophe():
    assert storage.slugify("Dragon's Hollow") == "dragons-hollow"


def test_slugify_unicode():
    assert storage.slugify("Café Münch") == "cafe-munch"


def test_slugify_empty():
    assert storage.slugify("") == "untitled"


# ── Templates: Create & List ────────────────────────────────


def test_create_and_list_template():
    tmpl = storage.create_template("Test Quest", "A test template")
    assert tmpl["title"] == "Test Quest"
    assert tmpl["slug"] == "test-quest"
    assert tmpl["source"] == "user"

    templates = storage.list_templates()
    slugs = [t["slug"] for t in templates]
    assert "test-quest" in slugs


def test_create_template_collision():
    storage.create_template("Test Quest")
    with pytest.raises(FileExistsError):
        storage.create_template("Test Quest")


def test_create_template_preset_collision():
    """Cannot create a template whose slug collides with a preset."""
    with pytest.raises(FileExistsError):
        storage.create_template("The Cursed Tavern")


# ── Templates: Preset merging ───────────────────────────────


def test_list_includes_preset():
    """Preset templates appear in listing."""
    templates = storage.list_templates()
    slugs = [t["slug"] for t in templates]
    assert "the-cursed-tavern" in slugs


def test_preset_source_field():
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl is not None
    assert tmpl["source"] == "preset"


def test_user_override_wins():
    """A user template with same slug overrides the preset."""
    # Copy-on-write: update the preset to create user copy
    storage.update_template("the-cursed-tavern", {"description": "Overridden"})
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl["source"] == "user"
    assert tmpl["description"] == "Overridden"


def test_delete_reveals_preset():
    """Deleting user override reveals the preset underneath."""
    storage.update_template("the-cursed-tavern", {"description": "Overridden"})
    assert storage.get_template("the-cursed-tavern")["source"] == "user"
    storage.delete_template("the-cursed-tavern")
    tmpl = storage.get_template("the-cursed-tavern")
    assert tmpl is not None
    assert tmpl["source"] == "preset"


# ── Templates: Get ──────────────────────────────────────────


def test_get_template():
    tmpl = storage.create_template("Quest")
    result = storage.get_template(tmpl["slug"])
    assert result is not None
    assert result["title"] == "Quest"


def test_get_template_missing():
    assert storage.get_template("nonexistent") is None


# ── Templates: Update ───────────────────────────────────────


def test_update_template():
    storage.create_template("Old Name")
    updated = storage.update_template("old-name", {"title": "New Name"})
    assert updated is not None
    assert updated["title"] == "New Name"
    assert updated["slug"] == "new-name"
    assert storage.get_template("old-name") is None
    assert storage.get_template("new-name") is not None


def test_update_description_no_rename():
    storage.create_template("Quest")
    updated = storage.update_template("quest", {"description": "Updated"})
    assert updated["description"] == "Updated"
    assert updated["slug"] == "quest"


def test_update_ignores_unknown_fields():
    storage.create_template("Quest")
    updated = storage.update_template("quest", {"title": "Quest", "slug": "hacked"})
    assert updated["slug"] == "quest"


def test_update_title_collision():
    storage.create_template("Alpha")
    storage.create_template("Beta")
    with pytest.raises(FileExistsError):
        storage.update_template("beta", {"title": "Alpha"})


def test_update_missing():
    assert storage.update_template("nope", {"title": "X"}) is None


def test_copy_on_write_update():
    """Updating a preset template copies it to data first."""
    updated = storage.update_template(
        "the-cursed-tavern", {"description": "Modified"}
    )
    assert updated["source"] == "user"
    assert updated["description"] == "Modified"
    # User file exists
    assert (storage.templates_dir() / "the-cursed-tavern.json").is_file()


# ── Templates: Delete ───────────────────────────────────────


def test_delete_template():
    storage.create_template("Doomed")
    assert storage.delete_template("doomed") is True
    assert storage.get_template("doomed") is None


def test_delete_template_missing():
    assert storage.delete_template("nope") is False


# ── Embark ───────────────────────────────────────────────────


def test_embark_template():
    storage.create_template("Quest", "A great quest")
    adventure = storage.embark_template("quest", "My Adventure")
    assert adventure is not None
    assert adventure["title"] == "My Adventure"
    assert adventure["slug"] == "my-adventure"
    assert adventure["template_slug"] == "quest"
    assert adventure["description"] == "A great quest"


def test_embark_slug_collision():
    storage.create_template("Quest", "Desc")
    storage.embark_template("quest", "Run")
    r2 = storage.embark_template("quest", "Run")
    assert r2["slug"] == "run-2"


def test_embark_missing():
    assert storage.embark_template("nope", "Title") is None


def test_embark_preset():
    """Can embark directly from a preset template."""
    adventure = storage.embark_template("the-cursed-tavern", "My Tavern Run")
    assert adventure is not None
    assert adventure["template_slug"] == "the-cursed-tavern"


# ── Adventures ───────────────────────────────────────────────


def test_list_adventures_empty():
    assert storage.list_adventures() == []


def test_adventure_lifecycle():
    storage.create_template("Quest", "Desc")
    adv = storage.embark_template("quest", "My Run")
    adventures = storage.list_adventures()
    assert len(adventures) == 1
    assert adventures[0]["slug"] == adv["slug"]

    got = storage.get_adventure(adv["slug"])
    assert got["title"] == "My Run"

    assert storage.delete_adventure(adv["slug"]) is True
    assert storage.list_adventures() == []


def test_get_adventure_missing():
    assert storage.get_adventure("nonexistent") is None


def test_delete_adventure_missing():
    assert storage.delete_adventure("nope") is False


# ── Name generation ──────────────────────────────────────────


def test_generate_adventure_name():
    name = storage.generate_adventure_name("The Cursed Tavern")
    assert name.startswith("The Cursed Tavern in the ")


# ── Config ───────────────────────────────────────────────────


def test_get_config_empty():
    """Returns defaults when no config file exists."""
    config = storage.get_config()
    assert config["llm_connections"] == []
    assert config["story_roles"] == {
        "narrator": "",
        "character_writer": "",
        "extractor": "",
    }
    assert config["app_width_percent"] == 100


def test_update_config_connections():
    """Adding connections replaces the array and persists."""
    conns = [
        {
            "name": "My OpenAI",
            "provider_url": "https://api.openai.com/v1",
            "api_key": "sk-test",
            "model": "gpt-4o",
            "completion_mode": "chat",
        }
    ]
    result = storage.update_config({"llm_connections": conns})
    assert len(result["llm_connections"]) == 1
    assert result["llm_connections"][0]["name"] == "My OpenAI"

    reloaded = storage.get_config()
    assert reloaded["llm_connections"][0]["model"] == "gpt-4o"


def test_update_config_roles():
    """Partial role update preserves other roles."""
    storage.update_config({"story_roles": {"narrator": "My OpenAI"}})
    storage.update_config({"story_roles": {"extractor": "Local LLM"}})

    config = storage.get_config()
    assert config["story_roles"]["narrator"] == "My OpenAI"
    assert config["story_roles"]["extractor"] == "Local LLM"
    assert config["story_roles"]["character_writer"] == ""  # untouched


def test_update_config_partial():
    """Scalar and roles updates are independent."""
    storage.update_config({"story_roles": {"narrator": "X"}})
    storage.update_config({"app_width_percent": 75})

    config = storage.get_config()
    assert config["story_roles"]["narrator"] == "X"
    assert config["app_width_percent"] == 75
    assert config["llm_connections"] == []  # untouched default


def test_update_config_replaces_connections_array():
    """Sending a new connections array fully replaces the old one."""
    storage.update_config({"llm_connections": [
        {"name": "A", "provider_url": "", "api_key": "", "model": "", "completion_mode": "chat"},
        {"name": "B", "provider_url": "", "api_key": "", "model": "", "completion_mode": "chat"},
    ]})
    storage.update_config({"llm_connections": [
        {"name": "C", "provider_url": "", "api_key": "", "model": "", "completion_mode": "chat"},
    ]})

    config = storage.get_config()
    assert len(config["llm_connections"]) == 1
    assert config["llm_connections"][0]["name"] == "C"
