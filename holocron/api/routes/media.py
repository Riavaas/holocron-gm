from __future__ import annotations

import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


@router.get("/youtube-title")
def youtube_title(url: str = Query(..., min_length=8)) -> dict[str, str]:
    params = urlencode({"url": url, "format": "json"})
    request = Request(
        f"https://www.youtube.com/oembed?{params}",
        headers={"Accept": "application/json", "User-Agent": "Holocron-GM/0.1"},
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except OSError as error:
        raise HTTPException(status_code=404, detail="YouTube title unavailable") from error
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=404, detail="YouTube title unavailable")
    return {"title": title}
