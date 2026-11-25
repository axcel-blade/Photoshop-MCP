# MCP Clients

The server speaks MCP over **stdio** (local clients that launch a process) and **Streamable HTTP** (remote clients).
The one-line installers configure the clients below automatically; this page is for manual setup.

| Client | Transport | Config |
|---|---|---|
| Claude Desktop | stdio | `%APPDATA%\Claude\claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`) — see `examples/claude_desktop_config.json` / `claude_desktop_config.macos.json`, or `scripts\install.ps1 -ConfigureClaude` |
| Claude Code | stdio | `claude mcp add --scope user photoshop -e PHOTOSHOP_ADAPTER=auto -- node C:\path\to\Photoshop-MCP\dist\index.js` (or a project `.mcp.json`, see `examples/mcp.json`) |
| VS Code (Copilot agent mode) | stdio | `.vscode/mcp.json` — see `examples/vscode.mcp.json` (`servers` key, `type: "stdio"`) |
| Cursor | stdio | `~/.cursor/mcp.json` or project `.cursor/mcp.json` — see `examples/cursor.mcp.json` |
| Windsurf | stdio | `~/.codeium/windsurf/mcp_config.json`, same `mcpServers` shape as Claude Desktop |
| Gemini CLI | stdio | `~/.gemini/settings.json`, `mcpServers` key |
| Codex CLI | stdio | `codex mcp add photoshop --env PHOTOSHOP_ADAPTER=auto -- node <repo>\dist\index.js` |
| ChatGPT (connectors / developer mode) | **remote HTTPS** only | Run `--transport http` with `MCP_SECRET_PATH` (or `MCP_AUTH_TOKEN`), expose it through an HTTPS tunnel. See [INSTALLATION.md §6](INSTALLATION.md#6-chatgpt-remote-https). |

## Several clients at once

Each stdio client starts its own server process. That is fine: every process drives the same Photoshop through COM / AppleScript,
and each bridge serialises its own calls. Calls from two processes can interleave, so avoid editing the same document from two
clients at the same time. Alternatively run one HTTP server (`pnpm start:http`) and point every HTTP-capable client at it.

## Verifying a client

Ask the assistant to call `photoshop_status`. Expected: the adapter (`com` / `applescript`), a Photoshop version and the open documents.
