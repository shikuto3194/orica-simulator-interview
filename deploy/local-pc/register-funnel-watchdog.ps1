param(
    [ValidateSet('Observe', 'Recover', 'Disabled')]
    [string]$Mode = 'Observe',
    [string]$InstallRoot = 'C:\dev\orica-simulator'
)
$ErrorActionPreference = 'Stop'
$taskName = 'orica-funnel-watchdog'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$installPath = (Resolve-Path -LiteralPath $InstallRoot).Path
$statePath = Join-Path $installPath 'logs\pc-api\funnel-watchdog'
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
$disabledPath = Join-Path $statePath 'disabled'

if ($Mode -eq 'Disabled') {
    # Publish the operator override before stopping the schedule.
    Set-Content -LiteralPath $disabledPath -Value 'Operator disabled automatic recovery' -Encoding utf8
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
    Write-Output 'Funnel watchdog disabled. Funnel and API are unchanged.'
    exit 0
}

$files = @('funnel-probe.mjs', 'funnel-policy.mjs', 'funnel-watchdog.mjs')
$tracked = @($files | ForEach-Object { "deploy/local-pc/$_" }) + @('deploy/local-pc/register-funnel-watchdog.ps1', 'scripts/run-hidden.vbs')
$dirty = & git -C $sourceRoot status --porcelain -- $tracked
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and validate the watchdog sources before registration.' }
$revision = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'Cannot determine watchdog revision.' }
$releasePath = Join-Path $installPath "artifacts\pc-api\funnel-watchdog\$revision"
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
foreach ($file in $files) {
    $destination = Join-Path $releasePath $file
    $source = Join-Path $PSScriptRoot $file
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            throw "Immutable watchdog release differs: $file"
        }
    } else { Copy-Item -LiteralPath $source -Destination $destination }
}
$launcher = Join-Path $releasePath 'run-hidden.vbs'
$launcherSource = Join-Path $sourceRoot 'scripts\run-hidden.vbs'
if (Test-Path -LiteralPath $launcher) {
    if ((Get-FileHash -LiteralPath $launcherSource).Hash -ne (Get-FileHash -LiteralPath $launcher).Hash) {
        throw 'Immutable watchdog launcher differs.'
    }
} else { Copy-Item -LiteralPath $launcherSource -Destination $launcher }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$watchdog = Join-Path $releasePath 'funnel-watchdog.mjs'
$arguments = "`"$launcher`" `"$nodeExe`" `"$watchdog`" --state-dir `"$statePath`""
if ($Mode -eq 'Recover') { $arguments += ' --recover' }
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument $arguments -WorkingDirectory $installPath
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
$loginTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger, $loginTrigger) -Settings $settings -Principal $principal -Description "Public DNS and Funnel watchdog ($Mode); revision $revision" -Force | Out-Null
if (Test-Path -LiteralPath $disabledPath) { Remove-Item -LiteralPath $disabledPath }
Enable-ScheduledTask -TaskName $taskName | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Registered $taskName in $Mode mode; revision $revision; state $statePath"
