$ErrorActionPreference = 'Continue'

$serviceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeDir = Join-Path $serviceRoot 'data\runtime'
$supervisorLog = Join-Path $runtimeDir 'local-service.log'
$stdoutLog = Join-Path $runtimeDir 'local-service.stdout.log'
$stderrLog = Join-Path $runtimeDir 'local-service.stderr.log'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Write-ServiceLog([string]$message) {
  Add-Content -LiteralPath $supervisorLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" -Encoding UTF8
}

function Test-PlanFactHealth {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/health' -TimeoutSec 3
    return $health.ok -eq $true -and $health.service -eq 'plan-fakt'
  } catch {
    return $false
  }
}

Write-ServiceLog 'Local supervisor started.'

while ($true) {
  if (Test-PlanFactHealth) {
    Start-Sleep -Seconds 5
    continue
  }

  Write-ServiceLog 'Service is unavailable. Starting server.js.'
  $server = Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $serviceRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  $failedChecks = 0

  while (-not $server.HasExited) {
    Start-Sleep -Seconds 5
    if (Test-PlanFactHealth) {
      $failedChecks = 0
      continue
    }
    $failedChecks += 1
    if ($failedChecks -lt 6) { continue }

    Write-ServiceLog "Service did not respond for 30 seconds. Restarting process $($server.Id)."
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    break
  }

  if ($server.HasExited) {
    Write-ServiceLog "server.js exited with code $($server.ExitCode). Restarting in 2 seconds."
  }
  Start-Sleep -Seconds 2
}
