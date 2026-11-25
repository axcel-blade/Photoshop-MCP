#!/usr/bin/env bash
# One-line installer for Photoshop MCP on macOS.
#
#   curl -fsSL https://axcel-blade.github.io/Photoshop-MCP/install.sh | bash
#
# Downloads a release from GitHub into ~/Library/Application Support/PhotoshopMCP, installs
# production dependencies with pnpm and registers it with every MCP client it finds: Claude
# Desktop, Claude Code, Cursor, Windsurf, VS Code / Insiders (Copilot), Cline, Roo Code, Gemini CLI
# and Codex. Existing configs are merged (other servers and settings kept) after a
# .photoshop-mcp.bak backup. Re-running upgrades in place and keeps .env, output/ and logs/.
#
# Options (flags, or environment variables when piped):
#   --version X.Y.Z     PHOTOSHOP_MCP_VERSION               install a specific version (default: latest)
#   --dir PATH          PHOTOSHOP_MCP_DIR                   install folder
#   --archive FILE                                            use a local release zip (offline / CI)
#   --no-clients        PHOTOSHOP_MCP_CONFIGURE_CLIENTS=0   do not touch any MCP client config
set -euo pipefail

REPO="axcel-blade/Photoshop-MCP"
VERSION="${PHOTOSHOP_MCP_VERSION:-}"
INSTALL_DIR="${PHOTOSHOP_MCP_DIR:-$HOME/Library/Application Support/PhotoshopMCP}"
ARCHIVE=""
CONFIGURE_CLIENTS=true
[[ "${PHOTOSHOP_MCP_CONFIGURE_CLIENTS:-1}" == "0" || "${PHOTOSHOP_MCP_CONFIGURE_CLAUDE:-1}" == "0" ]] && CONFIGURE_CLIENTS=false
SERVER_NAME="photoshop"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2#v}"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --no-clients|--no-claude) CONFIGURE_CLIENTS=false; shift ;;
    --configure-claude) CONFIGURE_CLIENTS=true; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ok  %s\033[0m\n' "$*"; }
die() { printf '\033[31m  !!  %s\033[0m\n' "$*" >&2; exit 1; }

if [[ "$(uname -s)" != "Darwin" && "${PHOTOSHOP_MCP_ALLOW_ANY_OS:-}" != "1" ]]; then
  die "This installer is for macOS. On Windows use: irm https://axcel-blade.github.io/Photoshop-MCP/install.ps1 | iex"
fi

# ---------------------------------------------------------------- prerequisites
step "Checking Node.js"
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required: https://nodejs.org (or: brew install node)"
NODE_VERSION="$(node -v | sed 's/^v//')"
[[ "${NODE_VERSION%%.*}" -ge 20 ]] || die "Node.js 20+ is required (found $NODE_VERSION)"
ok "node $NODE_VERSION"

step "Checking pnpm"
command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true
command -v pnpm >/dev/null 2>&1 || die "pnpm is required: run 'corepack enable' (may need sudo) or see https://pnpm.io/installation"
ok "pnpm $(pnpm -v)"
command -v unzip >/dev/null 2>&1 || die "unzip is required"

# ---------------------------------------------------------------- download
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FROM_SOURCE=false

if [[ -n "$ARCHIVE" ]]; then
  ZIP="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
  step "Using local archive $ZIP"
else
  step "Finding release"
  if [[ -n "$VERSION" ]]; then API="https://api.github.com/repos/$REPO/releases/tags/v${VERSION#v}"; else API="https://api.github.com/repos/$REPO/releases/latest"; fi
  REL="$TMP/release.json"
  # Anonymous API calls are limited to 60/hour per IP (shared CI runners and office NATs hit that).
  # Use a token when one is set; it is sent only to api.github.com.
  AUTH=()
  TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  [[ -n "$TOKEN" ]] && AUTH=(-H "Authorization: Bearer $TOKEN")
  HTTP_CODE="$(curl -sSL -w '%{http_code}' -H "Accept: application/vnd.github+json" ${AUTH[@]+"${AUTH[@]}"} -A "photoshop-mcp-installer" "$API" -o "$REL" || echo 000)"
  case "$HTTP_CODE" in
    200) ;;
    403|429) die "GitHub API rate limit reached for this network. Wait an hour, or set GITHUB_TOKEN and run again." ;;
    404) die "No release found${VERSION:+ for version $VERSION}." ;;
    *) die "Could not read $API (HTTP $HTTP_CODE)" ;;
  esac
  # Parse with Node (always present here) instead of requiring jq.
  read -r TAG ASSET_NAME ASSET_URL SUM_URL ZIPBALL < <(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const a = (r.assets || []).find((x) => /^photoshop-mcp-.*\.zip$/.test(x.name));
    const s = a && (r.assets || []).find((x) => x.name === a.name + ".sha256");
    console.log([r.tag_name, a ? a.name : "-", a ? a.browser_download_url : "-", s ? s.browser_download_url : "-", r.zipball_url].join(" "));
  ' "$REL")
  if [[ "$ASSET_NAME" == "-" ]]; then
    step "$TAG has no prebuilt package; downloading source to build locally"
    ASSET_NAME="source-$TAG.zip"; ASSET_URL="$ZIPBALL"
  fi
  ZIP="$TMP/$ASSET_NAME"
  step "Downloading $ASSET_NAME ($TAG)"
  curl -fsSL -A "photoshop-mcp-installer" "$ASSET_URL" -o "$ZIP"
  if [[ "$SUM_URL" != "-" ]]; then
    EXPECTED="$(curl -fsSL "$SUM_URL" | awk '{print $1}')"
    ACTUAL="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
    [[ "$EXPECTED" == "$ACTUAL" ]] || die "Checksum mismatch for $ASSET_NAME"
    ok "checksum verified"
  fi
fi

step "Extracting"
unzip -q "$ZIP" -d "$TMP/x"
SRC="$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "$SRC" ]] || die "Archive is empty"
if [[ ! -f "$SRC/dist/index.js" ]]; then
  [[ -f "$SRC/package.json" ]] || die "Archive contains neither dist/index.js nor package.json"
  step "Building from source (pnpm install + build)"
  (cd "$SRC" && CI=true pnpm install --frozen-lockfile --ignore-scripts && pnpm build && rm -rf node_modules) || die "Build failed"
  FROM_SOURCE=true
fi

# ---------------------------------------------------------------- install / upgrade
step "Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# Replace program files; keep user data (.env, output, logs) and node_modules for a fast reinstall.
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name .env ! -name output ! -name logs ! -name node_modules -exec rm -rf {} +
for entry in "$SRC"/* "$SRC"/.[!.]*; do
  [[ -e "$entry" ]] || continue
  name="$(basename "$entry")"
  if [[ ( "$name" == "output" || "$name" == "logs" ) && -e "$INSTALL_DIR/$name" ]]; then continue; fi
  cp -R "$entry" "$INSTALL_DIR/"
done
(cd "$INSTALL_DIR" && CI=true pnpm install --prod --frozen-lockfile --ignore-scripts) || die "pnpm install failed"
[[ -f "$INSTALL_DIR/.env" ]] || cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
mkdir -p "$HOME/Documents/PhotoshopMCP"

ENTRY="$INSTALL_DIR/dist/index.js"
# Check the build loads without starting the stdio server.
node -e 'import(require("url").pathToFileURL(process.argv[1]).href).catch((e) => { console.error(e); process.exit(1); })' "$INSTALL_DIR/dist/config/index.js" \
  || die "The installed server does not load"
INSTALLED="$(node -p 'require(process.argv[1]).version' "$INSTALL_DIR/package.json")"
ok "Photoshop MCP $INSTALLED$([[ "$FROM_SOURCE" == true ]] && echo ' (built from source)')"

# ---------------------------------------------------------------- MCP clients
# JSON configs and the Codex TOML are merged by Node (always present here) instead of jq.
CLIENTS_JS="$TMP/clients.cjs"
cat > "$CLIENTS_JS" <<'JS'
const fs = require("fs");
const path = require("path");
const [entry, name, home, mode, skipCodexToml] = process.argv.slice(2);
const env = { PHOTOSHOP_ADAPTER: "applescript" };
const std = { command: "node", args: [entry], env };
const vsc = { type: "stdio", command: "node", args: [entry], env };
if (mode === "print") { console.log(JSON.stringify({ mcpServers: { [name]: std } }, null, 2)); process.exit(0); }

const sup = path.join(home, "Library", "Application Support");
const done = [];
const ok = (label, file) => { console.log(`\x1b[32m  ok  ${label} (${file})\x1b[0m`); done.push(label); };
const warn = (msg) => console.error(`\x1b[33m  !   ${msg}\x1b[0m`);

/* Merge our server into <rootKey>. Not-installed clients (folder missing) are skipped unless
   create; files that are not plain JSON (e.g. JSONC with comments) are left untouched. */
function setJson(label, file, rootKey, server, create = false) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) { if (!create) return; fs.mkdirSync(dir, { recursive: true }); }
  let cfg = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    if (raw.trim()) {
      try { cfg = JSON.parse(raw); } catch { warn(`${label}: skipped ${file} (not plain JSON, e.g. it has comments). Add "${name}" manually.`); return; }
    }
    fs.copyFileSync(file, `${file}.photoshop-mcp.bak`);
  }
  cfg[rootKey] = { ...(cfg[rootKey] || {}), [name]: server };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ok(label, file);
}

