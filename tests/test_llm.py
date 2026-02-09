from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.llm import generate


@pytest.fixture
def mock_response():
    """Create a mock httpx response with KoboldCpp format."""
    resp = AsyncMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {"results": [{"text": "You see a dusty counter..."}]}
    resp.raise_for_status = lambda: None
    return resp


@pytest.mark.asyncio
async def test_generate_success(mock_response):
    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await generate("http://localhost:5001", "", "test prompt")

    assert result == "You see a dusty counter..."
    mock_client.post.assert_called_once_with(
        "http://localhost:5001/api/v1/generate",
        json={"prompt": "test prompt"},
        headers={},
    )


@pytest.mark.asyncio
async def test_generate_with_api_key(mock_response):
    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        await generate("http://localhost:5001", "my-key", "test prompt")

    mock_client.post.assert_called_once_with(
        "http://localhost:5001/api/v1/generate",
        json={"prompt": "test prompt"},
        headers={"Authorization": "Bearer my-key"},
    )


@pytest.mark.asyncio
async def test_generate_strips_trailing_slash(mock_response):
    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        await generate("http://localhost:5001/", "", "p")

    url = mock_client.post.call_args[0][0]
    assert url == "http://localhost:5001/api/v1/generate"


@pytest.mark.asyncio
async def test_generate_connect_error():
    mock_client = AsyncMock()
    mock_client.post.side_effect = httpx.ConnectError("refused")

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(Exception) as exc_info:
            await generate("http://localhost:9999", "", "p")
        assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_generate_timeout():
    mock_client = AsyncMock()
    mock_client.post.side_effect = httpx.ReadTimeout("timeout")

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(Exception) as exc_info:
            await generate("http://localhost:5001", "", "p")
        assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_generate_bad_response_format():
    resp = AsyncMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {"unexpected": "format"}
    resp.raise_for_status = lambda: None

    mock_client = AsyncMock()
    mock_client.post.return_value = resp

    with patch("backend.llm.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(Exception) as exc_info:
            await generate("http://localhost:5001", "", "p")
        assert exc_info.value.status_code == 502
