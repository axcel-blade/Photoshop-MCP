<#
  Live integration test against the running Photoshop (Windows COM). Runs the bridge pre-check
  (ps.info), then `pnpm test:integration` (tests/integration/run-integration.ts), which drives
  real ops end to end and prints one PASS/FAIL line per step plus a summary.
  Exit codes: 0 passed, 1 failed, 2 blocked (bridge unavailable).
#>
. "$PSScriptRoot\common.ps1"
if (-not (Test-Pnpm)) { exit 1 }
Write-Step 'Bridge pre-check'
& (Join-Path $PSScriptRoot 'test-bridge.ps1')
if ($LASTEXITCODE -ne 0) { Write-Fail 'Bridge unavailable; integration test would be blocked.'; exit 2 }
Write-Step 'Running integration suite'
Push-Location $ProjectRoot
try { & pnpm test:integration; $code = $LASTEXITCODE } finally { Pop-Location }
exit $code
