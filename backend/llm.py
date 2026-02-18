"""Async KoboldCpp text-completion client.

Sends generation requests to a local KoboldCpp instance and returns the
generated text. Supports overriding max_length and temperature per call.
"""

import httpx

KOBOLD_URL = "http://localhost:5001/api/v1/generate"


async def generate(prompt: str, max_length: int = 200, temperature: float = 0.7) -> str:
    """POST a generation request to KoboldCpp and return the generated text."""
    payload = {
        "prompt": prompt,
        "max_length": max_length,
        "temperature": temperature,
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(KOBOLD_URL, json=payload, timeout=60.0)
        response.raise_for_status()
        data = response.json()
        return data["results"][0]["text"]