/* Claude Desktop is the primary client: always written, even before its first launch. */
setJson("Claude Desktop", path.join(sup, "Claude", "claude_desktop_config.json"), "mcpServers", std, true);
setJson("Cursor", path.join(home, ".cursor", "mcp.json"), "mcpServers", std);
setJson("Windsurf", path.join(home, ".codeium", "windsurf", "mcp_config.json"), "mcpServers", std);
setJson("Gemini CLI", path.join(home, ".gemini", "settings.json"), "mcpServers", std);
setJson("Cline", path.join(sup, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), "mcpServers", std);
setJson("Roo Code", path.join(sup, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), "mcpServers", std);
/* VS Code / Insiders (Copilot agent mode) use "servers" with an explicit type. */
setJson("VS Code", path.join(sup, "Code", "User", "mcp.json"), "servers", vsc);
setJson("VS Code Insiders", path.join(sup, "Code - Insiders", "User", "mcp.json"), "servers", vsc);

/* Codex without its CLI: edit ~/.codex/config.toml directly. */
const toml = path.join(home, ".codex", "config.toml");
if (skipCodexToml !== "1" && fs.existsSync(path.dirname(toml))) {
  let text = "";
  if (fs.existsSync(toml)) { text = fs.readFileSync(toml, "utf8"); fs.copyFileSync(toml, `${toml}.photoshop-mcp.bak`); }
  /* Drop a previous [mcp_servers.<name>] table and its sub-tables so reinstalls update the path. */
  const re = new RegExp(`^\\[mcp_servers\\.${name}(?:\\.[^\\]]*)?\\][^\\r\\n]*\\r?\\n[\\s\\S]*?(?=^\\[(?!mcp_servers\\.${name}[\\].])|(?![\\s\\S]))`, "gm");
  text = text.replace(re, "").trimEnd();
  if (text) text += "\n\n";
  text += `[mcp_servers.${name}]\ncommand = "node"\nargs = [${JSON.stringify(entry)}]\nenv = { PHOTOSHOP_ADAPTER = "applescript" }\n`;
  fs.writeFileSync(toml, text);
  ok("Codex", toml);
}
fs.writeFileSync(process.env.CLIENTS_DONE_FILE, done.join(", "));
JS

