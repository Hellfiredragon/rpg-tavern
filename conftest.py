import shutil
from pathlib import Path

import pytest

from backend import storage

TEST_DATA_DIR = Path("data-tests")


@pytest.fixture(autouse=True)
def clean_test_data():
    """Wipe and re-init data-tests/ before every test."""
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    storage.init_storage(TEST_DATA_DIR)
    yield
    # leave data-tests around after tests for inspection; CI can ignore it
