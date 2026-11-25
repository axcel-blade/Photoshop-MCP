# Photoshop MCP

Let AI assistants (Claude, ChatGPT, any MCP client) operate **Adobe Photoshop** through validated, structured tools: documents, layers, live text, shapes, selections and masks, adjustment layers, smart filters, layer styles, retouching and compositing, actions, batch processing and export — plus an AI design engine that turns briefs into layered, editable designs, and a workflow engine that plans and runs multi-step photo briefs.

```
MCP client ──stdio / HTTP──► MCP server (Node) ──► PhotoshopBridge ──► Windows: COM Photoshop.Application.DoJavaScriptFile
                                                                     └► macOS:   AppleScript do javascript file
                                                                          ──► photoshop-scripts/*.jsx (ExtendScript + Action Manager)
```

- **296 tools** in 19 modules ([docs/TOOLS.md](docs/TOOLS.md)), 10 resources, 8 prompts.
- **Nothing to install inside Photoshop:** no plugin or panel. Each call runs one allowlisted ExtendScript op through Photoshop's documented scripting entry points.
- **Honest by design:** every result says whether Photoshop (`source: "photoshop"`), the mock adapter, or the server produced it. Features Photoshop does not expose to scripts (Liquify, Lens Blur, in-app Generative Fill, Neural Filters, brush presets…) are reported as `unsupported` with an alternative instead of being faked.
- **Non-destructive defaults:** adjustment layers, smart filters, masks and working-copy layers.
- **Safe:** Zod validation, an op allowlist with no "run arbitrary script" entry point, path sandbox, no silent overwrites, `confirm: true` for destructive operations.

## Quick start

Windows (PowerShell):

```powershell
irm https://axcel-blade.github.io/Photoshop-MCP/install.ps1 | iex
```

macOS (Terminal):

```bash
curl -fsSL https://axcel-blade.github.io/Photoshop-MCP/install.sh | bash
```

The installer downloads the latest release, installs it with **pnpm** and registers the server with Claude Desktop, Claude Code, Cursor, Windsurf, Gemini CLI and Codex. Start Photoshop once, restart your AI client, and ask: *"Check the Photoshop status, then create a 1080×1080 poster that says 'Summer Sale'."*

From source:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ConfigureClaude
```

Full guide: [docs/INSTALLATION.md](docs/INSTALLATION.md). ChatGPT needs a remote HTTPS endpoint — see [INSTALLATION.md §6](docs/INSTALLATION.md#6-chatgpt-remote-https).

## Requirements

| | Version | Verified here |
|---|---|---|
| Windows | 10 / 11 (COM bridge) | Windows 11 |
| macOS | 12+ (AppleScript bridge) | not yet run on a Mac |
| Node.js | 20 LTS or newer | yes |
| pnpm | 10.x | 10.18.0 |
| Photoshop | ExtendScript-capable release | Photoshop 2027 (v28.0.0) |

## Repository layout

Same single-package layout as [Illustrator-MCP](https://github.com/axcel-blade/Illustrator-MCP):

| Path | What |
|---|---|
| `src/index.ts`, `src/server.ts` | Entry point and MCP server assembly |
| `src/config` | Environment / `.env` configuration |
| `src/mcp/tools`, `src/mcp/resources`, `src/mcp/prompts` | 296 tools, 10 resources, 8 prompts |
| `src/photoshop/bridge` | `PhotoshopBridge`: op allowlist, queue, script builder, COM / AppleScript / mock adapters, preview and pixel-stat decoding |
| `photoshop-scripts/` | ExtendScript op library (`bootstrap.jsx` with the batchPlay-JSON → ActionDescriptor converter `MCP.toDesc`), `run-jsx.ps1`, `run-jsx.applescript` |
| `src/design-engine`, `src/schemas`, `data/` | Design planner, templates, validator, compiler, composition analysis, UI auto layout, design knowledge |
| `src/workflow-engine` | Natural-language brief → tool-step workflows |
| `src/jobs`, `src/ai` | Background jobs and executions; Adobe Firefly Services + remove.bg providers |
| `src/utils`, `src/transport` | Errors, colors, logger, path policy, image utils; Streamable HTTP transport |
| `tests/` | Vitest unit + security suites (mock), built-server e2e (stdio / HTTP / resources), live Photoshop integration runner |
| `scripts/` | install, build, launch, diagnostics, bridge smoke test, integration test, new-token, docs generator, release packing |
| `installers/`, `site/` | One-line installers (Windows, macOS) and the Astro docs site |
| `.github/` | CI, CD, release, installer, Docker and Pages workflows; issue / PR templates |
| `docs/`, `examples/` | Documentation and client / plan / workflow examples |

## Status

| Area | State |
|---|---|
| Server, tools, validation, security, design and workflow engines | typecheck and lint clean; **58 Vitest tests** and the 3 e2e suites pass (mock adapter) |
| Real Photoshop (Windows, COM) | **`pnpm test:integration` passed 36/36** against Photoshop 2027 (v28.0.0) — see [docs/TEST_REPORT.md](docs/TEST_REPORT.md) |
| macOS (AppleScript) | Implemented, not yet run on a Mac |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Installation](docs/INSTALLATION.md) · [Clients](docs/CLIENTS.md) · [Configuration](docs/CONFIGURATION.md) · [Examples](docs/EXAMPLES.md) · [Supported features](docs/SUPPORTED_FEATURES.md) · [Tools](docs/TOOLS.md) · [API reference](docs/API_REFERENCE.md) · [Coordinates](docs/COORDINATES.md) · [Design schema](docs/DESIGN_SCHEMA.md) · [UI design](docs/UI_DESIGN.md) · [Limitations](docs/LIMITATIONS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Development](docs/DEVELOPMENT.md) · [Testing](docs/TESTING.md) · [Test report](docs/TEST_REPORT.md) · [Gap analysis](docs/GAP_ANALYSIS.md)

## License

MIT — see [LICENSE](LICENSE). Not affiliated with Adobe. Adobe Photoshop is a trademark of Adobe Inc.
