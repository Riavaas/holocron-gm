from __future__ import annotations

import base64
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from holocron.core.paths import DATA_DIR

router = APIRouter()
CAMPAIGNS_DIR = DATA_DIR / "campaigns"
ID_PATTERN = re.compile(r"^[a-z0-9-]{1,64}$")
MAX_MAP_BYTES = 100 * 1024 * 1024
ALLOWED_MAP_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


class CampaignPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    state: dict[str, object] = Field(default_factory=dict)


class CampaignImport(BaseModel):
    format: str
    campaign: dict[str, object]
    map: dict[str, str] | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _campaign_path(campaign_id: str) -> Path:
    if not ID_PATTERN.fullmatch(campaign_id):
        raise HTTPException(status_code=404, detail="Campaign not found")
    return CAMPAIGNS_DIR / f"{campaign_id}.json"


def _read_campaign(campaign_id: str) -> dict[str, object]:
    path = _campaign_path(campaign_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Campaign not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_campaign(campaign: dict[str, object]) -> None:
    CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
    path = _campaign_path(str(campaign["id"]))
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(campaign, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _map_path(campaign: dict[str, object]) -> Path | None:
    filename = campaign.get("map_filename")
    return CAMPAIGNS_DIR / str(filename) if filename else None


@router.get("")
def list_campaigns() -> dict[str, object]:
    CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for path in CAMPAIGNS_DIR.glob("*.json"):
        try:
            campaign = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items.append({key: campaign.get(key) for key in ("id", "name", "created_at", "updated_at")})
    items.sort(key=lambda item: str(item["updated_at"]), reverse=True)
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
def create_campaign(payload: CampaignPayload) -> dict[str, object]:
    timestamp = _now()
    campaign = {
        "id": uuid4().hex,
        "name": payload.name,
        "created_at": timestamp,
        "updated_at": timestamp,
        "state": payload.state,
        "map_filename": None,
        "map_content_type": None,
    }
    _write_campaign(campaign)
    return campaign


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str) -> dict[str, object]:
    return _read_campaign(campaign_id)


@router.put("/{campaign_id}")
def update_campaign(campaign_id: str, payload: CampaignPayload) -> dict[str, object]:
    campaign = _read_campaign(campaign_id)
    campaign["name"] = payload.name
    campaign["state"] = payload.state
    campaign["updated_at"] = _now()
    _write_campaign(campaign)
    return campaign


@router.delete("/{campaign_id}")
def delete_campaign(campaign_id: str) -> Response:
    campaign = _read_campaign(campaign_id)
    map_path = _map_path(campaign)
    _campaign_path(campaign_id).unlink(missing_ok=True)
    if map_path:
        map_path.unlink(missing_ok=True)
    return Response(status_code=204)


@router.put("/{campaign_id}/map")
async def upload_map(campaign_id: str, request: Request) -> dict[str, str]:
    campaign = _read_campaign(campaign_id)
    content_type = request.headers.get("content-type", "").split(";")[0]
    suffix = ALLOWED_MAP_TYPES.get(content_type)
    if not suffix:
        raise HTTPException(status_code=415, detail="Unsupported map image")
    content = await request.body()
    if not content or len(content) > MAX_MAP_BYTES:
        raise HTTPException(status_code=413, detail="Map image is empty or too large")
    CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
    old_map = _map_path(campaign)
    if old_map:
        old_map.unlink(missing_ok=True)
    filename = f"{campaign_id}.map{suffix}"
    (CAMPAIGNS_DIR / filename).write_bytes(content)
    campaign["map_filename"] = filename
    campaign["map_content_type"] = content_type
    campaign["updated_at"] = _now()
    _write_campaign(campaign)
    return {"url": f"/api/campaigns/{campaign_id}/map"}


@router.get("/{campaign_id}/map")
def campaign_map(campaign_id: str) -> FileResponse:
    campaign = _read_campaign(campaign_id)
    path = _map_path(campaign)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Campaign map not found")
    return FileResponse(path, media_type=str(campaign["map_content_type"]), headers={"Cache-Control": "no-cache"})


@router.get("/{campaign_id}/export")
def export_campaign(campaign_id: str) -> JSONResponse:
    campaign = _read_campaign(campaign_id)
    map_path = _map_path(campaign)
    map_bundle = None
    if map_path and map_path.is_file():
        map_bundle = {
            "content_type": str(campaign["map_content_type"]),
            "base64": base64.b64encode(map_path.read_bytes()).decode("ascii"),
        }
    bundle = {"format": "holocron-campaign-v1", "campaign": campaign, "map": map_bundle}
    return JSONResponse(
        bundle,
        headers={"Content-Disposition": f'attachment; filename="{campaign_id}.holocron.json"'},
    )


@router.post("/actions/import", status_code=201)
def import_campaign(payload: CampaignImport) -> dict[str, object]:
    if payload.format != "holocron-campaign-v1":
        raise HTTPException(status_code=400, detail="Unsupported campaign format")
    source = payload.campaign
    timestamp = _now()
    campaign_id = uuid4().hex
    campaign = {
        "id": campaign_id,
        "name": f"{source.get('name', 'Imported Campaign')} (imported)",
        "created_at": timestamp,
        "updated_at": timestamp,
        "state": source.get("state", {}),
        "map_filename": None,
        "map_content_type": None,
    }
    if payload.map:
        content_type = payload.map.get("content_type", "")
        suffix = ALLOWED_MAP_TYPES.get(content_type)
        if not suffix:
            raise HTTPException(status_code=400, detail="Unsupported imported map")
        try:
            content = base64.b64decode(payload.map.get("base64", ""), validate=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid imported map") from exc
        if len(content) > MAX_MAP_BYTES:
            raise HTTPException(status_code=413, detail="Imported map is too large")
        CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{campaign_id}.map{suffix}"
        (CAMPAIGNS_DIR / filename).write_bytes(content)
        campaign["map_filename"] = filename
        campaign["map_content_type"] = content_type
    _write_campaign(campaign)
    return campaign
