$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$runtimeDir = Join-Path $desktopDir 'runtime'
$configPath = Join-Path $desktopDir 'desktop.config.json'

if ([string]::IsNullOrWhiteSpace($env:DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK)) {
  throw 'DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK must contain the public JWK exported by /auth/system/desktop/signing-key'
}
$serverOrigin = if ([string]::IsNullOrWhiteSpace($env:DSH_DESKTOP_SERVER_ORIGIN)) {
  'http://10.155.44.246:3081'
} else {
  $env:DSH_DESKTOP_SERVER_ORIGIN
}
$publicJwk = $env:DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK | ConvertFrom-Json
$config = [ordered]@{
  serverOrigin = $serverOrigin
  serverSigningPublicJwk = $publicJwk
}
$config | ConvertTo-Json -Depth 12 | Set-Content -Path $configPath -Encoding utf8NoBOM

if (Test-Path $runtimeDir) {
  Remove-Item -LiteralPath $runtimeDir -Recurse -Force
}
# Squirrel's NuGet packer still enforces MAX_PATH. A hoisted runtime avoids the
# long pnpm virtual-store paths that would otherwise be copied into resources/.
pnpm --config.node-linker=hoisted --config.inject-workspace-packages=true --ignore-scripts --filter '@deepseek-ai/dsh' --prod deploy $runtimeDir
if ($LASTEXITCODE -ne 0) { throw 'pnpm deploy failed' }

$nodeExe = (Get-Command node.exe).Source
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeDir 'node.exe')

$profileCheckHome = Join-Path $env:RUNNER_TEMP 'dsh-desktop-profile-check'
if (Test-Path $profileCheckHome) {
  Remove-Item -LiteralPath $profileCheckHome -Recurse -Force
}
New-Item -ItemType Directory -Path $profileCheckHome | Out-Null
$previousDshHome = $env:DSH_HOME
$env:DSH_HOME = $profileCheckHome
try {
  $dumpOutput = & (Join-Path $runtimeDir 'node.exe') (Join-Path $runtimeDir 'lib/bin.js') --profile desktop --dump-config 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "staged desktop profile dump failed:`n$dumpOutput" }
} finally {
  if ($null -eq $previousDshHome) { Remove-Item Env:DSH_HOME }
  else { $env:DSH_HOME = $previousDshHome }
}
if ($dumpOutput -match 'patch:') { throw "staged desktop profile reported a skipped patch:`n$dumpOutput" }
if ($dumpOutput -notmatch "name: '@deepseek-ai/dsh-credentials-windows'") {
  throw 'staged desktop profile does not mount the Windows DPAPI credential provider'
}
if ($dumpOutput -notmatch 'name: dsh-browser-playwright/playwright') {
  throw 'staged desktop profile does not mount the global browser plugin'
}

$browserPackage = Join-Path $runtimeDir 'node_modules/dsh-browser-playwright/package.json'
if (-not (Test-Path $browserPackage)) {
  throw 'the staged runtime does not contain dsh-browser-playwright'
}
$browserVersion = (Get-Content $browserPackage -Raw | ConvertFrom-Json).version
if ($browserVersion -ne '0.1.1') {
  throw "the staged browser plugin is $browserVersion instead of 0.1.1"
}

