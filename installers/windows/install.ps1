<#
.SYNOPSIS
  One-line installer for Photoshop MCP on Windows.
.DESCRIPTION
  Downloads a release of Photoshop MCP from GitHub, installs it to
  %LOCALAPPDATA%\PhotoshopMCP, installs production dependencies with pnpm and registers it with
  every MCP client it finds: Claude Desktop (incl. Microsoft Store), Claude Code, Cursor, Windsurf,
  VS Code / Insiders (Copilot), Cline, Roo Code, Gemini CLI and Codex. Existing configs are merged
  (other servers and settings kept) after a .photoshop-mcp.bak backup.
  Re-running upgrades in place and keeps .env, output\ and logs\.

  irm https://axcel-blade.github.io/Photoshop-MCP/install.ps1 | iex

  Options when piped (environment variables):
    PHOTOSHOP_MCP_VERSION=1.0.0        install a specific version (default: latest release)
    PHOTOSHOP_MCP_DIR=D:\Tools\PhotoshopMCP   install folder
    PHOTOSHOP_MCP_CONFIGURE_CLIENTS=0   do not touch any MCP client config (prints the snippet)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Version 1.0.0 -NoClients
#>
[CmdletBinding()]
param(
  [string]$Version = $env:PHOTOSHOP_MCP_VERSION,
  [string]$InstallDir = $env:PHOTOSHOP_MCP_DIR,
  # Local release zip (used by CI and for offline installs) instead of downloading.
  [string]$Archive,
  # Skip all MCP client configuration (-NoClaude is the old name).
  [Alias('NoClaude')][switch]$NoClients,
  # Accepted for compatibility; clients are configured by default.
  [switch]$ConfigureClaude
)
$fromSource = $false
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'axcel-blade/Photoshop-MCP'

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  ok  $m" -ForegroundColor Green }
function Stop-Install($m) { Write-Host "  !!  $m" -ForegroundColor Red; throw $m }

if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'PhotoshopMCP' }
$configureClients = (-not $NoClients) -and $env:PHOTOSHOP_MCP_CONFIGURE_CLIENTS -ne '0' -and $env:PHOTOSHOP_MCP_CONFIGURE_CLAUDE -ne '0'
$ServerName = 'photoshop'

# ---------------------------------------------------------------- MCP client registration
function Save-JsonNoBom([string]$Path, $Object) {
  # Windows PowerShell's "Set-Content -Encoding utf8" writes a BOM, which JSON.parse (used by
  # Claude Desktop, Cursor, VS Code ...) rejects.
  $text = $Object | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($Path, $text + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}

# Merge our entry into <RootKey> of a JSON config. Clients that are not installed (folder missing)
# are skipped unless -Create; files that are not plain JSON (e.g. JSONC with comments) are skipped.
function Set-JsonMcpServer([string]$Label, [string]$ConfigPath, [string]$RootKey, $Entry, [switch]$Create) {
  $dir = Split-Path $ConfigPath -Parent
  if (-not (Test-Path $dir)) {
    if (-not $Create) { return $false }
    New-Item -ItemType Directory -Force $dir | Out-Null
  }
  $json = $null
  if (Test-Path $ConfigPath) {
    $raw = [IO.File]::ReadAllText($ConfigPath)
    if ($raw.Trim()) {
      try { $json = $raw | ConvertFrom-Json -ErrorAction Stop } catch {
        Write-Warning "${Label}: skipped $ConfigPath (not plain JSON, e.g. it has comments). Add '$ServerName' manually."
        return $false
      }
    }
    Copy-Item $ConfigPath "$ConfigPath.photoshop-mcp.bak" -Force
  }
  if (-not $json) { $json = [pscustomobject]@{} }
  if (-not $json.PSObject.Properties[$RootKey]) { $json | Add-Member -NotePropertyName $RootKey -NotePropertyValue ([pscustomobject]@{}) -Force }
  $json.$RootKey | Add-Member -NotePropertyName $ServerName -NotePropertyValue $Entry -Force
  Save-JsonNoBom $ConfigPath $json
  Write-Ok "$Label ($ConfigPath)"
  return $true
}

function Invoke-Quiet([scriptblock]$Block) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Block *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false } finally { $ErrorActionPreference = $old }
}

