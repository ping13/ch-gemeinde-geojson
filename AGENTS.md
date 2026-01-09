# Repository Guidelines

## Project Structure & Module Organization
- `Makefile` defines the core ETL workflow (download → extract → parquet → web assets).
- `assets/` stores downloaded GML/ZIP data and generated parquet artifacts.
- `gemeinde_json.sh` exports a single municipality to GeoJSON (`gemeinde.geojson` by default).
- `web/` contains the Vite frontend (`web/src/`, `web/public/`, `web/vite.config.js`).

## Build, Test, and Development Commands
- `make download` fetches the swissBOUNDARIES3D GML ZIP into `assets/`.
- `make extract` unzips and records the GML path in `assets/gml_path.txt`.
- `make parquet` builds `assets/swissboundaries.parquet`, then creates the optimized `assets/swissboundaries_by_text.parquet` and copies it to `web/public/assets/`.
- `make bun-install` installs web dependencies in `web/` (Bun).
- `make bun-dev` runs the Vite dev server.
- `make bun-build` builds the production bundle.
- `make bun-preview` previews the production build locally.

## Coding Style & Naming Conventions
- JavaScript/CSS live in `web/src/`; follow existing 2-space indentation and semicolon usage.
- Keep filenames and CSS class names descriptive (`panel-header`, `gemeinde-list`).
- Shell scripts use strict mode (`set -euo pipefail`) and uppercase env vars for config.

## Testing Guidelines
- No automated test framework is present yet.
- If you add tests, document the runner and add a Makefile target (e.g., `make test`).

## GitHub Pages Deployment
- GitHub Pages is configured via `.github/workflows/deploy.yml` and deploys `web/dist` on pushes to `main`.
- In GitHub settings, set Pages source to "GitHub Actions" for this repo.
- Ensure data assets are available before building: `make parquet` (copies `assets/swissboundaries.parquet` into `web/public/assets/`).
- Build locally with `make bun-build`; the workflow uses `bun run build` from `web/`.
- The app uses `import.meta.env.BASE_URL` for asset URLs so it works on project pages.

## Commit & Pull Request Guidelines
- This directory has no Git history, so no commit convention is detectable. Use clear, imperative messages and include scope if helpful (e.g., `web: add parquet caching`).
- For PRs, include a short summary, the commands you ran, and screenshots for UI changes in `web/`.

## Agent-Specific Instructions
- Prefer Makefile targets for ETL steps instead of ad-hoc shell commands.
- If adding Python, use `uv run` and prefer `httpx` + `click` for HTTP/CLI work.
