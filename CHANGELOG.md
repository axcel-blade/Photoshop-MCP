# Changelog

## Unreleased

## 1.1.0 — 2026-11-25

### Added
- Internet image search & asset library (`assets` module, see `docs/IMAGE_ASSETS.md`): `search_images`, `search_stock_photos`, `search_transparent_images`, `search_icons`, `search_textures`, `get_image_details`, `filter_images`, `download_image`, `download_multiple_images`, `import_image_to_photoshop`, `import_multiple_images`, `get_downloaded_assets`.
- Providers: Openverse and Wikimedia Commons (no key), Unsplash, Pexels and Pixabay (optional keys). Results are normalized with creator, licence and attribution; paid/premium and non-free results are excluded; per-provider throttling and 429 back-off.
- Safe downloads: magic-byte type checks (PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF, HEIC, script-free SVG), provider host allowlists, SSRF protection on every redirect, byte/pixel/dimension limits, retries, sanitized unique filenames, SHA-256 de-duplication, JSON sidecars and a manifest preserving source URL, creator and licence.
- Google Images provider (`google`) via SerpApi (`SERPAPI_API_KEY`) or the Google Custom Search JSON API (`GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`; shuts down 2027-01-01). No scraping. Results carry `licenseStatus: "unverified"`, and search, download and import warn about it.
- `place_image` and `import_image` accept `url`.

### Fixed
- Bridge: multi-layer references (e.g. `group_layers` with dozens of layers) are resolved in one layer-tree walk instead of one walk per reference; grouping ~60 layers in a ~250-layer document no longer times out.
- Bridge: an adjustment created with `clip: true` on a **group** is now placed directly above the group and clipped to the whole group; before, Photoshop created it inside the group, clipped to the group's top layer only.
- Asset records report real `transparency` (`alpha`/`none`) from the file header. Search results skip non-image files (Wikimedia PDF/DjVu scans), and an empty search suggests broader keywords.
- `design_with_web_assets` prompt: brief → assets → search → licence check → download → import as layers → continue designing → credits.
- Settings `ASSETS_DIR`, `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `MAX_DOWNLOAD_MB`, `DOWNLOAD_TIMEOUT_MS`, `DOWNLOAD_RETRIES`, `MAX_IMAGE_DIMENSION`, `MAX_IMAGE_MEGAPIXELS`, `IMAGE_SEARCH_TIMEOUT_MS`, `ALLOW_PRIVATE_DOWNLOADS`.

## 1.0.0 — 2026-11-25

### Added
- MCP server (stdio + Streamable HTTP with bearer token or secret path) with 294 tools in 19 modules: documents, layers, text, shapes & design templates, images, selection & masking, background/object editing, retouching, color correction, filters & layer styles, compositing, digital art, AI integration, actions & automation, history & inspection, export & delivery, AI design engine, UI design, background jobs.
- Photoshop bridge following Illustrator-MCP: `PhotoshopBridge` with an 88-op allowlist, serial queue, script builder and timeouts; adapters for Windows COM (`Photoshop.Application.DoJavaScriptFile` via `powershell.exe`), macOS AppleScript (`do javascript file` via `osascript`) and an in-memory mock. `PHOTOSHOP_ADAPTER=auto` picks the platform adapter.
- ExtendScript op library (`photoshop-scripts/*.jsx`) with a JSON envelope, and `MCP.toDesc`, which converts batchPlay-style descriptor JSON into `ActionDescriptor`s for Action Manager calls.
- Previews and pixel statistics rendered to temp files by Photoshop and decoded in Node (`postprocess.ts`, dependency-free PNG decoder).
- Design engine from Illustrator-MCP (brief analysis, templates, styles, validation, compilation, composition analysis, critique, revisions, variations, design knowledge data), with design plans built as Photoshop layer groups, shape and text layers in one `execute_plan` call (points → pixels at `resolution / 72`).
- UI design tools (auto layout, components, design tokens, device frames, semantic layer renaming), plan store and background jobs (`get_job`, `wait_for_job`, `list_jobs`, `cancel_job`).
- Natural-language workflow engine (`src/workflow-engine`): brief parser, canvas presets, styles, layouts, planner and step runner with `{{steps.*}}` / `{{vars.*}}` placeholders.
- Data-driven corrections from measured pixel statistics (exposure, white balance, color/lighting match, image analysis).
- Optional providers: Adobe Firefly Services (generate / fill / expand) and remove.bg, inert until configured.
- 10 resources, 8 prompts, 58 unit/security tests, e2e suites (stdio, HTTP, resources), live integration runner (`pnpm test:integration`).
- Scripts (`install`, `build`, `launch`, `check-deps`, `diagnostics`, `test-bridge`, `integration-test`, `new-token`, `pack-release`, `smoke-install`, `gen-tool-docs`), one-line installers for Windows and macOS, CI / CD / release / installer / Docker / Pages workflows, Astro docs site.

### Changed
- Replaced the early UXP plugin + WebSocket bridge prototype with the COM / AppleScript + ExtendScript bridge. Removed `PS_BRIDGE_*`, `PS_ADAPTER`, the bridge token, the `.ccx` packaging and the `ws` dependency. Configuration is now `PHOTOSHOP_ADAPTER`, `PHOTOSHOP_TIMEOUT_MS`, `PHOTOSHOP_JOB_TIMEOUT_MS`, `PHOTOSHOP_AUTO_LAUNCH` plus the `MCP_*` and provider variables.
- One tool-reference generator: `pnpm docs:tools` (`scripts/gen-tool-docs.ts`), checked in CI.

### Verified
- Live integration run: 36/36 steps passed against Photoshop 2027 (v28.0.0) on Windows 11 via COM ([docs/TEST_REPORT.md](docs/TEST_REPORT.md)).

### Known limitations
- macOS / AppleScript path not yet run on a Mac; Firefly and remove.bg not exercised against the live services. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
