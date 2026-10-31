[CmdletBinding()]
param([string]$Root, [string]$CodexExecutable)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = git -C $PSScriptRoot rev-parse --show-toplevel }
$Root = (Resolve-Path -LiteralPath $Root).Path
if ($CodexExecutable) { $CodexExecutable = (Resolve-Path -LiteralPath $CodexExecutable).Path }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$launcher = Join-Path $Root 'scripts\run-hidden.vbs'
$runner = Join-Path $Root 'scripts\notices\run-digest.mjs'
if (-not (Test-Path -LiteralPath $runner)) { throw 'Notice runner is missing.' }
$arguments = "`"$launcher`" `"$nodeExe`" `"$runner`" --root `"$Root`""
if ($CodexExecutable) { $arguments += " --codex `"$CodexExecutable`"" }
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument $arguments -WorkingDirectory $Root
# Explicit JST instant, independent of the Windows display timezone. Retry every
# 15 minutes; the persisted day cursor makes all post-success ticks no-ops.
$jst = [TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time')
$jstNow = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $jst)
$midnightUtc = [TimeZoneInfo]::ConvertTimeToUtc([DateTime]::SpecifyKind($jstNow.Date.AddDays(1), [DateTimeKind]::Unspecified), $jst)
$trigger = New-ScheduledTaskTrigger -Once -At $midnightUtc.ToLocalTime() -RepetitionInterval (New-TimeSpan -Minutes 15)
$trigger.StartBoundary = $midnightUtc.ToString("yyyy-MM-ddTHH:mm:ss'Z'")
$login = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'orica-daily-notices' -Action $action -Trigger @($trigger, $login) -Settings $settings -Principal $principal -Description 'Daily operation notices at 00:00 JST; previous day, latest 10, retry on unavailable deployment.' -Force | Out-Null
Write-Output "Registered orica-daily-notices; next midnight JST $($jstNow.Date.AddDays(1).ToString('yyyy-MM-dd HH:mm')); root $Root"
