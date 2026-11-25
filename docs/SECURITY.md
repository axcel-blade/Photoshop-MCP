# Security

Driving Photoshop from an AI agent means an untrusted model chooses tool calls. The design limits what any call can do.

## Threats and controls

| Threat | Control |
|---|---|
| Arbitrary code execution in Photoshop | The bridge runs only the 88 allowlisted ops in `BRIDGE_OPS` (`src/photoshop/bridge/commands.ts`); `PhotoshopBridge.run` refuses anything else with `UNSUPPORTED_OPERATION` before a script is built. Scripts are generated from the fixed `photoshop-scripts/*.jsx` library plus `MCP.main(<JSON literal>)`; client data is never evaluated as code, and there is no `eval` / raw-JSX / raw-descriptor tool. `run_action` (recorded actions can do anything) requires `confirm: true`. |
| Remote control of Photoshop | There is no listening socket on the Photoshop side. The bridge is a local child process (`powershell.exe` → COM, or `osascript`) started by the server. |
| HTTP transport exposure | Loopback by default; non-loopback requires `MCP_AUTH_TOKEN` (bearer) or `MCP_SECRET_PATH` (≥ 24 chars). DNS-rebinding protection on loopback. Request size limit. |
| Path traversal / arbitrary file access | `PathPolicy`: every path must resolve inside `ALLOWED_PATHS`; blocks `..`, other drives, UNC/device paths, URLs, NUL bytes and symlink/junction escapes; enforces extensions per format. |
| Silent data loss | Never overwrites: `FILE_EXISTS` unless `overwrite: true`. Destructive operations (delete layers, flatten, merge, rasterize, apply/delete mask, crop, color-mode change, close without saving, run action, convert text to shape) require `confirm: true`. Retouch tools work on copies / adjustment layers. Batch tools never modify source files (open → export copy → close without saving). |
| Resource exhaustion | Bounded op queue, `MAX_BATCH_FILES`, per-call timeouts (`PHOTOSHOP_TIMEOUT_MS`, `PHOTOSHOP_JOB_TIMEOUT_MS`); a hung call's runner process is killed. |
| Fabricated success | Results are labelled by source (`photoshop` / `mock` / `server`); only an `ok: true` envelope written by Photoshop counts as success; exports stat the written file and warn if nothing is on disk. |
| Secret leakage | Logs redact keys matching token / secret / password / api key / authorization. Provider keys are read from the environment only and never returned by tools. |

## Guidance for operators

- Keep `ALLOWED_PATHS` narrow (a dedicated work folder).
- When tunnelling for ChatGPT, use a fresh `MCP_SECRET_PATH`, share the URL with no one, and stop the tunnel afterwards.
- Review destructive confirmations; MCP clients show the `destructiveHint` annotation.
- Recorded actions run with `run_action` can do anything Photoshop can; only run actions you trust.

## Internet images

Image search and downloads (see [IMAGE_ASSETS](IMAGE_ASSETS.md)) only fetch content. Files are accepted only if their bytes identify them as images; executables and scripted SVGs are rejected. Downloads by search id must stay on the provider's own image hosts. Other URLs must use http(s), and every host and redirect is resolved and refused if it points to a loopback, private, link-local or reserved address (SSRF protection; `ALLOW_PRIVATE_DOWNLOADS=true` turns it off). Sizes are capped by bytes and by pixels. File names are sanitized and paths stay inside the sandbox. Provider API keys are sent only to their own API host. Google Images results come only through SerpApi or the Custom Search JSON API, never by scraping, and are marked as having unverified licences. Paid or premium results are excluded, and the server records every asset's licence and attribution.

## AI providers

External services are used **only** when you set their credentials, and only by tools whose name says so (`generative_fill`, `generative_expand`, `generate_*`, `ai_replace_object`). They upload a JPEG of the canvas (and a mask) to that service.

| Provider | Variables | Endpoints |
|---|---|---|
| Adobe Firefly Services | `FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET` (server-to-server OAuth) | `ims-na1.adobelogin.com/ims/token/v3`, `firefly-api.adobe.io/v2/storage/image`, `/v3/images/generate|fill|expand` |
| remove.bg | `REMOVE_BG_API_KEY` | `api.remove.bg/v1.0/removebg` |

The provider code is covered by unit tests with mocked HTTP; it has **not** been exercised against the live services from this repository.

## Reporting

See [SECURITY.md](../SECURITY.md) in the repository root.
