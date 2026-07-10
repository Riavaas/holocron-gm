# Assets

Put portraits, tokens, maps, UI images, and other campaign visuals here.

Image assets are expected to be versioned through Git LFS:

```bash
git lfs install
git lfs pull
```

`pdf_images/` contains web-ready JPEGs extracted from local PDFs plus a
`manifest.json` catalog. The API serves these files from `/assets/...` and
exposes the catalog through `/api/assets/images`.

Regenerate all local PDF art:

```bash
python3 scripts/extract_pdf_images.py --force
```

The bestiary links creature cards to extracted images by `source_file` and
`page_start`, so creature portraits and map tokens update automatically when
the manifest is rebuilt.

`external_sources.json` catalogs curated community asset sources such as
Reddit map feeds and Kualan's Clone Wars token packs. Downloaded zip files are
kept out of git under `data/external_downloads/`; extracted token PNGs live
under `Assets/external/` with `Assets/external/manifest.json`.

Check and import curated external packs:

```bash
python3 scripts/import_external_assets.py --list --check
python3 scripts/import_external_assets.py --source kualan-clone-wars-tokens-1 --download --analyze
python3 scripts/import_external_assets.py --extract
```

Keep original author/source metadata when using community maps or tokens.
