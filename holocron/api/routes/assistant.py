import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class AssistantRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=6000)
    context: dict[str, object] = Field(default_factory=dict)


def _output_text(payload: dict[str, object]) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                chunks.append(str(content.get("text", "")))
    return "\n".join(chunks).strip()


@router.get("/status")
def status() -> dict[str, object]:
    return {
        "configured": bool(os.getenv("OPENAI_API_KEY")),
        "model": os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
    }


@router.post("/chat")
async def chat(payload: AssistantRequest) -> dict[str, str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    context = str(payload.context)[:12000]
    request_body = {
        "model": os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
        "instructions": (
            "You are the concise assistant for a Star Wars 5e game master. Use the supplied live "
            "session context. Clearly label invented rulings and never claim an uncited rule is official."
        ),
        "input": f"Live session context:\n{context}\n\nGM request:\n{payload.message}",
        "max_output_tokens": 1200,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=request_body,
        )
    if response.is_error:
        raise HTTPException(status_code=502, detail="OpenAI request failed")
    text = _output_text(response.json())
    if not text:
        raise HTTPException(status_code=502, detail="OpenAI returned no text")
    return {"answer": text, "model": request_body["model"]}
