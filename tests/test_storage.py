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


# ── Create & List ────────────────────────────────────────────


def test_create_and_list():
    adv = storage.create_adventure("Test Quest", "A test adventure")
    assert adv["title"] == "Test Quest"
    assert adv["slug"] == "test-quest"
    assert adv["variant"] == "template"

    adventures = storage.list_adventures()
    assert len(adventures) == 1
    assert adventures[0]["slug"] == adv["slug"]


def test_create_collision():
    storage.create_adventure("Test Quest")
    with pytest.raises(FileExistsError):
        storage.create_adventure("Test Quest")


def test_create_running_variant():
    adv = storage.create_adventure("Quest", variant="running")
    assert adv["variant"] == "running"


# ── Get ──────────────────────────────────────────────────────


def test_get_adventure():
    adv = storage.create_adventure("Quest")
    result = storage.get_adventure(adv["slug"])
    assert result is not None
    assert result["title"] == "Quest"


def test_get_missing():
    assert storage.get_adventure("nonexistent") is None


# ── Update ───────────────────────────────────────────────────


def test_update_adventure():
    adv = storage.create_adventure("Old Name")
    updated = storage.update_adventure(adv["slug"], {"title": "New Name"})
    assert updated is not None
    assert updated["title"] == "New Name"
    assert updated["slug"] == "new-name"
    # Old slug gone, new slug works
    assert storage.get_adventure("old-name") is None
    assert storage.get_adventure("new-name") is not None


def test_update_description_no_rename():
    adv = storage.create_adventure("Quest")
    updated = storage.update_adventure("quest", {"description": "Updated"})
    assert updated["description"] == "Updated"
    assert updated["slug"] == "quest"


def test_update_ignores_unknown_fields():
    adv = storage.create_adventure("Quest")
    updated = storage.update_adventure("quest", {"title": "Quest", "slug": "hacked"})
    assert updated["slug"] == "quest"


def test_update_title_collision():
    storage.create_adventure("Alpha")
    storage.create_adventure("Beta")
    with pytest.raises(FileExistsError):
        storage.update_adventure("beta", {"title": "Alpha"})


def test_update_missing():
    assert storage.update_adventure("nope", {"title": "X"}) is None


# ── Embark ───────────────────────────────────────────────────


def test_embark_adventure():
    template = storage.create_adventure("Quest", "A great quest")
    running = storage.embark_adventure(template["slug"])
    assert running is not None
    assert running["variant"] == "running"
    assert running["template_path"] == "adventures/quest"
    assert running["slug"] == "quest-2"  # collision with template → suffix
    assert running["title"] == template["title"]


def test_embark_multiple():
    storage.create_adventure("Quest")
    r1 = storage.embark_adventure("quest")
    r2 = storage.embark_adventure("quest")
    assert r1["slug"] == "quest-2"
    assert r2["slug"] == "quest-3"


def test_embark_missing():
    assert storage.embark_adventure("nope") is None


# ── Delete ───────────────────────────────────────────────────


def test_delete():
    adv = storage.create_adventure("Doomed")
    assert storage.delete_adventure(adv["slug"]) is True
    assert storage.get_adventure(adv["slug"]) is None
    assert storage.list_adventures() == []


def test_delete_missing():
    assert storage.delete_adventure("nope") is False
