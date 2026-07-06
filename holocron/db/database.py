import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from holocron.core.paths import DATA_DIR, DB_PATH
from holocron.db.migrations import migrate


@contextmanager
def get_connection(db_path: str | None = None) -> Iterator[sqlite3.Connection]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path or DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        migrate(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()

