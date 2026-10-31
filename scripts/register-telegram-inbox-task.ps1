# register-telegram-inbox-task.ps1 — orica-telegram-inbox の Windows Scheduled Task を冪等登録する。
#
# run-telegram-inbox.ps1（Telegram getUpdates → Codex inbox → /ruling 反映）を既定で
# long-poll 常駐起動する。Codex supervisor は 1h tick なので、裁定回答と追加指示の受信だけは
# 即時に近い形で拾って repo-visible な状態へ保存する。StartWhenAvailable + AtLogOn で再起動後も自動復帰する。
#
# 使い方:
#   pwsh scripts/register-telegram-inbox-task.ps1                    # 登録（long-poll、落ちたら 1 分毎に復帰）
#   pwsh scripts/register-telegram-inbox-task.ps1 -OneShot           # 旧来の 1 回 polling task として登録
#   pwsh scripts/register-telegram-inbox-task.ps1 -Unregister        # 削除のみ

param(
  [int]$IntervalMinutes = 1,
  [switch]$NoLogonTrigger,
  [switch]$OneShot,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = 'orica-telegram-inbox'
$Repo = 'C:\dev\orica-simulator'
$Wrapper = Join-Path $Repo 'scripts\run-telegram-inbox.ps1'
$TaskUser = if ($env:ORICA_TASK_USER) { $env:ORICA_TASK_USER } elseif (Test-Path 'C:\Users\kensh') { 'kensh' } else { $env:USERNAME }
$Pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $Pwsh)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $Pwsh = $resolvedPwsh.Source }
}

if (-not (Test-Path $Pwsh)) {
  Write-Host "[register] pwsh.exe が見つからない: $Pwsh" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $Wrapper)) {
  Write-Host "[register] wrapper が見つからない: $Wrapper" -ForegroundColor Red
  exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  schtasks /Delete /TN $TaskName /F *> $null
}

if ($Unregister) {
  Write-Host "[register] task '$TaskName' を削除した" -ForegroundColor Green
  exit 0
}

$Wscript = "C:\Windows\System32\wscript.exe"
$Vbs = Join-Path $Repo "scripts\run-hidden.vbs"
$wrapperModeArgs = if ($OneShot) { "" } else { " -Watch" }
$action = New-ScheduledTaskAction `
  -Execute $Wscript `
  -Argument "`"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"$wrapperModeArgs" `
  -WorkingDirectory $Repo

$intervalTrigger = New-ScheduledTaskTrigger `
  -Once -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$triggers = @($intervalTrigger)
if (-not $NoLogonTrigger) {
  $triggers += New-ScheduledTaskTrigger -AtLogOn
}

$executionTimeLimit = if ($OneShot) { New-TimeSpan -Minutes 10 } else { New-TimeSpan -Hours 12 }
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit $executionTimeLimit `
  -MultipleInstances IgnoreNew

$mode = if ($OneShot) { "one-shot" } else { "long-poll" }
$desc = "orica Telegram inbox: ${mode} で Telegram getUpdates を Codex inbox へ同期し、" +
        "/ruling 回答を needs-ruling.jsonl へ反映する。停止は schtasks /Change /TN $TaskName /DISABLE。" +
        "正源 manual/ai-reference/30_plan/full-run-supervisor.md"

$registrationMode = "ScheduledTask"
try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -User $TaskUser `
    -Description $desc | Out-Null
} catch {
  Write-Host "[register] Register-ScheduledTask 失敗。schtasks fallback を試す: $($_.Exception.Message)" -ForegroundColor Yellow
  $taskCommand = "$Wscript `"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"$wrapperModeArgs"
  schtasks /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /ST 00:00 /TR $taskCommand /RU $TaskUser /IT /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "schtasks fallback failed for $TaskName" }
  Set-ScheduledTask -TaskName $TaskName -Settings $settings -ErrorAction Stop | Out-Null
  $registrationMode = "schtasks-minute"
}

Write-Host "[register] task '$TaskName' を登録した (mode=$mode, restartTick=${IntervalMinutes}min, registration=$registrationMode, atLogonRequested=$(-not $NoLogonTrigger), user=$TaskUser, wrapper: $Wrapper)" -ForegroundColor Green
