from fastapi import APIRouter

from holocron.characters.pregens import list_pregens

router = APIRouter()


@router.get("/pregens")
def pregens() -> dict[str, object]:
    items = list_pregens()
    return {"items": items, "total": len(items)}
