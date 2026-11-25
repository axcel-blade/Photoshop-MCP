# Configuration

Settings are environment variables. The server loads `.env` from the project root at startup (copy `.env.example`); variables set in the MCP client's `env` block win.

| Variable | Default | Meaning |
|---|---|---|
| `PHOTOSHOP_ADAPTER` | `auto` | `auto` (COM on Windows, AppleScript on macOS), `com`, `applescript`, or `mock` (also `--mock`) |
| `PHOTOSHOP_TIMEOUT_MS` | `60000` | Timeout per bridge call. Design plans use at least 120 s |
| `PHOTOSHOP_JOB_TIMEOUT_MS` | `900000` | Timeout per bridge call inside a background job (`background: true`) |
| `PHOTOSHOP_AUTO_LAUNCH` | `true` | Start Photoshop on the first call if it is not running (`false` to fail with `PHOTOSHOP_NOT_RUNNING`) |
| `ALLOWED_PATHS` | `output;%USERPROFILE%\Documents\PhotoshopMCP` | `;`-separated sandbox roots; relative paths resolve against the first |
| `MAX_BATCH_FILES` | `200` | Max files per batch tool |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` (also `--transport http`) |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `3333` | HTTP port |
| `MCP_AUTH_TOKEN` | – | Bearer token for `/mcp`. Required off-loopback unless `MCP_SECRET_PATH` is set |
| `MCP_SECRET_PATH` | – | Also serve at `/mcp/<secret>` for connector UIs that cannot send headers (≥ 24 URL-safe chars; `scripts\new-token.ps1`) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_DIR` | – | Also write JSON logs to this folder (e.g. `logs`) |
| `FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET` | – | Adobe Firefly Services credentials (optional) |
| `REMOVE_BG_API_KEY` | – | remove.bg key (optional) |

## Command-line flags

| Flag | Effect |
|---|---|
| `--transport http` | Streamable HTTP instead of stdio |
| `--mock` | Mock Photoshop (results labelled `source: "mock"`) |
| `--version` | Print name and version |

## MCP clients the installers configure

`installers/windows/install.ps1` and `installers/macos/install.sh` merge a `photoshop` server entry (with a backup) into
Claude Desktop, Cursor, Windsurf and Gemini CLI configs, and register it with the Claude Code and Codex CLIs when they are on `PATH`.
The entry sets `PHOTOSHOP_ADAPTER=com` (Windows) or `applescript` (macOS). Set `PHOTOSHOP_MCP_CONFIGURE_CLIENTS=0` (or `-NoClients` / `--no-clients`)
to only print the snippet. See [CLIENTS.md](CLIENTS.md) for manual setup.
