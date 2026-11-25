#!/usr/bin/env bash
# macOS diagnostics for the Photoshop MCP bridge (AppleScript).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Node / pnpm ==="
node -v
command -v pnpm >/dev/null && pnpm -v || echo "pnpm not on PATH (enable with: corepack enable)"

echo
echo "=== Photoshop installs ==="
shopt -s nullglob 2>/dev/null || true
found=0
for app in /Applications/Adobe\ Photoshop*/Adobe\ Photoshop.app ~/Applications/Adobe\ Photoshop*/Adobe\ Photoshop.app; do
  if [[ -d "$app" ]]; then
    echo "  $app"
    found=1
  fi
done
if [[ "$found" -eq 0 ]]; then
  echo "  (none found under /Applications or ~/Applications)"
fi

echo
echo "=== Running? ==="
if pgrep -x "Adobe Photoshop" >/dev/null 2>&1 || pgrep -if "Adobe Photoshop" >/dev/null 2>&1; then
  echo "  Adobe Photoshop is running"
else
  echo "  Adobe Photoshop is not running"
fi

echo
echo "=== MCP build ==="
if [[ -f "$ROOT/dist/index.js" ]]; then
  echo "  dist/index.js present"
else
  echo "  dist/index.js missing — run: pnpm build"
fi

echo
echo "=== AppleScript smoke (status only if Photoshop is installed) ==="
if [[ "$found" -eq 1 ]]; then
  TMP="$(mktemp -t photoshop-mcp-diag).jsx"
  OUT="${TMP%.jsx}.json"
  cat >"$TMP" <<'EOF'
var MCP = MCP || {};
MCP.main = function () {
  var f = new File(arguments[0]);
  f.open("w");
  f.write('{"ok":true,"data":{"application":"' + app.name + '","version":"' + app.version + '"}}');
  f.close();
};
MCP.main(arguments[0]);
EOF
  # Prefer the project runner with a minimal inline script via osascript if Photoshop is up.
  if pgrep -x "Adobe Photoshop" >/dev/null 2>&1; then
    osascript "$ROOT/photoshop-scripts/run-jsx.applescript" "$TMP" "$OUT" "true" || true
    if [[ -f "$OUT" ]]; then
      echo "  result: $(cat "$OUT")"
    else
      echo "  no result file — check Automation permissions for Terminal/Node in System Settings → Privacy & Security"
    fi
  else
    echo "  skip live probe (Photoshop not running). Start it and re-run, or use PHOTOSHOP_AUTO_LAUNCH=true"
  fi
  rm -f "$TMP" "$OUT"
else
  echo "  skipped (no install)"
fi
