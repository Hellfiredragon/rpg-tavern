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
