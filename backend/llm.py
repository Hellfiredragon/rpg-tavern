"""KoboldCpp text completion client."""

import httpx
from fastapi import HTTPException


async def generate(provider_url: str, api_key: str, prompt: str) -> str:
    """Send a text completion request to KoboldCpp and return the generated text.

    Calls POST {provider_url}/api/v1/generate with {"prompt": prompt}.
    """
    url = f"{provider_url.rstrip('/')}/api/v1/generate"
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json={"prompt": prompt}, headers=headers)
            resp.raise_for_status()
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to LLM provider")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"LLM provider returned {e.response.status_code}")
    except httpx.TimeoutException:
        raise HTTPException(502, "LLM provider timed out")

    data = resp.json()
    results = data.get("results")
    if not results or "text" not in results[0]:
        raise HTTPException(502, "Unexpected response format from LLM provider")
    return results[0]["text"]
