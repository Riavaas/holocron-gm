from copy import deepcopy

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()
_session_state: dict[str, object] = {}
_version = 0


class SessionUpdate(BaseModel):
    state: dict[str, object] = Field(default_factory=dict)


@router.get("/state")
def get_state() -> dict[str, object]:
    return {"version": _version, "state": deepcopy(_session_state)}


@router.put("/state")
def put_state(payload: SessionUpdate) -> dict[str, int]:
    global _session_state, _version
    _session_state = deepcopy(payload.state)
    _version += 1
    return {"version": _version}
