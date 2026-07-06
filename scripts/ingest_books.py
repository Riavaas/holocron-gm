from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from holocron.ingest.pipeline import ingest_books


if __name__ == "__main__":
    print(ingest_books())
