# Architecture

```
┌──────────────┐  stdio (Claude Desktop, Claude Code, Cursor, VS Code)   ┌──────────────── MCP server (Node, dist/index.js) ─────────────────┐
│ MCP client   │────────────────────────────────────────────────────────►│ transport/   stdio | Streamable HTTP (bearer / secret path)       │
│ Claude, GPT… │  HTTPS tunnel → Streamable HTTP (ChatGPT, remote)       │ mcp/tools/   296 tools → Zod validation → handlers                │
└──────────────┘                                                          │ design-engine/, workflow-engine/   briefs → plans → bridge ops   │
                                                                          │ jobs/        background jobs, executions                          │
                                                                          │ photoshop/bridge/  PhotoshopBridge: allowlist, serial queue,      │
                                                                          │              script builder, timeouts, envelope + postprocess     │
                                                                          └───────────────┬───────────────────────────────────────────────────┘
                                         Windows: powershell.exe run-jsx.ps1 ──► COM Photoshop.Application.DoJavaScriptFile
                                         macOS:   osascript run-jsx.applescript ──► do javascript file
                                                                          ┌───────────────▼──────────────── Photoshop (ExtendScript, ES3) ─────┐
                                                                          │ photoshop-scripts/bootstrap.jsx  MCP.main, JSON, MCP.toDesc       │
                                                                          │ document / layers / drawing / editing / inspect / design .jsx     │
                                                                          │ → Photoshop DOM + Action Manager (executeAction)                  │
                                                                          └────────────────────────────────────────────────────────────────────┘
```

No plugin, panel or socket runs inside Photoshop. Each bridge call is one short-lived script run.

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Transports | `src/index.ts`, `src/transport/http.ts` | stdio for local clients; Streamable HTTP (sessions, bearer / secret-path auth, DNS-rebinding protection) for remote clients. Both build the same `McpServer` from `src/server.ts`. |
| MCP layer | `src/mcp/tools/*`, `resources/`, `prompts/` | Tool registration with Zod schemas, path sandboxing, confirmation gates, structured results (`ok`, `source`, `data`, `warnings`, optional images). |
| Design engine | `src/design-engine/*`, `src/schemas/design-plan.ts`, `data/*.csv` | Brief analysis → template + style system → `DesignPlan` JSON → validation → compilation → one `execute_plan` op. Composition analysis, critique, revision diffing, plan versions, variations, UI auto layout. Pure TypeScript. |
| Workflow engine | `src/workflow-engine/*` | Natural-language photo/design briefs (product ads, thumbnails, retouch) → ordered tool steps, run with placeholders, cancellation and per-step status. |
| Jobs | `src/jobs/*` | `background: true` on long tools returns a `jobId`; jobs run one at a time with `PHOTOSHOP_JOB_TIMEOUT_MS`. |
| Bridge | `src/photoshop/bridge/bridge.ts`, `queue.ts`, `script-builder.ts`, `commands.ts`, `postprocess.ts` | Op allowlist (`BRIDGE_OPS`, 88 ops), serial `OperationQueue`, script generation, timeout watchdog, envelope parsing, error mapping, preview/pixel-stat decoding. |
| Adapters | `com-adapter.ts`, `applescript-adapter.ts`, `mock-adapter.ts`, `detect.ts` | Windows COM via `powershell.exe`; macOS via `osascript`; in-memory mock for tests. `detect.ts` finds the install and running process. |
| ExtendScript | `photoshop-scripts/*.jsx`, `run-jsx.ps1`, `run-jsx.applescript` | ES3 op library registered in `MCP.ops`; `MCP.main` dispatches and writes a JSON envelope. |

## Request flow

1. The client calls e.g. `create_rectangle {x: 100, y: 80, width: 400, height: 200, fill: "#1A2B3C"}`.
2. Zod validates; the handler sandboxes paths (`PathPolicy`), enforces `confirm` for destructive tools and calls `bridge.run("shape.rect", args)` (composite tools run several ops in a `Sequence`).
3. The bridge checks `ALLOWED_OPS`, queues the call (Photoshop is single-threaded) and builds a self-contained script: every JSX module followed by `MCP.main(<command literal>, <result path>)`. Client data is embedded only as a JSON literal, never as code.
4. The adapter writes the script to `%TEMP%/photoshop-ai-mcp/<uuid>.jsx` and runs the runner:
   Windows `run-jsx.ps1` → `Photoshop.Application.DoJavaScriptFile`; macOS `run-jsx.applescript` → `do javascript file`.
   `MCP.main` sets ruler/type units to pixels and `displayDialogs = NO`, runs the op, restores the preferences, and writes `{ok, data | error, warnings, document}` to `<uuid>.json`.
