<# Environment diagnostics: runtime, Photoshop installs, COM registration, process, config, Claude config. #>
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Continue'

Write-Step 'Runtime'
Test-Node | Out-Null; Test-Pnpm | Out-Null
Write-Ok "Windows: $([Environment]::OSVersion.VersionString), PowerShell $($PSVersionTable.PSVersion)"

Write-Step 'Adobe Photoshop installations'
$found = Get-ChildItem "$env:ProgramFiles\Adobe" -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue
if ($found) {
  foreach ($d in $found) {
    $exe = Join-Path $d.FullName 'Photoshop.exe'  # C:\Program Files\Adobe\Adobe Photoshop <year>\Photoshop.exe
    if (Test-Path $exe) { Write-Ok "$($d.Name)  ($((Get-Item $exe).VersionInfo.ProductVersion))" } else { Write-Warn2 "$($d.Name) (Photoshop.exe not found)" }
  }
} else { Write-Fail 'No Photoshop installation found under Program Files\Adobe' }

Write-Step 'COM registration'
$curVer = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\Photoshop.Application\CurVer' -ErrorAction SilentlyContinue).'(default)'
if ($curVer) { Write-Ok "Photoshop.Application -> $curVer" } else { Write-Fail 'Photoshop.Application ProgID is not registered (run Photoshop once as the current user, or repair the install).' }

Write-Step 'Process'
$p = Get-Process Photoshop -ErrorAction SilentlyContinue
if ($p) { Write-Ok "Photoshop running (PID $($p.Id -join ', '))" } else { Write-Warn2 'Photoshop not running (it will be launched on first tool call if PHOTOSHOP_AUTO_LAUNCH=true)' }

Write-Step 'Claude Desktop config'
$cfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
if (Test-Path $cfg) {
  $json = Get-Content $cfg -Raw | ConvertFrom-Json
  if ($json.mcpServers.photoshop) { Write-Ok "photoshop server configured: $($json.mcpServers.photoshop.args -join ' ')" } else { Write-Warn2 'claude_desktop_config.json has no "photoshop" server entry' }
} else { Write-Warn2 "$cfg not found" }

Write-Step 'Logs'
$logs = Join-Path $ProjectRoot 'logs'
$latest = Get-ChildItem $logs -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) { Write-Ok "Latest log: $($latest.FullName)"; Get-Content $latest.FullName -Tail 5 } else { Write-Warn2 'No logs yet' }
