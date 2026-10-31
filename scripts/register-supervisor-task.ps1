# register-supervisor-task.ps1 — orica-full-run-supervisor の Windows Scheduled Task を冪等登録する。
#
# run-supervisor-iteration.ps1 の起動を既定15分毎に試行する（2026-10-01ユーザー指示）。
# 実行中はIgnoreNewと共有lockでスキップし、既存workerを15分で止め直さない。
# 手動停止・usage breaker・監査完了時の安全停止は従来どおり尊重する。
# MultipleInstances IgnoreNew + supervisor-lock の二重で多重 run を防ぐ。autologon + StartWhenAvailable
# により再起動を跨いで自動復帰する（memory: project_unattended_reboot_recovery）。
#
# 使い方:
#   pwsh scripts/register-supervisor-task.ps1                     # 登録（15 分毎）。登録のみ＝この時点では未発火
#   pwsh scripts/register-supervisor-task.ps1 -IntervalMinutes 30 # 間隔変更
#   pwsh scripts/register-supervisor-task.ps1 -Unregister         # 削除のみ
#
# 「フルラン開始」= 本スクリプトで登録 + `schtasks /Run /TN orica-full-run-supervisor`（初回即時）。
# 「フルラン停止」= `schtasks /Change /TN orica-full-run-supervisor /DISABLE`。
# 終了コード: 0=成功 / 1=エラー

param(
  [int]$IntervalMinutes = 15,
  [switch]$NoLogonTrigger,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = 'orica-full-run-supervisor'
$Repo = 'C:\dev\orica-simulator'
$targetJson = & node (Join-Path $PSScriptRoot 'full-run-checkouts.mjs') --repo $Repo --full-run
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve pinned full-run checkouts; existing task is preserved' }
$targets = ($targetJson -join "`n") | ConvertFrom-Json
$Control = $targets.integrationWorktree
$Wrapper = Join-Path $Control 'scripts\run-supervisor-iteration.ps1'
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

if ($Unregister) {
  schtasks /Delete /TN $TaskName /F *> $null
  Write-Host "[register] task '$TaskName' を削除した" -ForegroundColor Green
  exit 0
}

# 窓抑制: InteractiveToken のまま wscript の隠しランチャ経由で pwsh を起動する（窓を出さず
# 子の終了まで待つ）。直接 pwsh を起動するとデスクトップに console 窓が出て長尺/ハング run で
# 放置される。正源: scripts/run-hidden.vbs。
$Wscript = "C:\Windows\System32\wscript.exe"
$Vbs = Join-Path $Control "scripts\run-hidden.vbs"
$action = New-ScheduledTaskAction `
  -Execute $Wscript `
  -Argument "`"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"" `
  -WorkingDirectory $Control

$intervalTrigger = New-ScheduledTaskTrigger `
  -Once -At ((Get-Date).AddMinutes(2)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$triggers = @($intervalTrigger)
if (-not $NoLogonTrigger) {
  $triggers += New-ScheduledTaskTrigger -AtLogOn
}

# ExecutionTimeLimit 6h: 1 イテレーション（2 レーン sub-agent + 全ゲート + fuzz、終盤は e2e）に十分な上限。
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -MultipleInstances IgnoreNew

$desc = "orica フルラン supervisor: ${IntervalMinutes}分毎に新規 headless Codex 文脈で " +
        "full-run-supervisor.md の 1 イテレーションを実行。Telegram relay/inbox がモバイル連携を担う。停止は " +
        "schtasks /Change /TN $TaskName /DISABLE。正源 manual/ai-reference/30_plan/full-run-supervisor.md"

$registrationMode = "ScheduledTask"
try {
  $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    # Update future dispatch only. Preserve enable state and the running process.
    $settings.Enabled = $existingTask.Settings.Enabled
    Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -ErrorAction Stop | Out-Null
  } else {
    Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -User $TaskUser `
    -Description $desc | Out-Null
  }
} catch {
  if ($existingTask) { throw "Existing supervisor task update failed; do not delete or restart it: $_" }
  Write-Host "[register] Register-ScheduledTask 失敗。schtasks fallback を試す: $($_.Exception.Message)" -ForegroundColor Yellow
  $taskCommand = "$Wscript `"$Vbs`" `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`""
  schtasks /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /ST 00:00 /TR $taskCommand /RU $TaskUser /IT /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "schtasks fallback failed for $TaskName" }
  Set-ScheduledTask -TaskName $TaskName -Settings $settings -ErrorAction Stop | Out-Null
  $registrationMode = "schtasks-minute"
}

Write-Host "[register] task '$TaskName' を登録した (every ${IntervalMinutes}min, mode=$registrationMode, atLogonRequested=$(-not $NoLogonTrigger), user=$TaskUser, wrapper: $Wrapper)" -ForegroundColor Green