if [[ "$CONFIGURE_CLIENTS" == true ]]; then
  step "Registering with MCP clients"
  # CLI-managed clients first. PHOTOSHOP_MCP_SKIP_CLI_CLIENTS=1 skips the CLIs (tests).
  CLI_DONE=()
  CODEX_CLI_OK=0
  if [[ "${PHOTOSHOP_MCP_SKIP_CLI_CLIENTS:-}" != "1" ]]; then
    if command -v claude >/dev/null 2>&1; then
      claude mcp remove --scope user "$SERVER_NAME" >/dev/null 2>&1 || true
      if claude mcp add --scope user "$SERVER_NAME" -e PHOTOSHOP_ADAPTER=applescript -- node "$ENTRY" >/dev/null 2>&1; then
        ok "Claude Code (user scope)"; CLI_DONE+=("Claude Code")
      else printf '\033[33m  !   Claude Code: "claude mcp add" failed. Add "%s" manually.\033[0m\n' "$SERVER_NAME"; fi
    fi
    if command -v codex >/dev/null 2>&1; then
      codex mcp remove "$SERVER_NAME" >/dev/null 2>&1 || true
      if codex mcp add "$SERVER_NAME" --env PHOTOSHOP_ADAPTER=applescript -- node "$ENTRY" >/dev/null 2>&1; then
        ok "Codex"; CLI_DONE+=("Codex"); CODEX_CLI_OK=1
      fi
    fi
  fi
  export CLIENTS_DONE_FILE="$TMP/clients-done"
  node "$CLIENTS_JS" "$ENTRY" "$SERVER_NAME" "$HOME" write "$CODEX_CLI_OK"
  DONE="$(cat "$CLIENTS_DONE_FILE")"
  for c in ${CLI_DONE[@]+"${CLI_DONE[@]}"}; do DONE="$DONE, $c"; done
  echo "  Configured: $DONE. Fully quit and reopen them to load Photoshop MCP."
else
  step "Add this to your MCP client config (e.g. ~/Library/Application Support/Claude/claude_desktop_config.json):"
  node "$CLIENTS_JS" "$ENTRY" "$SERVER_NAME" "$HOME" print 0
fi

echo
printf '\033[32mPhotoshop MCP installed in %s\033[0m\n' "$INSTALL_DIR"
echo "Allow automation the first time: System Settings > Privacy & Security > Automation > (your terminal / Claude) > Adobe Photoshop."
echo "Check the Photoshop bridge with: bash \"$INSTALL_DIR/scripts/diagnostics.sh\""
