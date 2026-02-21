"""LLM client — HTTP connection to a text-completion backend.

The pipeline injects an LLM callable matching the protocol:

    async def __call__(self, stage: str, prompt: str) -> str: ...

`stage` identifies which pipeline stage is calling (e.g. "narrator",
"character_dialog"). The implementation may use it for logging or routing;
the simplest implementation ignores it.

Two implementations are provided:

    HttpLLM   — real HTTP client, supports KoboldCpp and OpenAI-compatible
                 backends. Selected by provider_format.
    EchoLLM   — returns the prompt back unchanged. Useful for smoke-testing
                 the pipeline wiring without a running model.

Production code constructs an HttpLLM from config and passes it to run_turn().
Tests use StubLLM (defined in the test helpers) instead.
"""

from __future__ import annotations

import logging
from typing import Literal, Protocol

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Protocol — every LLM implementation must match this signature
# ---------------------------------------------------------------------------

class LLM(Protocol):
    async def __call__(self, stage: str, prompt: str) -> str: ...


# ---------------------------------------------------------------------------
# HttpLLM — connects to a real backend
# ---------------------------------------------------------------------------

ProviderFormat = Literal["koboldcpp", "openai"]


class HttpLLM:
    """Async HTTP client for text-completion backends.

    Supported formats:
      "koboldcpp"  — POST /api/v1/generate  {"prompt": ...}
                     Response: {"results": [{"text": "..."}]}
      "openai"     — POST /v1/completions   {"model": ..., "prompt": ...}
                     Response: {"choices": [{"text": "..."}]}

    Args:
        provider_url:    Base URL of the backend, e.g. "http://localhost:5001".
        api_key:         Bearer token, or empty string if not required.
        provider_format: Wire format to use. Defaults to "koboldcpp".
        model:           Model identifier, used only by the openai format.
        timeout:         HTTP timeout in seconds. Defaults to 120.
    """

    def __init__(
        self,
        provider_url: str,
        api_key: str = "",
        provider_format: ProviderFormat = "koboldcpp",
        model: str = "",
        timeout: float = 120.0,
    ) -> None:
        self._base_url = provider_url.rstrip("/")
        self._api_key = api_key
        self._format = provider_format
        self._model = model
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _build_request(self, prompt: str) -> tuple[str, dict]:
        """Return (url, body) for the configured format."""
        if self._format == "openai":
            url = f"{self._base_url}/v1/completions"
            body: dict = {"prompt": prompt}
            if self._model:
                body["model"] = self._model
            return url, body

        # koboldcpp (default)
        url = f"{self._base_url}/api/v1/generate"
        return url, {"prompt": prompt}

    def _parse_response(self, data: dict) -> str:
        """Extract the completion text from the response body."""
        if self._format == "openai":
            choices = data.get("choices")
            if not choices or "text" not in choices[0]:
                raise LLMError("Unexpected response format from OpenAI-compatible backend")
            return choices[0]["text"]

        # koboldcpp
        results = data.get("results")
        if not results or "text" not in results[0]:
            raise LLMError("Unexpected response format from KoboldCpp backend")
        return results[0]["text"]

    async def __call__(self, stage: str, prompt: str) -> str:
        url, body = self._build_request(prompt)
        logger.debug("llm call stage=%s url=%s prompt_len=%d", stage, url, len(prompt))

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=body, headers=self._headers())
                resp.raise_for_status()
        except httpx.ConnectError as e:
            raise LLMError(f"Cannot connect to LLM backend at {self._base_url}") from e
        except httpx.HTTPStatusError as e:
            raise LLMError(
                f"LLM backend returned HTTP {e.response.status_code}"
            ) from e
        except httpx.TimeoutException as e:
            raise LLMError(f"LLM backend timed out after {self._timeout}s") from e

        text = self._parse_response(resp.json())
        logger.debug("llm response stage=%s len=%d", stage, len(text))
        return text


# ---------------------------------------------------------------------------
# EchoLLM — returns the prompt unchanged; useful for pipeline smoke tests
# ---------------------------------------------------------------------------

class EchoLLM:
    """Returns the prompt text as-is. No network calls.

    Lets you verify that the pipeline wiring (context building, beat-script
    expansion, storage writes) works end-to-end without a running model.
    The output won't be valid JSON for structured stages — use StubLLM
    in tests when you need controlled responses.
    """

    async def __call__(self, stage: str, prompt: str) -> str:
        logger.debug("EchoLLM stage=%s prompt_len=%d", stage, len(prompt))
        return prompt


# ---------------------------------------------------------------------------
# LLMError — raised by HttpLLM for all connection and protocol failures
# ---------------------------------------------------------------------------

class LLMError(RuntimeError):
    """Raised when the LLM backend cannot be reached or returns an error."""
