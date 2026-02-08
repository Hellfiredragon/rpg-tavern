from backend import storage


def test_create_and_list():
    adv = storage.create_adventure("Test Quest", "A test adventure")
    assert adv["name"] == "Test Quest"

    adventures = storage.list_adventures()
    assert len(adventures) == 1
    assert adventures[0]["id"] == adv["id"]


def test_get_adventure():
    adv = storage.create_adventure("Quest")
    result = storage.get_adventure(adv["id"])
    assert result is not None
    assert result["name"] == "Quest"


def test_get_missing():
    assert storage.get_adventure("nonexistent") is None


def test_delete():
    adv = storage.create_adventure("Doomed")
    assert storage.delete_adventure(adv["id"]) is True
    assert storage.get_adventure(adv["id"]) is None
    assert storage.list_adventures() == []


def test_delete_missing():
    assert storage.delete_adventure("nope") is False


def test_create_default_variant():
    adv = storage.create_adventure("Quest")
    assert adv["variant"] == "template"


def test_create_running_variant():
    adv = storage.create_adventure("Quest", variant="running")
    assert adv["variant"] == "running"


def test_update_adventure():
    adv = storage.create_adventure("Old Name")
    updated = storage.update_adventure(adv["id"], {"name": "New Name"})
    assert updated is not None
    assert updated["name"] == "New Name"
    # Verify persisted
    reloaded = storage.get_adventure(adv["id"])
    assert reloaded["name"] == "New Name"


def test_update_ignores_unknown_fields():
    adv = storage.create_adventure("Quest")
    updated = storage.update_adventure(adv["id"], {"name": "New", "id": "hacked"})
    assert updated["id"] == adv["id"]  # id unchanged


def test_update_missing():
    assert storage.update_adventure("nope", {"name": "X"}) is None


def test_embark_adventure():
    template = storage.create_adventure("Quest", "A great quest")
    running = storage.embark_adventure(template["id"])
    assert running is not None
    assert running["variant"] == "running"
    assert running["template_id"] == template["id"]
    assert running["name"] == template["name"]
    assert running["id"] != template["id"]


def test_embark_missing():
    assert storage.embark_adventure("nope") is None