5. The bridge parses the envelope. `ok: false` becomes a typed `McpDesignError`; `ok: true` is the only path to success.
6. If the op rendered a file (`ps.preview`, `ps.analyze`), `postprocess.ts` reads it, returns base64 or pixel statistics, and deletes it.
7. The tool returns JSON with `source: "photoshop"` (or `"mock"` / `"server"`); preview tools add MCP image content.

## Action Manager descriptors

Most non-trivial edits (adjustment layers, smart filters, layer effects, Select Subject, masks, gradients) are Action Manager calls.
The JSX writes them in the batchPlay-style JSON form (`{_obj, _target, _ref, _enum, _unit}`) and `MCP.toDesc` in
`bootstrap.jsx` converts them to `ActionDescriptor` / `ActionReference` / `ActionList` before `executeAction`.
This keeps descriptors readable and lets you paste ones captured with *Actions panel → Copy as JavaScript*.

## Previews and pixel statistics

ExtendScript has no in-memory imaging API. `ps.preview` saves a downscaled JPEG/PNG copy to the temp folder;
`ps.analyze` saves a small PNG sample. Node decodes it (`decodePng`, a dependency-free PNG decoder) and computes
luminance/channel statistics used by data-driven tools such as `correct_exposure`, `auto_white_balance` and `match_colors`.

## Why a per-call COM / AppleScript host

- Windows: `Photoshop.Application.DoJavaScriptFile` is the documented COM entry point (Adobe *Photoshop Scripting Reference: VBScript*).
- macOS: `tell application id "com.adobe.Photoshop" … do javascript file` is the documented Mac entry point (*Photoshop Scripting Reference: AppleScript*).
- A short-lived PowerShell / `osascript` process per call can be killed on timeout without affecting the server.
- Cost: process start overhead per call (~0.3–1 s). Design plans are built in **one** `execute_plan` call to amortise it.
- `PHOTOSHOP_ADAPTER=auto` picks COM on `win32` and AppleScript on `darwin`.
- Nothing has to be installed into Photoshop. A UXP plugin was prototyped earlier and dropped: it needs a panel to be open and a socket bridge, and adds an install step.

## Tool catalog layers

| Layer | Example | Notes |
|---|---|---|
| Primitive | `create_rectangle` → `shape.rect` | One op. |
| Composite | `remove_background` → `layer.select`, `select.subject`, `mask.create`, `select.none` | `Sequence` records each step; a failure names the step and what already ran. |
| Data-driven | `correct_exposure` | Reads pixel statistics measured in Photoshop (`ps.analyze`) and computes settings server-side. |
| Design plan | `generate_design`, `create_poster`, `create_app_screen` | Design engine compiles a plan and sends one `execute_plan`; `revise_design` sends `update_elements`. |
| Workflow | `execute_workflow { brief }` | Workflow engine plans tool steps and runs them. |
| Unsupported / provider | `apply_liquify`, `generative_fill` | Throw `UNSUPPORTED_OPERATION` / `PROVIDER_NOT_CONFIGURED` with an alternative. |

## Verified vs. assessed

- *Verified*: anything read back from Photoshop (`inspect_document`, `list_layers`, measured pixel statistics, export files checked on disk).
- *Visual assessment*: only the AI client can provide it, by looking at the image returned by `capture_preview`, `generate_export_preview` or `critique_design`. If no image was produced, the tools say so.

## Key files

| File | Role |
|---|---|
| `src/server.ts` | Builds the context (bridge, paths, jobs, providers) and the `McpServer` |
| `src/mcp/tools/registry.ts` | `tool()` definition, catalog, `Sequence`, result envelope |
| `src/photoshop/bridge/commands.ts` | The single list of allowlisted ops (unit test checks each is implemented in `photoshop-scripts/`) |
| `src/photoshop/bridge/bridge.ts` | `PhotoshopBridge`: queue, timeouts, envelope, postprocess |
| `photoshop-scripts/bootstrap.jsx` | `MCP.main`, JSON, `MCP.toDesc`, helpers |
| `photoshop-scripts/design.jsx` | `execute_plan`, `update_elements`, `check_fonts` |
