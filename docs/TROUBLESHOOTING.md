# Troubleshooting

Start with diagnostics, then the bridge smoke test:

- Windows: `powershell -ExecutionPolicy Bypass -File scripts\diagnostics.ps1`, then `scripts\test-bridge.ps1`
- macOS: `./scripts/diagnostics.sh`, then `./scripts/test-bridge.sh`

In an MCP client, the `photoshop_status` tool and the `photoshop://status` resource show the adapter, Photoshop's version, the queue and recent operations.
Server logs are JSON lines on stderr (Claude Desktop: `%APPDATA%\Claude\logs\mcp-server-photoshop.log`); set `LOG_DIR=logs` to also write files and `LOG_LEVEL=debug` for per-op timing.

| Symptom | Cause | Fix |
|---|---|---|
| `PHOTOSHOP_NOT_INSTALLED` / `REGDB_E_CLASSNOTREG` | `Photoshop.Application` COM class not registered (Windows) or Photoshop.app not found (macOS) | Install Photoshop, launch it once as the same user; repair via Creative Cloud if needed |
| `PHOTOSHOP_NOT_RUNNING` | `PHOTOSHOP_AUTO_LAUNCH=false` | Start Photoshop or enable auto-launch |
| `BRIDGE_TIMEOUT` | Modal dialog open, first launch still loading, or a very large operation (filter on a 100 MP image) | Dismiss dialogs; retry after Photoshop finishes loading; raise `PHOTOSHOP_TIMEOUT_MS` or use `background: true`. Check `get_history` before retrying — the op may have completed |
| `BRIDGE_UNAVAILABLE` | No adapter for this OS, or `powershell.exe` / `osascript` could not start | Run on Windows or macOS; check that PowerShell is on `PATH` |
| `PHOTOSHOP_SCRIPT_ERROR` with Photoshop's message | The op failed inside Photoshop (e.g. `General Photoshop error occurred` from an Action Manager call) | The message and JSX line are in `error.details`. Record the action and *Copy as JavaScript* to compare descriptors; please open an issue |
| `NO_ACTIVE_DOCUMENT` | No document open | `create_document` or `open_document` first |
| `LAYER_NOT_FOUND` / `DOCUMENT_NOT_FOUND` | Target id or name not found | `list_layers` / `list_documents`; ids are stable, names are case-sensitive. Some filters convert a layer to a smart object and its id changes (the result says so) |
| `PATH_NOT_ALLOWED` | Path outside the sandbox | Use a relative path (resolves into `output/`) or add the folder to `ALLOWED_PATHS` |
| `FILE_EXISTS` | Overwrite protection | Ask the user, then pass `overwrite: true` or pick a new name |
| `CONFIRMATION_REQUIRED` | Destructive tool | Ask the user and call again with `confirm: true` |
| `UNSUPPORTED_OPERATION` | Feature not available to scripting | `error.details.alternative` names a workaround ([LIMITATIONS.md](LIMITATIONS.md)) |
| `PROVIDER_NOT_CONFIGURED` | AI provider tool without credentials | Set `FIREFLY_CLIENT_ID`/`FIREFLY_CLIENT_SECRET` or `REMOVE_BG_API_KEY` |
| Text uses Arial instead of my font | Font not installed or not a PostScript name | Fonts are PostScript names (`Montserrat-Bold`). Missing fonts fall back to ArialMT and the result warns |
| Results say `source: "mock"` | `PHOTOSHOP_ADAPTER=mock` or `--mock` | Remove it to use Photoshop |
| Claude Desktop shows no tools | Bad path in config, or Claude not restarted | Use an absolute path to `dist/index.js`, run `pnpm build`, fully quit and reopen Claude |
| macOS Automation prompt / silent fail | Host app not allowed to control Photoshop | System Settings → Privacy & Security → Automation — enable for Terminal, `node` and/or Claude |
| ChatGPT "connector failed" | Tunnel down, wrong secret path | Check `https://<host>/healthz` and the full `/mcp/<secret>` URL |
| `401` / `403` from HTTP | Missing token / Host header not allowed (DNS-rebinding protection) | Verify `MCP_AUTH_TOKEN` or URL; connect via `127.0.0.1:<port>` or `localhost:<port>` |
| PowerShell blocked by execution policy | Machine policy | Runners are launched with `-ExecutionPolicy Bypass`; if a GPO forbids it, sign the scripts or ask IT |