$runtimeSmokeHome = Join-Path $env:RUNNER_TEMP 'dsh-desktop-runtime-smoke'
$runtimeSmokeStdout = Join-Path $env:RUNNER_TEMP 'dsh-desktop-runtime-smoke.stdout.log'
$runtimeSmokeStderr = Join-Path $env:RUNNER_TEMP 'dsh-desktop-runtime-smoke.stderr.log'
foreach ($path in @($runtimeSmokeHome, $runtimeSmokeStdout, $runtimeSmokeStderr)) {
  if (Test-Path $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
New-Item -ItemType Directory -Path $runtimeSmokeHome | Out-Null
$previousDshHome = $env:DSH_HOME
$previousDreaminaDisabled = $env:DSH_DISABLE_DREAMINA
$previousTelemetryDisabled = $env:DSH_TELEMETRY_DISABLED
$env:DSH_HOME = $runtimeSmokeHome
$env:DSH_DISABLE_DREAMINA = '1'
$env:DSH_TELEMETRY_DISABLED = '1'
$runtimeProcess = $null
try {
  $runtimeProcess = Start-Process `
    -FilePath (Join-Path $runtimeDir 'node.exe') `
    -ArgumentList @(
      (Join-Path $runtimeDir 'lib/bin.js'),
      '--profile', 'desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'
    ) `
    -RedirectStandardOutput $runtimeSmokeStdout `
    -RedirectStandardError $runtimeSmokeStderr `
    -WindowStyle Hidden `
    -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $authenticatedUrl = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path $runtimeSmokeStdout) {
      $runtimeOutput = [string](Get-Content -LiteralPath $runtimeSmokeStdout -Raw)
      $match = [regex]::Match($runtimeOutput, 'dsh web: (http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_-]+)')
      if ($match.Success) {
        $authenticatedUrl = $match.Groups[1].Value
        break
      }
    }
    if ($runtimeProcess.HasExited) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $authenticatedUrl) {
    $stdout = if (Test-Path $runtimeSmokeStdout) { Get-Content -LiteralPath $runtimeSmokeStdout -Raw } else { '' }
    $stderr = if (Test-Path $runtimeSmokeStderr) { Get-Content -LiteralPath $runtimeSmokeStderr -Raw } else { '' }
    $diagnostic = "$stdout`n$stderr" -replace 'token=[A-Za-z0-9_-]+', 'token=[redacted]'
    throw "staged desktop runtime did not become ready:`n$diagnostic"
  }
  $browserSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $response = Invoke-WebRequest -Uri $authenticatedUrl -WebSession $browserSession -MaximumRedirection 5
  if ($response.StatusCode -ne 200) {
    throw "staged desktop runtime returned HTTP $($response.StatusCode)"
  }
} finally {
  if ($null -ne $runtimeProcess -and -not $runtimeProcess.HasExited) {
    Stop-Process -Id $runtimeProcess.Id -Force
    $runtimeProcess.WaitForExit()
  }
  if ($null -eq $previousDshHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
  else { $env:DSH_HOME = $previousDshHome }
  if ($null -eq $previousDreaminaDisabled) { Remove-Item Env:DSH_DISABLE_DREAMINA -ErrorAction SilentlyContinue }
  else { $env:DSH_DISABLE_DREAMINA = $previousDreaminaDisabled }
  if ($null -eq $previousTelemetryDisabled) { Remove-Item Env:DSH_TELEMETRY_DISABLED -ErrorAction SilentlyContinue }
  else { $env:DSH_TELEMETRY_DISABLED = $previousTelemetryDisabled }
}

Push-Location $desktopDir
try {
  pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'desktop TypeScript build failed' }
} finally {
  Pop-Location
}

$packageStage = Join-Path $env:RUNNER_TEMP 'd'
if (Test-Path $packageStage) {
  Remove-Item -LiteralPath $packageStage -Recurse -Force
}
# Forge's dependency walker requires a self-contained tree instead of pnpm workspace links.
Push-Location $repoRoot
try {
  pnpm --config.node-linker=hoisted --config.inject-workspace-packages=true --ignore-scripts --filter '@deepseek-ai/dsh-desktop' deploy $packageStage
  if ($LASTEXITCODE -ne 0) { throw 'desktop package staging failed' }
} finally {
  Pop-Location
}

Copy-Item -LiteralPath $runtimeDir -Destination (Join-Path $packageStage 'runtime') -Recurse
Copy-Item -LiteralPath $configPath -Destination (Join-Path $packageStage 'desktop.config.json')

