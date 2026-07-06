from dataclasses import dataclass

from holocron.core.paths import BOOKS_DIR, DB_PATH


@dataclass(frozen=True)
class Settings:
    books_dir: str = str(BOOKS_DIR)
    db_path: str = str(DB_PATH)
    default_pdf_knowledge_type: str = "sw5e_rules"
    default_markdown_knowledge_type: str = "campaign_lore"
    max_chunk_words: int = 1200
    chunk_overlap_words: int = 120


settings = Settings()