function Register-McpClients([string]$Entry) {
  $envBlock = [pscustomobject]@{ PHOTOSHOP_ADAPTER = 'com' }
  $std = [pscustomobject]@{ command = 'node'; args = @($Entry); env = $envBlock }
  $vsc = [pscustomobject]@{ type = 'stdio'; command = 'node'; args = @($Entry); env = $envBlock }
  $done = New-Object System.Collections.Generic.List[string]

  # Claude Desktop is the primary client: always written, even before its first launch.
  if (Set-JsonMcpServer 'Claude Desktop' (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json') 'mcpServers' $std -Create) { $done.Add('Claude Desktop') }
  # The Microsoft Store build keeps its config in a virtualized AppData folder.
  $pkgs = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path $pkgs) {
    foreach ($pkg in (Get-ChildItem $pkgs -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue)) {
      if (Set-JsonMcpServer 'Claude Desktop (Store)' (Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json') 'mcpServers' $std -Create) { $done.Add('Claude Desktop (Store)') }
    }
  }
  $clients = @(
    @('Cursor', (Join-Path $env:USERPROFILE '.cursor\mcp.json'), 'mcpServers', $std),
    @('Windsurf', (Join-Path $env:USERPROFILE '.codeium\windsurf\mcp_config.json'), 'mcpServers', $std),
    @('Gemini CLI', (Join-Path $env:USERPROFILE '.gemini\settings.json'), 'mcpServers', $std),
    @('Cline', (Join-Path $env:APPDATA 'Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json'), 'mcpServers', $std),
    @('Roo Code', (Join-Path $env:APPDATA 'Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json'), 'mcpServers', $std),
    # VS Code / Insiders (Copilot agent mode) use "servers" with an explicit type.
    @('VS Code', (Join-Path $env:APPDATA 'Code\User\mcp.json'), 'servers', $vsc),
    @('VS Code Insiders', (Join-Path $env:APPDATA 'Code - Insiders\User\mcp.json'), 'servers', $vsc)
  )
  foreach ($c in $clients) { if (Set-JsonMcpServer $c[0] $c[1] $c[2] $c[3]) { $done.Add($c[0]) } }

  # CLI-managed clients. PHOTOSHOP_MCP_SKIP_CLI_CLIENTS=1 skips the CLIs (tests).
  $useCli = $env:PHOTOSHOP_MCP_SKIP_CLI_CLIENTS -ne '1'
  if ($useCli -and (Get-Command claude -ErrorAction SilentlyContinue)) {
    [void](Invoke-Quiet { claude mcp remove --scope user $ServerName })
    if (Invoke-Quiet { claude mcp add --scope user $ServerName -e PHOTOSHOP_ADAPTER=com -- node $Entry }) { Write-Ok 'Claude Code (user scope)'; $done.Add('Claude Code') }
    else { Write-Warning "Claude Code: 'claude mcp add' failed. Add '$ServerName' manually." }
  }
  $codexDone = $false
  if ($useCli -and (Get-Command codex -ErrorAction SilentlyContinue)) {
    [void](Invoke-Quiet { codex mcp remove $ServerName })
    if (Invoke-Quiet { codex mcp add $ServerName --env PHOTOSHOP_ADAPTER=com -- node $Entry }) { Write-Ok 'Codex'; $done.Add('Codex'); $codexDone = $true }
  }
  $toml = Join-Path $env:USERPROFILE '.codex\config.toml'
  if (-not $codexDone -and (Test-Path (Split-Path $toml))) {
    $text = ''
    if (Test-Path $toml) { $text = [IO.File]::ReadAllText($toml); Copy-Item $toml "$toml.photoshop-mcp.bak" -Force }
    # Replace a previous [mcp_servers.photoshop] table (and its sub-tables) so reinstalls update the path.
    $pattern = '(?ms)^\[mcp_servers\.' + $ServerName + '(?:\.[^\]]*)?\][^\r\n]*\r?\n.*?(?=^\[(?!mcp_servers\.' + $ServerName + '[\].])|\z)'
    $text = [regex]::Replace($text, $pattern, '').TrimEnd()
    if ($text) { $text += "`n`n" }
    $p = $Entry -replace '\\', '/'
    $text += "[mcp_servers.$ServerName]`ncommand = `"node`"`nargs = [`"$p`"]`nenv = { PHOTOSHOP_ADAPTER = `"com`" }`n"
    [IO.File]::WriteAllText($toml, $text, (New-Object Text.UTF8Encoding $false))
    Write-Ok "Codex ($toml)"
    $done.Add('Codex')
  }
  return ,$done
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- prerequisites
Write-Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-Install 'Node.js 20+ is required: https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)' }
$nodeVersion = (& node -v).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 20) { Stop-Install "Node.js 20+ is required (found $nodeVersion)" }
Write-Ok "node $nodeVersion"

Write-Step 'Checking pnpm'
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  try { & corepack enable 2>$null | Out-Null } catch { }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Stop-Install 'pnpm is required: run "corepack enable" as administrator or see https://pnpm.io/installation' }
Write-Ok ("pnpm " + (& pnpm -v))

# ---------------------------------------------------------------- download
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("photoshop-mcp-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  if ($Archive) {
    $zip = (Resolve-Path $Archive).Path
    Write-Step "Using local archive $zip"
  } else {
    Write-Step 'Finding release'
    $api = if ($Version) { "https://api.github.com/repos/$Repo/releases/tags/v$($Version.TrimStart('v'))" } else { "https://api.github.com/repos/$Repo/releases/latest" }
    $headers = @{ 'User-Agent' = 'photoshop-mcp-installer'; Accept = 'application/vnd.github+json' }
    # Anonymous API calls are limited to 60/hour per IP (shared CI runners and office NATs hit that).
    # Use a token when one is set; it is sent only to api.github.com.
    $token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { $env:GH_TOKEN }
    if ($token) { $headers.Authorization = "Bearer $token" }
    try { $rel = Invoke-RestMethod -Uri $api -Headers $headers }
    catch {
      $msg = "$_"
      if ($msg -match 'rate limit') { Stop-Install 'GitHub API rate limit reached for this network. Wait an hour, or set GITHUB_TOKEN and run again.' }
      if ($msg -match 'Not Found') { Stop-Install "No release found$(if ($Version) { " for version $Version" })." }
      throw
    }
    $asset = $rel.assets | Where-Object { $_.name -like 'photoshop-mcp-*.zip' } | Select-Object -First 1
    if (-not $asset) {
      # Releases made before the CD workflow carry no prebuilt zip: build from the source archive.
      Write-Step "$($rel.tag_name) has no prebuilt package; downloading source to build locally"
      $asset = [pscustomobject]@{ name = "source-$($rel.tag_name).zip"; browser_download_url = $rel.zipball_url }
      $fromSource = $true
    }
    $zip = Join-Path $tmp $asset.name
    Write-Step "Downloading $($asset.name) ($($rel.tag_name))"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    $sumAsset = $rel.assets | Where-Object { $_.name -eq "$($asset.name).sha256" } | Select-Object -First 1
    if ($sumAsset) {
      # GitHub serves .sha256 assets as application/octet-stream, for which Windows PowerShell 5.1
      # returns .Content as byte[] (splitting that yields numbers, not the hash). Decode explicitly.
      $sumContent = (Invoke-WebRequest -Uri $sumAsset.browser_download_url -UseBasicParsing).Content
      if ($sumContent -is [byte[]]) { $sumContent = [Text.Encoding]::ASCII.GetString($sumContent) }
      $expected = ([string]$sumContent).Trim() -split '\s+' | Select-Object -First 1
      if ($expected -notmatch '^[0-9a-fA-F]{64}$') { Stop-Install "Could not read the checksum for $($asset.name)" }
      $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
      if ($expected.ToLower() -ne $actual) { Stop-Install "Checksum mismatch for $($asset.name)" }
      Write-Ok 'checksum verified'
    }
  }

  Write-Step 'Extracting'
  $extract = Join-Path $tmp 'x'
  Expand-Archive -Path $zip -DestinationPath $extract -Force
  $src = Get-ChildItem $extract -Directory | Select-Object -First 1
  if (-not $src) { Stop-Install 'Archive is empty' }
  if (-not (Test-Path (Join-Path $src.FullName 'dist\index.js'))) {
    if (-not (Test-Path (Join-Path $src.FullName 'package.json'))) { Stop-Install 'Archive contains neither dist\index.js nor package.json' }
    Write-Step 'Building from source (pnpm install + build)'
    Push-Location $src.FullName
    try {
      $env:CI = 'true'
      & pnpm install --frozen-lockfile --ignore-scripts; if ($LASTEXITCODE -ne 0) { Stop-Install 'pnpm install failed' }
      & pnpm build; if ($LASTEXITCODE -ne 0) { Stop-Install 'pnpm build failed' }
      Remove-Item node_modules -Recurse -Force
    } finally { Pop-Location }
    $fromSource = $true
  }

  # ---------------------------------------------------------------- install / upgrade
  Write-Step "Installing to $InstallDir"
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  # Replace program files; keep user data (.env, output, logs).
  $keep = @('.env', 'output', 'logs', 'node_modules')
  Get-ChildItem $InstallDir -Force | Where-Object { $keep -notcontains $_.Name } | Remove-Item -Recurse -Force
  Get-ChildItem $src.FullName -Force | Where-Object { -not (($_.Name -eq 'output' -or $_.Name -eq 'logs') -and (Test-Path (Join-Path $InstallDir $_.Name))) } |
    Copy-Item -Destination $InstallDir -Recurse -Force

  Push-Location $InstallDir
  try {
    $env:CI = 'true'  # non-interactive pnpm
    & pnpm install --prod --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { Stop-Install 'pnpm install failed' }
  } finally { Pop-Location }

  if (-not (Test-Path (Join-Path $InstallDir '.env'))) { Copy-Item (Join-Path $InstallDir '.env.example') (Join-Path $InstallDir '.env') }
  $docs = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PhotoshopMCP'
  New-Item -ItemType Directory -Force $docs | Out-Null

  $entry = Join-Path $InstallDir 'dist\index.js'
  # Check the build loads (syntax/deps) without starting the stdio server.
  & node -e "import(process.argv[1]).catch(e=>{console.error(e);process.exit(1)})" "file:///$((Join-Path $InstallDir 'dist\config\index.js') -replace '\\','/')"
  if ($LASTEXITCODE -ne 0) { Stop-Install 'The installed server does not load' }
  $installed = (Get-Content (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
  Write-Ok "Photoshop MCP $installed$(if ($fromSource) { ' (built from source)' })"

  # ---------------------------------------------------------------- MCP clients
  if ($configureClients) {
    Write-Step 'Registering with MCP clients'
    $configured = Register-McpClients $entry
    Write-Host "  Configured: $($configured -join ', '). Fully quit and reopen them to load Photoshop MCP."
  } else {
    Write-Step 'Add this to your MCP client config (e.g. %APPDATA%\Claude\claude_desktop_config.json):'
    $server = [pscustomobject]@{ command = 'node'; args = @($entry); env = [pscustomobject]@{ PHOTOSHOP_ADAPTER = 'com' } }
    Write-Host ([pscustomobject]@{ mcpServers = [pscustomobject]@{ photoshop = $server } } | ConvertTo-Json -Depth 10)
  }

  Write-Host ''
  Write-Host "Photoshop MCP installed in $InstallDir" -ForegroundColor Green
  Write-Host "Check the Photoshop bridge with: powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\diagnostics.ps1`""
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