# The isolated deploy skips dependency install scripts. electron-winstaller's
# install script normally selects the host-architecture 7-Zip files that
# Squirrel invokes while creating the release package, so materialize that
# deterministic x64 selection before Forge runs.
$squirrelVendor = Join-Path $packageStage 'node_modules/electron-winstaller/vendor'
$sevenZipSource = Join-Path $squirrelVendor '7z-x64.exe'
$sevenZipDllSource = Join-Path $squirrelVendor '7z-x64.dll'
if (-not (Test-Path $sevenZipSource) -or -not (Test-Path $sevenZipDllSource)) {
  throw 'electron-winstaller does not contain the x64 7-Zip binaries'
}
Copy-Item -LiteralPath $sevenZipSource -Destination (Join-Path $squirrelVendor '7z.exe')
Copy-Item -LiteralPath $sevenZipDllSource -Destination (Join-Path $squirrelVendor '7z.dll')

$previousNpmUserAgent = $env:npm_config_user_agent
$previousPnpmNodeLinker = $env:PNPM_CONFIG_NODE_LINKER
$pnpmVersion = (& pnpm --version).Trim()
$nodeVersion = (& node --version).Trim()
$env:npm_config_user_agent = "pnpm/$pnpmVersion node/$nodeVersion"
$env:PNPM_CONFIG_NODE_LINKER = 'hoisted'
Push-Location $packageStage
try {
  & node (Join-Path $packageStage 'node_modules/@electron-forge/cli/dist/electron-forge.js') make --platform win32 --arch x64 --config forge.config.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Electron Forge make failed' }
} finally {
  Pop-Location
  if ($null -eq $previousNpmUserAgent) { Remove-Item Env:npm_config_user_agent -ErrorAction SilentlyContinue }
  else { $env:npm_config_user_agent = $previousNpmUserAgent }
  if ($null -eq $previousPnpmNodeLinker) { Remove-Item Env:PNPM_CONFIG_NODE_LINKER -ErrorAction SilentlyContinue }
  else { $env:PNPM_CONFIG_NODE_LINKER = $previousPnpmNodeLinker }
}

$stageSetup = Join-Path $packageStage 'out/make/squirrel.windows/x64/FZFX-DSH-Setup.exe'
if (-not (Test-Path $stageSetup)) { throw "installer is missing at $stageSetup" }
$digest = (Get-FileHash -LiteralPath $stageSetup -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  FZFX-DSH-Setup.exe" | Set-Content -Path "$stageSetup.sha256" -Encoding ascii
$manifest = [ordered]@{
  product = '奉中附小 DSH'
  version = (Get-Content (Join-Path $desktopDir 'package.json') -Raw | ConvertFrom-Json).version
  platform = 'win32-x64'
  node = (& node --version)
  electron = (Get-Content (Join-Path $desktopDir 'package.json') -Raw | ConvertFrom-Json).devDependencies.electron
  browserPlugin = $browserVersion
  serverOrigin = $serverOrigin
  sha256 = $digest
  signed = $false
  hardwareAcceptance = $false
}
$stageManifest = Join-Path (Split-Path $stageSetup) 'build-manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $stageManifest -Encoding utf8NoBOM

$desktopOut = Join-Path $desktopDir 'out'
if (Test-Path $desktopOut) {
  Remove-Item -LiteralPath $desktopOut -Recurse -Force
}
$finalMakeDir = Join-Path $desktopOut 'make/squirrel.windows/x64'
New-Item -ItemType Directory -Path $finalMakeDir -Force | Out-Null
Copy-Item -LiteralPath $stageSetup -Destination (Join-Path $finalMakeDir 'FZFX-DSH-Setup.exe')
Copy-Item -LiteralPath "$stageSetup.sha256" -Destination (Join-Path $finalMakeDir 'FZFX-DSH-Setup.exe.sha256')
Copy-Item -LiteralPath $stageManifest -Destination (Join-Path $finalMakeDir 'build-manifest.json')
