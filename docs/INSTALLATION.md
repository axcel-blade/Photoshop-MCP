# Installation

## 1. Requirements

| Component | Version | Notes |
|---|---|---|
| Windows | 10 or 11 (x64) | Bridge uses COM (`Photoshop.Application.DoJavaScriptFile`) |
| macOS | 12+ (Intel or Apple Silicon) | Bridge uses AppleScript (`do javascript file`) |
| Node.js | 20 LTS or newer | `node -v` |
| pnpm | 10.x (pinned via `packageManager` in package.json) | Installed with Corepack |
| Adobe Photoshop | tested with Photoshop 2027 (v28.0) | Any version with ExtendScript and Select Subject should work; older versions are untested |
| Claude Desktop | current | stdio transport |
| ChatGPT | plan with Developer Mode | remote HTTPS transport; see §6 |

Nothing is installed into Photoshop: no plugin, panel or extension.

## 2. One-line installer (release build)

Windows (PowerShell):

```powershell
irm https://axcel-blade.github.io/Photoshop-MCP/install.ps1 | iex
```

macOS (Terminal):

```bash
curl -fsSL https://axcel-blade.github.io/Photoshop-MCP/install.sh | bash
```

The installers download the latest release ZIP (built by `scripts/pack-release.mjs`), verify its SHA-256, install production
dependencies with pnpm into `%LOCALAPPDATA%\PhotoshopMCP` / `~/Library/Application Support/PhotoshopMCP`, and register the
server with your MCP clients (see [CONFIGURATION.md](CONFIGURATION.md#mcp-clients-the-installers-configure)). Read a script before piping it to a shell.

## 3. From source (pnpm only)

Do not run `npm install` or `yarn`; `scripts/check-deps.ps1` warns about their lockfiles and CI rejects them.

```powershell
corepack enable
```

```powershell
corepack prepare pnpm@10.18.0 --activate
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

`scripts\install.ps1` runs `pnpm install --frozen-lockfile` and `pnpm build`, creates `.env` from `.env.example`, creates
`output\` and `%USERPROFILE%\Documents\PhotoshopMCP\` (the default allowed folders) and prints the Claude Desktop snippet
(`-ConfigureClaude` writes it, with a backup). macOS: `./scripts/install.sh`. The server entry point is `dist\index.js`.

## 4. Photoshop setup

### Windows

1. Install Photoshop through Creative Cloud (default path `C:\Program Files\Adobe\Adobe Photoshop <year>\Photoshop.exe`) and **start it once** as the
   same Windows user who runs the MCP server. This registers the `Photoshop.Application` COM class.
2. Verify: `powershell -ExecutionPolicy Bypass -File scripts\diagnostics.ps1` shows the install, its version and the COM ProgID.
3. Verify scripting end to end: `powershell -ExecutionPolicy Bypass -File scripts\test-bridge.ps1` runs the read-only `ps.info` op inside Photoshop
   and prints the name, `photoshopVersion` and number of open documents.
4. Optional: `PHOTOSHOP_AUTO_LAUNCH=false` makes tools fail with `PHOTOSHOP_NOT_RUNNING` instead of launching Photoshop.

### macOS

1. Install Photoshop through Creative Cloud under `/Applications`.
2. Start Photoshop once, then grant **Automation** permission when prompted so Terminal / Node / Claude can control it
   (System Settings → Privacy & Security → Automation).
3. Verify: `chmod +x scripts/*.sh && ./scripts/diagnostics.sh`, then `./scripts/test-bridge.sh`.

Close modal dialogs in Photoshop before using the tools: a modal dialog blocks script execution and causes `BRIDGE_TIMEOUT`.

## 5. Claude Desktop (stdio)

Edit `%APPDATA%\Claude\claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "node",
      "args": ["C:\\path\\to\\Photoshop-MCP\\dist\\index.js"],
      "env": {
        "PHOTOSHOP_ADAPTER": "auto",
        "ALLOWED_PATHS": "C:\\Users\\you\\Documents\\PhotoshopMCP;C:\\path\\to\\Photoshop-MCP\\output"
      }
    }
  }
}
```

Fully quit Claude Desktop (tray icon → Quit) and reopen it. Other clients: [CLIENTS.md](CLIENTS.md).

## 6. ChatGPT (remote HTTPS)

ChatGPT does not launch local stdio servers; it connects to remote MCP servers over HTTPS (Streamable HTTP).

1. Generate a secret: `powershell -File scripts\new-token.ps1`.
2. Start the HTTP transport:

   ```powershell
   $env:MCP_TRANSPORT="http"; $env:MCP_SECRET_PATH="<secret>"; node dist\index.js
   ```

   It listens on `http://127.0.0.1:3333/mcp/<secret>` (or `/mcp` with `Authorization: Bearer $MCP_AUTH_TOKEN`).
3. Expose it with an HTTPS tunnel you control, e.g. `cloudflared tunnel --url http://127.0.0.1:3333`.
4. In ChatGPT add a connector with URL `https://<tunnel-host>/mcp/<secret>`.

Treat the tunnel URL as a password: anyone with it can drive your Photoshop within the allowed folders. Stop the tunnel when done.

## 7. Verify

In the MCP client: *"Call photoshop_status."* Expect the adapter (`com` / `applescript`), Photoshop's version and the number of open documents.
Without Photoshop: `node dist\index.js --mock` (results are labelled `source: "mock"`).

Then try:

> Create a 1200×800 document, add a teal rounded rectangle and the text "Hello Photoshop", capture a preview, and export it as output\hello.png.

Scripted live check: `pnpm test:integration` ([TESTING.md](TESTING.md)). Problems: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
