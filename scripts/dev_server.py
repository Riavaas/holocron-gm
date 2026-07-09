from pathlib import Path
import socket
import sys

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


if __name__ == "__main__":
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            local_ip = probe.getsockname()[0]
    except OSError:
        local_ip = "127.0.0.1"
    print(f"GM address:     http://{local_ip}:8000")
    print(f"Player address: http://{local_ip}:8000/player")
    uvicorn.run("holocron.api.main:app", host="0.0.0.0", port=8000, reload=True)
