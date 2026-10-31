# register-telegram-relay-task.ps1 — orica-telegram-relay の Windows Scheduled Task を冪等登録する。
#
# run-telegram-relay.ps1（codex-hub-outbox の未処理 JSON を Telegram Bot API 経由で中継）を
# 既定 1 分毎に起動する。Codex App heartbeat automation はモバイル中継のたびにアプリ使用量
# （週間クォータ）を消費するため、無料の Telegram Bot API へ通知経路を寄せてクォータ消費を
# ゼロにするのが目的（2026-07-04、heartbeat 累計 488 回でクォータ残 4% まで枯渇）。
# MultipleInstances IgnoreNew + relay の冪等性で多重中継を防ぐ。StartWhenAvailable で再起動復帰。
#
# 使い方:
#   pwsh scripts/register-telegram-relay-task.ps1                    # 登録（1 分毎）
#   pwsh scripts/register-telegram-relay-task.ps1 -IntervalMinutes 3 # 間隔変更
#   pwsh scripts/register-telegram-relay-task.ps1 -Unregister        # 削除のみ
# 終了コード: 0=成功 / 1=エラー

param(
  [int]$IntervalMinutes = 1,
  [switch]$NoLogonTrigger,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = 'orica-telegram-relay'
$Repo = 'C:\dev\orica-simulator'
$Wrapper = Join-Path $Repo 'scripts\run-telegram-relay.ps1'
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

# 既存を削除（idempotent）。存在時のみ叩き、未存在時の schtasks 非ゼロ exit を残さない。
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  schtasks /Delete /TN $TaskName /F *> $null
}

if ($Unregister) {
  Write-Host "[register] task '$TaskName' を削除した" -ForegroundColor Green
  exit 0
}

# 窓抑制: run-hidden.vbs 経由で pwsh を隠し起動（他 orica-* タスクと同方式）。
$Wscript = "C:\Windows\System32\wscript.exe"
$Vbs = Join-Path $Repo "scripts\run-hidden.vbs"
$action = New-ScheduledTaskAction `
  -Execute $Wscript `
  -Argument "`"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"" `
  -WorkingDirectory $Repo

$intervalTrigger = New-ScheduledTaskTrigger `
  -Once -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$triggers = @($intervalTrigger)
if (-not $NoLogonTrigger) {
  $triggers += New-ScheduledTaskTrigger -AtLogOn
}

# ExecutionTimeLimit 15分: relay は数秒で終わる。ハングしてもスロットを長く占有させない。
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew

$desc = "orica Telegram relay: ${IntervalMinutes}分毎に codex-hub-outbox の未処理通知を " +
        "Telegram Bot API 経由でモバイルへ中継（無料・アプリ使用量非消費）。Codex App heartbeat " +
        "automation の代替。停止は schtasks /Change /TN $TaskName /DISABLE。" +
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
  $taskCommand = "$Wscript `"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`""
  schtasks /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /ST 00:00 /TR $taskCommand /RU $TaskUser /IT /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "schtasks fallback failed for $TaskName" }
  Set-ScheduledTask -TaskName $TaskName -Settings $settings -ErrorAction Stop | Out-Null
  $registrationMode = "schtasks-minute"
}

Write-Host "[register] task '$TaskName' を登録した (every ${IntervalMinutes}min, mode=$registrationMode, atLogonRequested=$(-not $NoLogonTrigger), user=$TaskUser, wrapper: $Wrapper)" -ForegroundColor Green
