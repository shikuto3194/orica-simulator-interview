# register-watchdog-task.ps1 — orica-process-watchdog の Windows Scheduled Task を冪等登録する。
#
# 既存タスクの有効状態と実行中processを保持して更新する。既定実行間隔は 30 分（外部 cron が 30 分毎に
# MCP triplet を生む実測 leak 速度に合わせる。watchdog 側の 1h 閾値と組み合わせると
# steady-state ≤1 個の inactive triplet で安定）。
# 既定スコープは --include-mcp --include-cli-sessions --include-locks で、Claude Code
# セッション残留 MCP triplet／デスクトップアプリ配下の stale CLI セッション(claude.exe
# stream-json)／engine・supervisor lane の孤児 supervisor-lock を対象にする。
# supervisor-lock は worker 死亡で 240 分 run TTL 満了まで cron を空回りさせるため、
# 30 分周期の watchdog で早期回収する。正源 memory: project_supervisor_orphan_lock_deadwindow。
#
# 使い方:
#   pwsh scripts/register-watchdog-task.ps1                       # 既定 (--include-mcp --include-cli-sessions --include-locks, 30 分間隔)
#   pwsh scripts/register-watchdog-task.ps1 -VitestOnly           # vitest 系のみ対象
#   pwsh scripts/register-watchdog-task.ps1 -IntervalMinutes 15   # 間隔を 15 分に
#   pwsh scripts/register-watchdog-task.ps1 -Unregister           # 削除のみ
#
# 終了コード: 0=成功 / 1=エラー (Register-ScheduledTask 失敗)

param(
  [switch]$VitestOnly,
  [int]$IntervalMinutes = 30,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = 'orica-process-watchdog'
$Repo = 'C:\dev\orica-simulator'
$NodeExe = 'C:\Program Files\nodejs\node.exe'

if ($Unregister) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not unregister $TaskName" }
  Write-Host "[register] task '$TaskName' を削除した" -ForegroundColor Green
  exit 0
}

$targetJson = & node (Join-Path $PSScriptRoot 'full-run-checkouts.mjs') --repo $Repo --full-run
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve pinned full-run checkouts; existing watchdog task is preserved' }
$targets = ($targetJson -join "`n") | ConvertFrom-Json
$Control = $targets.integrationWorktree
$ScriptPath = Join-Path $Control 'scripts\watchdog-stale-processes.mjs'

if (-not (Test-Path $NodeExe)) {
  Write-Host "[register] node.exe が見つからない: $NodeExe (node の場所を確認)" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $ScriptPath)) {
  Write-Host "[register] watchdog スクリプトが見つからない: $ScriptPath" -ForegroundColor Red
  exit 1
}

$argString = "`"$ScriptPath`""
if (-not $VitestOnly) { $argString += ' --include-mcp --include-cli-sessions --include-locks' }

# 窓抑制: InteractiveToken のまま wscript の隠しランチャ経由で node を起動する（窓を出さず
# 子の終了まで待つ）。直接 node を起動するとデスクトップに console 窓が出る。
# 正源: scripts/run-hidden.vbs。
$Wscript = "C:\Windows\System32\wscript.exe"
$Vbs = Join-Path $Control "scripts\run-hidden.vbs"
if (-not (Test-Path $Vbs)) { throw "Hidden launcher not found: $Vbs; existing task is preserved" }
$action = New-ScheduledTaskAction `
  -Execute $Wscript `
  -Argument "`"$Vbs`" `"$NodeExe`" $argString" `
  -WorkingDirectory $Control

$trigger = New-ScheduledTaskTrigger `
  -Once -At ((Get-Date).AddMinutes(2)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew

$desc = "Reap stale vitest/MCP processes and orphan supervisor locks from past " +
        "Claude Code sessions. See memory: project_process_hygiene_infra.md, " +
        "project_supervisor_orphan_lock_deadwindow.md"

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  $settings.Enabled = $existingTask.Settings.Enabled
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -ErrorAction Stop | Out-Null
} else {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -User $env:USERNAME `
    -Description $desc | Out-Null
}

Write-Host "[register] task '$TaskName' を登録した (every ${IntervalMinutes}min, args: $argString)" -ForegroundColor Green
