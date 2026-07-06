from holocron.ingest.chunker import TextUnit, chunk_units


def test_chunker_splits_text_and_preserves_page():
    words = " ".join(f"word{i}" for i in range(80))
    chunks = chunk_units([TextUnit(words, page_start=3, page_end=3)], max_words=30, overlap_words=5)

    assert len(chunks) >= 3
    assert chunks[0].page_start == 3
    assert chunks[0].page_end == 3
    assert chunks[0].content_hash

