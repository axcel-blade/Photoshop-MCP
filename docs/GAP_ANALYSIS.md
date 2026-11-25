# Gap analysis (Photoshop 2027 / v28.0, Windows COM bridge)

Measured against the reference project [Illustrator-MCP](https://github.com/axcel-blade/Illustrator-MCP), whose architecture this
server follows, and the Photoshop MCP feature spec (16 photo/design modules).
Baseline: **294 tools**, 10 resources, 8 prompts, 58 passing unit tests, live integration 36/36.

## 1. What matches the reference

| Area | Status |
|---|---|
| Single-package TypeScript layout, pnpm only, NodeNext → `dist/` | Done |
| Bridge: allowlist, serial queue, script builder, COM / AppleScript / mock adapters, detection, timeouts, typed errors | Done (`src/photoshop/bridge/`) |
| ExtendScript op library with `MCP.main` envelope | Done (`photoshop-scripts/`, 88 ops) |
| Design engine (brief analysis, templates, styles, validator, compiler, composition analysis, critique, revisions, variations, design knowledge CSVs) | Done; compiler output built as Photoshop layers by `design.jsx` |
| UI design (auto layout, components, tokens, device frames, semantic renaming) | Done |
| Plan store, background jobs (`get_job`, `wait_for_job`, `list_jobs`, `cancel_job`) | Done |
| Transports (stdio, Streamable HTTP with bearer / secret path) | Done |
| Installers, release packing, smoke test, CI/CD workflows, docs site | Done (adapted from the reference) |
| Safety (path sandbox, `confirm` on destructive ops, op allowlist, no overwrite) | Done |

## 2. Photoshop-specific additions

Modules the reference does not have, all on the same bridge: layer management, text effects, selections and masks,
background/object editing (Select Subject, Content-Aware Fill), photo retouching, color correction (adjustment layers),
filters (smart filters), compositing, digital-art canvases, AI provider tools (Firefly, remove.bg), actions and batch
processing, history and pixel-statistics inspection, and a natural-language workflow engine (`src/workflow-engine`).

## Background jobs

The long-running tools (design builds, composites, batch exports, delivery packages — 41 tools) accept `background: true` and
return a `jobId` immediately. `get_job`, `wait_for_job`, `list_jobs` and `cancel_job` collect the result. Each Photoshop call
inside a job uses `PHOTOSHOP_JOB_TIMEOUT_MS` (default 15 min). Jobs run one at a time, in order; a running job cannot be
interrupted (ExtendScript has no cancellation), only queued ones.

## 3. Gaps worth building

- **macOS verification**: run `pnpm test:integration` on a Mac (AppleScript adapter, `scripts/*.sh`).
- **Live coverage**: the integration run covers the most-used ops; add live steps for masks, Select Subject/Sky, Content-Aware Fill, batch tools and every filter kind.
- **Per-call overhead**: one `powershell.exe` per op (~0.3–1 s). Composite tools could batch several ops into one script the way `execute_plan` does.
- **Fonts**: plans use Google Fonts pairings; a font-install check before planning would avoid ArialMT fallbacks.

## 4. Not available through Photoshop scripting (documented, not faked)

Liquify, Perspective Warp, Lens Blur (depth map dialog), Color Lookup LUT loading, brush preset creation and management,
Neural Filters, in-app Generative Fill / Expand and the Remove Tool, Camera Raw denoise. Each related tool returns
`UNSUPPORTED_OPERATION` (or uses Firefly Services when configured) with an alternative ([LIMITATIONS.md](LIMITATIONS.md)).

## 5. Intentionally not followed

- **UXP plugin + WebSocket bridge** (an earlier prototype of this project): needs a panel open inside Photoshop, a listening
  socket and a token handshake, plus a separate install. COM `DoJavaScriptFile` / AppleScript `do javascript file` are the
  documented, extension-free routes; background jobs give non-blocking behaviour without a panel.
- **`photoshop_` prefix on every tool**: MCP clients already namespace tools by server.
