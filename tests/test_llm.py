"""Tests for rpg_tavern.llm — HttpLLM and EchoLLM."""

import json
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

from rpg_tavern.llm import EchoLLM, HttpLLM, LLMError


# ---------------------------------------------------------------------------
# EchoLLM
# ---------------------------------------------------------------------------

class TestEchoLLM:
    async def test_returns_prompt_unchanged(self) -> None:
        llm = EchoLLM()
        result = await llm("narrator", "hello world")
        assert result == "hello world"

    async def test_stage_name_ignored(self) -> None:
        llm = EchoLLM()
        assert await llm("narrator", "x") == await llm("extractor", "x")


# ---------------------------------------------------------------------------
# HttpLLM — KoboldCpp format
# ---------------------------------------------------------------------------

def _mock_response(body: dict, status: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = body
    resp.raise_for_status = MagicMock(
        side_effect=None if status < 400 else httpx.HTTPStatusError(
            "", request=MagicMock(), response=resp
        )
    )
    return resp


class TestHttpLLMKoboldCpp:
    @pytest.fixture
    def llm(self) -> HttpLLM:
        return HttpLLM(provider_url="http://localhost:5001", api_key="")

    async def test_happy_path(self, llm: HttpLLM) -> None:
        body = {"results": [{"text": "The tavern is dark and smoky."}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            result = await llm("narrator", "Describe the tavern.")
        assert result == "The tavern is dark and smoky."

    async def test_posts_to_correct_url(self, llm: HttpLLM) -> None:
        body = {"results": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        url = mock_post.call_args[0][0]
        assert url == "http://localhost:5001/api/v1/generate"

    async def test_sends_prompt_in_body(self, llm: HttpLLM) -> None:
        body = {"results": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "my prompt")
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body == {"prompt": "my prompt"}

    async def test_bearer_token_sent_when_api_key_set(self) -> None:
        llm = HttpLLM(provider_url="http://localhost:5001", api_key="secret")
        body = {"results": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        headers = mock_post.call_args.kwargs["headers"]
        assert headers.get("Authorization") == "Bearer secret"

    async def test_no_auth_header_when_no_api_key(self, llm: HttpLLM) -> None:
        body = {"results": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        headers = mock_post.call_args.kwargs["headers"]
        assert "Authorization" not in headers

    async def test_trailing_slash_stripped_from_url(self) -> None:
        llm = HttpLLM(provider_url="http://localhost:5001/")
        body = {"results": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        url = mock_post.call_args[0][0]
        assert url == "http://localhost:5001/api/v1/generate"

    async def test_connect_error_raises_llm_error(self, llm: HttpLLM) -> None:
        mock_post = AsyncMock(side_effect=httpx.ConnectError("refused"))
        with patch("httpx.AsyncClient.post", mock_post):
            with pytest.raises(LLMError, match="Cannot connect"):
                await llm("narrator", "prompt")

    async def test_timeout_raises_llm_error(self, llm: HttpLLM) -> None:
        mock_post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        with patch("httpx.AsyncClient.post", mock_post):
            with pytest.raises(LLMError, match="timed out"):
                await llm("narrator", "prompt")

    async def test_http_error_raises_llm_error(self, llm: HttpLLM) -> None:
        bad_resp = MagicMock()
        bad_resp.status_code = 503
        bad_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "", request=MagicMock(), response=bad_resp
        )
        mock_post = AsyncMock(return_value=bad_resp)
        with patch("httpx.AsyncClient.post", mock_post):
            with pytest.raises(LLMError, match="HTTP 503"):
                await llm("narrator", "prompt")

    async def test_malformed_response_raises_llm_error(self, llm: HttpLLM) -> None:
        body = {"unexpected": "format"}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            with pytest.raises(LLMError, match="Unexpected response format"):
                await llm("narrator", "prompt")


# ---------------------------------------------------------------------------
# HttpLLM — OpenAI format
# ---------------------------------------------------------------------------

class TestHttpLLMOpenAI:
    @pytest.fixture
    def llm(self) -> HttpLLM:
        return HttpLLM(
            provider_url="http://localhost:8080",
            provider_format="openai",
            model="mistral-7b",
        )

    async def test_posts_to_correct_url(self, llm: HttpLLM) -> None:
        body = {"choices": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        url = mock_post.call_args[0][0]
        assert url == "http://localhost:8080/v1/completions"

    async def test_sends_model_in_body(self, llm: HttpLLM) -> None:
        body = {"choices": [{"text": "ok"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            await llm("narrator", "prompt")
        sent_body = mock_post.call_args.kwargs["json"]
        assert sent_body["model"] == "mistral-7b"

    async def test_happy_path(self, llm: HttpLLM) -> None:
        body = {"choices": [{"text": "A stormy night."}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            result = await llm("narrator", "prompt")
        assert result == "A stormy night."

    async def test_malformed_response_raises_llm_error(self, llm: HttpLLM) -> None:
        body = {"results": [{"text": "kobold format accidentally"}]}
        mock_post = AsyncMock(return_value=_mock_response(body))
        with patch("httpx.AsyncClient.post", mock_post):
            with pytest.raises(LLMError, match="Unexpected response format"):
                await llm("narrator", "prompt")
