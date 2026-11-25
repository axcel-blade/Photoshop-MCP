# Testing

| Command | Needs Photoshop | What it covers |
|---|---|---|
| `pnpm typecheck` | no | `tsc --noEmit` over `src/`, `tests/`, `scripts/` |
| `pnpm lint` | no | ESLint (`temp/`, `site/`, `photoshop-scripts/`, `dist/` ignored) |
| `pnpm test` | no | Vitest unit + security suites against the mock adapter (7 files, 58 tests) |
| `pnpm test:e2e` | no (default) | Built server over stdio: tool calls end to end (`PHOTOSHOP_ADAPTER=mock`) |
| `pnpm test:e2e:http` | no | Built server over Streamable HTTP: bearer / secret-path auth, tool listing and calls |
| `pnpm test:e2e:resources` | no | Reads every resource and prompt from the built server |
| `pnpm test:integration` | **yes** | Live run against the installed Photoshop (COM / AppleScript), PASS/FAIL per step |

## Unit and security suites

| File | Covers |
|---|---|
| `tests/unit/server.test.ts` | Server startup over an in-memory MCP transport; every specified tool is registered; annotations and honest `unsupported` status; resources and prompts; `photoshop_status`; mock labelling |
| `tests/unit/bridge.test.ts` | `PhotoshopBridge`: refuses non-allowlisted ops, ordering and history, JSX error envelopes → typed errors, timeouts that don't block the queue, job timeout scope, cancellation; script builder (ES3-safe literal), malformed output; **every allowlisted op is implemented in `photoshop-scripts/`**; PNG decoding and pixel statistics |
| `tests/unit/tools.test.ts` | Document, layer, text, shape, image, selection/mask/retouch/color, export and delivery tools against the mock, including confirmation and overwrite errors; `generate_design` plans, builds, verifies and previews |
| `tests/unit/workflow.test.ts` | Brief parsing, planning, placeholders, failure / continue / cancel, brief → executed workflow → PSD + PNG, stored workflows, background batch |
| `tests/unit/transport.test.ts` | Streamable HTTP: 401 without token, tool calls with bearer auth |
| `tests/unit/utils.test.ts` | Colors and contrast, image header parsing, PNG mask encoder, AI providers inert until configured, Firefly / remove.bg with mocked HTTP |
| `tests/security/security.test.ts` | Path traversal / UNC / URL / drive / symlink escapes, extensions, no-overwrite, unknown adapter refused, HTTP auth, log redaction, out-of-sandbox paths in every file tool, destructive confirmations, Zod rejects before Photoshop is called |

These suites use `MockAdapter` (in-memory documents and layers). They verify the server, bridge, validation, security and
workflow logic — **not** that Photoshop executes the ops. Mock results are always labelled `source: "mock"`.

## Live integration test

```powershell
pnpm test:integration
```

Runs `tests/integration/run-integration.ts` with `PHOTOSHOP_ADAPTER=auto` (COM on Windows, AppleScript on macOS). Photoshop is
launched if needed. It runs 36 checked steps — status, document creation, gradient fill layer, rectangle / ellipse / star shapes,
text create / edit, text shadow, gradient text, pixel layer fill, smart-filter noise and blur, opacity / blend, levels / curves /
hue-sat adjustments, cinematic grade, selection + feather + info, pixel analysis, preview, validation, history, save PSD, export
PNG / resized JPEG / WebP / TIFF (each checked on disk), `generate_design` with the design engine, `critique_design`, undo, close —
and prints `PASS`/`FAIL` per step with timing and Photoshop's warnings or error text, then `N/36 steps passed`. Output files go
to `output/integration-<timestamp>/`. The exit code is non-zero on any failure.

`scripts\integration-test.ps1` wraps it with the `test-bridge.ps1` pre-check (exit code 2 = blocked: bridge unavailable).
`E2E_ADAPTER=auto pnpm test:e2e` runs the e2e suite against real Photoshop as well.

Latest results: [TEST_REPORT.md](TEST_REPORT.md).

## PowerShell syntax check

CI parses every `.ps1` under `scripts/`, `photoshop-scripts/` and `installers/windows/`:

```powershell
Get-ChildItem scripts, photoshop-scripts, installers/windows -Filter *.ps1 | ForEach-Object { $e = $null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$e) | Out-Null; if ($e) { $_.FullName; $e } }
```

## Manual checks with an MCP client

1. `photoshop_status` → adapter and Photoshop version shown.
2. "Create a 1080×1080 Instagram post with the headline 'Grand Opening' in the bold style" → then `capture_preview` and look at the image.
3. Open a portrait, "smooth the skin lightly and correct the white balance" → new layers *Skin Smoothing* and *Auto White Balance* appear; the original layer is unchanged.
4. "Export it as a PNG to output\test.png" twice → the second call returns `FILE_EXISTS`.
