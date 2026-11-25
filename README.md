# Photoshop MCP

[![CI](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/axcel-blade/Photoshop-MCP?sort=semver)](https://github.com/axcel-blade/Photoshop-MCP/releases/latest)
[![License: MIT](https://img.shields.io/github/license/axcel-blade/Photoshop-MCP)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF)](https://modelcontextprotocol.io)
[![Installer](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/installer.yml/badge.svg)](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/installer.yml)
[![Docker](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/docker.yml/badge.svg)](https://github.com/axcel-blade/Photoshop-MCP/actions/workflows/docker.yml)
[![Docs](https://img.shields.io/badge/docs-site-31A8FF)](https://axcel-blade.github.io/Photoshop-MCP/)

An MCP server that lets AI assistants (Claude Desktop, ChatGPT, any MCP client) work in **Adobe Photoshop**:
documents, layers, live text, shapes, selections and masks, adjustment layers, smart filters, layer styles,
retouching and compositing, actions, batch processing and export. Its design engine turns natural-language
briefs (posters, social posts, product ads, campaigns, brand work) into **layered, editable PSDs**, and its
workflow engine plans and runs multi-step photo briefs.

```
AI client (Claude Desktop: stdio · ChatGPT: HTTPS)
        │  MCP
        ▼
MCP server ── 296 tools, 10 resources, 8 prompts, background jobs, validation, auth
        │
        ▼
Design + workflow engines ── brief analysis → plan JSON → validation → compile; brief → tool-step workflows
        │
        ▼
PhotoshopBridge ── allowlisted ops · serial queue · timeouts · typed errors
        │  Windows: PowerShell → COM DoJavaScriptFile
        │  macOS:   osascript → AppleScript do javascript file
        ▼
Adobe Photoshop ── ExtendScript + Action Manager ops (photoshop-scripts/*.jsx)
```

- **Nothing to install inside Photoshop:** there is no plugin or panel. Each call runs one allowlisted ExtendScript op.
- **Clear about its sources:** every result says whether Photoshop, the mock adapter or the server produced it. Features Photoshop does not expose to scripts (Liquify, Lens Blur, in-app Generative Fill, Neural Filters, brush presets…) return `unsupported` with an alternative rather than a fake result.
- **Non-destructive defaults:** adjustment layers, smart filters, masks and working-copy layers.
- **Safe:** Zod validation, an op allowlist with no way to run arbitrary scripts, a path sandbox, no silent overwrites, and `confirm: true` for destructive operations.

## Status

| Area | State |
|---|---|
| MCP server (stdio + Streamable HTTP), 296 tools, 10 resources, 8 prompts, background jobs | Implemented and covered by automated tests (61 Vitest tests plus the stdio, HTTP and resources e2e suites, using the mock adapter) |
| Design engine (planner, templates, styles, auto layout, validator, compiler, composition analysis) and workflow engine | Implemented and covered by automated tests |
| Bridge (queue, timeouts, allowlist, error mapping, COM and AppleScript runners) | Implemented; Windows COM verified with Photoshop |
| ExtendScript operations in a real Photoshop | `pnpm test:integration` passed 36/36 against Photoshop 2027 (v28.0.0) on Windows; see [docs/TEST_REPORT.md](docs/TEST_REPORT.md) |
| macOS (AppleScript) | Implemented; not yet run on a Mac |
| ChatGPT remote connection | Transport implemented and tested locally; not verified against ChatGPT |

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for details.

## Quick start

Requirements: **Windows 10/11 or macOS 12+**, Node.js 20+, pnpm (via Corepack), and an ExtendScript-capable Adobe Photoshop.

### One-line install

This installs the latest release and registers it with every MCP client it finds: Claude Desktop, Claude Code,
Cursor, Windsurf, VS Code (Copilot), Cline, Roo Code, Gemini CLI and Codex. Existing configs are merged and backed up first.
To skip client registration, pass `-NoClients` / `--no-clients` or set `PHOTOSHOP_MCP_CONFIGURE_CLIENTS=0`.
Read the scripts before running them:
[install.ps1](installers/windows/install.ps1), [install.sh](installers/macos/install.sh).

```powershell
irm https://axcel-blade.github.io/Photoshop-MCP/install.ps1 | iex
```

```bash
curl -fsSL https://axcel-blade.github.io/Photoshop-MCP/install.sh | bash
```

Settings are in [docs/CONFIGURATION.md](docs/CONFIGURATION.md). To build from source instead, follow the steps for your platform below.

### Windows (from source)

```powershell
corepack enable
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ConfigureClaude
powershell -ExecutionPolicy Bypass -File scripts\diagnostics.ps1
```

### macOS (from source)

```bash
corepack enable
pnpm install
pnpm build
chmod +x scripts/*.sh
./scripts/install.sh --configure-claude
./scripts/diagnostics.sh
```

On first use, macOS may ask you to let Terminal or Node control Photoshop
(System Settings → Privacy & Security → Automation).

Start Photoshop, fully quit and reopen your AI client, then ask: *"Check the Photoshop status, then create a 1080×1080
Instagram post that says 'CREATE WITHOUT LIMITS' with a bold gradient background and save it as PSD and PNG."*

ChatGPT needs a remote HTTPS endpoint; see [INSTALLATION.md §6](docs/INSTALLATION.md#6-chatgpt-remote-https).

## Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install dependencies (pnpm only; no npm or yarn lockfiles) |
| `pnpm dev` | Run from source with reload |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Start over stdio. Use `pnpm start:http` for HTTP or `pnpm start:mock` for the mock adapter |
| `pnpm test` | Automated tests (mock adapter; Photoshop not needed) |
| `pnpm test:integration` | Integration run against the real Photoshop |
| `pnpm test:e2e` / `test:e2e:http` / `test:e2e:resources` | End-to-end tests of the built server over stdio, HTTP, and live resources and prompts |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm docs:tools` | Regenerate [docs/TOOLS.md](docs/TOOLS.md) from the tool registry |
| `node scripts/pack-release.mjs` | Build the release package the installers download |
| `pnpm --dir site dev` | Run the docs site locally (renders `docs/*.md`) |
| `docker compose -f site/docker-compose.yml up --build -d` | Serve the docs site in Docker (nginx) at http://localhost:8080 (set `SITE_PORT` to change the port); use `docker-compose.dev.yml` for hot reload |

## Documentation

- **Docs site: https://axcel-blade.github.io/Photoshop-MCP/**
- [Installation (Windows & macOS)](docs/INSTALLATION.md) · [Configuration](docs/CONFIGURATION.md) · [Connecting clients](docs/CLIENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Supported features](docs/SUPPORTED_FEATURES.md) · [API reference](docs/API_REFERENCE.md) (results, errors, jobs, resources, prompts)
- [Tool reference](docs/TOOLS.md) (generated) · [Example prompts](docs/EXAMPLES.md)
- [UI design: auto layout, components, tokens](docs/UI_DESIGN.md)
- [Design plan schema](docs/DESIGN_SCHEMA.md) · [Coordinate convention](docs/COORDINATES.md)
- [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Test report](docs/TEST_REPORT.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Development & extension guide](docs/DEVELOPMENT.md) · [Known limitations](docs/LIMITATIONS.md) · [Gap analysis](docs/GAP_ANALYSIS.md)
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md) · [Support](SUPPORT.md) · [Changelog](CHANGELOG.md)

## License

MIT; see [LICENSE](LICENSE). This project is not affiliated with Adobe. Adobe Photoshop is a trademark of Adobe Inc.
