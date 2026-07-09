from pathlib import Path
import sys

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


if __name__ == "__main__":
    uvicorn.run("holocron.api.main:app", host="0.0.0.0", port=8000, reload=True)
