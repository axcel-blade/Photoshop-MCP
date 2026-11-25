#!/usr/bin/env bash
# Read-only ps.info probe (same fields as the ps.info op: name, photoshopVersion, documents) through the macOS AppleScript runner.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${TMPDIR:-/tmp}/photoshop-ai-mcp-test"
mkdir -p "$WORKDIR"
JSX="$WORKDIR/info.jsx"
OUT="$WORKDIR/info.json"
rm -f "$OUT"

# Minimal ps.info-equivalent script compatible with Photoshop ExtendScript (ES3).
cat >"$JSX" <<EOF
var f = new File($(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$OUT"));
f.open("w");
try {
  f.write('{"ok":true,"data":{"name":"' + app.name + '","photoshopVersion":"' + app.version + '","documents":' + app.documents.length + '}}');
} catch (e) {
  f.write('{"ok":false,"error":{"code":"PHOTOSHOP_SCRIPT_ERROR","message":"' + String(e.message || e).replace(/"/g, '\\"') + '"}}');
}
f.close();
EOF

osascript "$ROOT/photoshop-scripts/run-jsx.applescript" "$JSX" "$OUT" "false"
echo "Result file: $OUT"
cat "$OUT"
echo
