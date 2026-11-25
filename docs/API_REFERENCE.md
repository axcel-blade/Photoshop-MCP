# API Reference

## MCP surface

- **Tools:** 294 — full per-tool reference with input schemas in [TOOLS.md](TOOLS.md) (`pnpm docs:tools` regenerates it).
- **Result envelope:** `{ ok, tool, source: "photoshop"|"mock"|"server", data, warnings }`; errors `{ ok:false, tool, error:{ code, message, details } }` with `isError: true`.
- **Conventions:** coordinates and sizes are **document pixels**, origin top-left. Layers: `{ id }` (stable, preferred) or `{ name }` (first match top-down); omitted = active layer. Documents: `{ id }` / `{ name }`; omitted = active document. Colors are hex. Opacity 0–100.

### Resources

| URI | Content |
|---|---|
| `photoshop://status` | Server info, bridge adapter, Photoshop version, queue, recent operations, allowed paths |
| `photoshop://version` | Photoshop and ExtendScript versions (live) |
| `photoshop://documents` | Open documents (live) |
| `photoshop://documents/active` | Active document info + selection (live) |
| `photoshop://documents/active/layers` | Layer tree (live) |
| `photoshop://catalog` | All tools by module with status, JSX bridge ops, limitations |
| `photoshop://capabilities/ai` | Photoshop AI feature status + configured providers |
| `photoshop://executions` | Workflow / batch executions |
| `photoshop://workflows/templates` | Built-in workflow templates |
| `photoshop://design/presets` | Canvas presets and art-direction styles |

Design-engine tools (`plan_design`, `generate_design`, `create_*`, `revise_design`, `critique_design`, UI tools) are described in [DESIGN_SCHEMA.md](DESIGN_SCHEMA.md) and [UI_DESIGN.md](UI_DESIGN.md); background jobs in [GAP_ANALYSIS.md](GAP_ANALYSIS.md#background-jobs).

### Prompts

`professional_photo_retouch`, `product_advertising`, `poster_creation`, `social_media_design`, `background_replacement`, `image_restoration`, `cinematic_compositing`, `ecommerce_preparation` — each a step-by-step tool plan ending with the verification and delivery rules.

## Workflows

```json
{
  "name": "hero-variants",
  "steps": [
    { "id": "doc", "tool": "create_document", "args": { "width": 1920, "height": 1080 } },
    { "id": "title", "tool": "add_text", "args": { "text": "{{vars.headline}}", "x": 960, "y": 540, "size": 120, "alignment": "center" } },
    { "tool": "create_text_shadow", "args": { "layer": { "id": "{{steps.title.data.layer.id}}" } } },
    { "tool": "export_png", "args": { "path": "designs/hero.png" }, "continueOnError": false }
  ]
}
```

- `create_automation_workflow { workflow }` stores it in `output/workflows/<name>.json`.
- `execute_workflow { name | template | steps | brief, vars, background }` runs it. A placeholder that is the whole string keeps its type (numeric ids stay numbers).
- `plan_workflow { brief, assets }` returns the plan without running it.
- `get_execution_status { id }` / `cancel_execution { id }`. Batch tools and `execute_workflow` accept `background: true`.

## Bridge (server ⇄ Photoshop)

There is no network protocol. For each op the bridge generates one ExtendScript file and runs it:

| Platform | Runner | Entry point |
|---|---|---|
| Windows | `powershell.exe -File photoshop-scripts/run-jsx.ps1 -ScriptPath <jsx> -ResultPath <json>` | COM `Photoshop.Application.DoJavaScriptFile` |
| macOS | `osascript photoshop-scripts/run-jsx.applescript <jsx> <json> <noLaunch>` | `do javascript file` |

The script is `bootstrap.jsx` + every op module + `MCP.main({"op": "<op>", "args": {…}}, "<result path>")`. `MCP.main` writes:

```json
{ "ok": true, "data": { }, "warnings": [], "document": "Poster.psd" }
{ "ok": false, "error": { "code": "PHOTOSHOP_ERROR", "message": "…", "line": 123, "details": {} }, "warnings": [] }
```

### Bridge ops

The complete list lives in `src/photoshop/bridge/commands.ts` (`BRIDGE_OPS`, 88 entries): `ps.*` (info, history, undo, redo, activeTool, preview, analyze), `doc.*` (create, open, close, save, saveAs, info, list, activate, resizeImage, resizeCanvas, mode, bitDepth, flatten, duplicate, crop, rotate, flip, trim, colors), `layer.*` (list, info, create, delete, duplicate, rename, translate, arrange, merge, mergeVisible, group, ungroup, props, link, rasterize, smartObject, select, transform, effects, clearEffects, fill, clip, replaceContents, fromSelection), `text.*`, `shape.*`, `fill.*`, `image.place`, `select.*`, `mask.*`, `adjust.layer`, `filter.apply`, `edit.contentAwareFill`, `edit.fillSelection`, `action.list`, `action.run`, and the design-plan ops `execute_plan`, `update_elements`, `check_fonts`.

## Embedding the server

```ts
import { loadConfig } from "./src/config/index.js";
import { createContext, createServer } from "./src/server.js";
const config = loadConfig();
const ctx = createContext(config);         // or createContext(config, new MockAdapter())
const server = createServer(ctx);          // McpServer; connect any SDK transport
```

`callTool(name, args, ctx)` (from `tools/registry.ts`) invokes a validated tool in-process.
