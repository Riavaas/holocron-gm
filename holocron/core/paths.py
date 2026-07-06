from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BOOKS_DIR = PROJECT_ROOT / "Books"
COMPENDIUM_DIR = PROJECT_ROOT / "Compendium"
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "holocron.sqlite"
