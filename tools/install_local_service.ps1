$ErrorActionPreference = 'Stop'

$taskName = 'PlanFakt Local Service'
$supervisorScript = Join-Path $PSScriptRoot 'run_local_service.ps1'
$powershellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $powershellPath -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User $currentUser -RunLevel Limited -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Output "Task '$taskName' is installed and started for $currentUser."
