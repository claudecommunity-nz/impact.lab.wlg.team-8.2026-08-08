default:
    @just --list

# --- data ------------------------------------------------------------------
# Pull everything to data/raw. Idempotent — skips what is already on disk.
pull: pull-movement pull-gis pull-context

pull-movement:
    uv run python -m team8.fetch_data.pull_movement

pull-gis:
    uv run python -m team8.fetch_data.pull_gis

pull-context:
    uv run python -m team8.fetch_data.pull_context

pull-events:
    python3 -m team8.fetch_data.pull_events

events:
    python3 -m team8.fetch_data.events

# --- scoping ---------------------------------------------------------------
# Catalogue every source with its schema -> data/catalogue/sources.json
inventory:
    uv run python -m team8.fetch_data.inventory

# Per-source profile reports (schema, distributions, missingness) -> docs/profiles/
profile:
    uv run python -m team8.fetch_data.profile_sources

# Static source index -> docs/index.html
index:
    uv run python -m team8.fetch_data.build_index

# Everything that turns raw data into browsable artefacts.
scope: inventory profile index

# --- poneke pulse ----------------------------------------------------------
web_dir := justfile_directory() / "team8/poc_1/web"
poc_port := "5199"

# Precompute the static artefacts the web app loads -> team8/poc_1/web/public/data
poc-data:
    uv run python -m team8.poc_1.pipeline.build

# Kept: the original name for the pipeline.
build: poc-data

# Install the web dependencies. Idempotent.
poc-install:
    cd {{web_dir}} && npm install

# The app, hot-reloading. Pipeline artefacts must exist -> run `just poc-data` first.
poc-dev: poc-install
    @echo "http://localhost:{{poc_port}}"
    cd {{web_dir}} && npm run dev -- --port {{poc_port}} --strictPort

# Typecheck, lint, bundle. The gate a change has to pass before it is demoed.
# poc-data first: the gate touched none of public/data, so a corrected string in
# pipeline/config.py sat unbuilt on disk and the app shipped the old copy.
poc-check: poc-install poc-data
    cd {{web_dir}} && npm run typecheck && npm run lint && npm run build

# Production bundle -> team8/poc_1/web/dist. Fails on any type or lint error.
poc-build: poc-install
    cd {{web_dir}} && npm run lint && npm run build

# Serve the built bundle.
poc-preview: poc-build
    cd {{web_dir}} && npm run preview -- --port {{poc_port}} --strictPort

# Pipeline, then bundle. The whole thing from raw data.
poc: poc-data poc-build

# --- exploring -------------------------------------------------------------
# The interactive dashboard. This is the main way in.
explore:
    uv run marimo edit notebooks/explore.py

# Read-only version of the same notebook.
view:
    uv run marimo run notebooks/explore.py

# Serve the static index + profile reports.
serve:
    @echo "http://localhost:8123"
    uv run python -m http.server 8123 --directory docs
