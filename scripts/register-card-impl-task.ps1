# register-card-impl-task.ps1 — orica-card-impl-loop の Windows Scheduled Task を冪等登録する。
#
# coverage todo が再発したときだけ A レーン (card-data 変換) を Codex の
# 別 worktree+lock で並走させる cron。engine supervisor と staggered で
# HH:33 に発火させる（同時起動を避けてリソース競合を緩和）。todo 0 のときは
# wrapper の task0 gate が Codex 起動前に即終了する。
#
# 単一インスタンス保証は二重: (1) MultipleInstances=IgnoreNew (本登録)、
# (2) wrapper 内で owner token 付き lock (lane=card-impl) を Codex 起動前に acquire。
#
# 使い方:
#   pwsh scripts/register-card-impl-task.ps1                 # 60 分間隔で登録
#   pwsh scripts/register-card-impl-task.ps1 -IntervalMinutes 120   # 2 時間ごとに
#   pwsh scripts/register-card-impl-task.ps1 -Unregister     # 削除のみ
#
# 終了コード: 0=成功 / 1=エラー

param(
  [int]$IntervalMinutes = 60,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = 'orica-card-impl-loop'
$Repo = 'C:\dev\orica-simulator'
$ScriptPath = Join-Path $Repo 'scripts\run-card-impl-iteration.ps1'

$PwshHost = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $PwshHost)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $PwshHost = $resolvedPwsh.Source }
}
if (-not (Test-Path $PwshHost)) {
  Write-Host "[register] pwsh.exe が見つからない" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $ScriptPath)) {
  Write-Host "[register] wrapper が見つからない: $ScriptPath" -ForegroundColor Red
  exit 1
}

# 既存を削除（idempotent）
schtasks /Delete /TN $TaskName /F *> $null

if ($Unregister) {
  Write-Host "[register] task '$TaskName' を削除した" -ForegroundColor Green
  exit 0
}

# 窓抑制: wscript の隠しランチャ経由
$Wscript = "C:\Windows\System32\wscript.exe"
$Vbs = Join-Path $Repo "scripts\run-hidden.vbs"
$action = New-ScheduledTaskAction `
  -Execute $Wscript `
  -Argument "`"$Vbs`" `"$PwshHost`" -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
  -WorkingDirectory $Repo

# engine supervisor と staggered で HH:33 開始
$start = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes(33)
if ($start -lt (Get-Date)) { $start = $start.AddHours(1) }

$trigger = New-ScheduledTaskTrigger `
  -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
  -MultipleInstances IgnoreNew

$desc = "orica card-impl Codex lane: $IntervalMinutes 分毎に task0 gate を確認し、" +
        "coverage todo があるときだけ headless Codex で card-data 変換を実行。" +
        "engine supervisor と並走（独立 worktree+lock）。停止は " +
        "schtasks /Change /TN orica-card-impl-loop /DISABLE。" +
        "正源 manual/ai-reference/30_plan/lane-prompts.md の Cards Lane"

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -User $env:USERNAME `
  -Description $desc | Out-Null

Write-Host "[register] task '$TaskName' 登録完了 (interval=$IntervalMinutes 分, start=$start)" -ForegroundColor Green
Write-Host "[register] 停止: schtasks /Change /TN $TaskName /DISABLE" -ForegroundColor Cyan
Write-Host "[register] 再開: schtasks /Change /TN $TaskName /ENABLE" -ForegroundColor Cyan
Write-Host "[register] 即実行: schtasks /Run /TN $TaskName" -ForegroundColor Cyan
exit 0
