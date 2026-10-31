# configure-codex-autostart.ps1 — 再起動復帰を Codex-only 構成へ揃える。
#
# やること:
# - Codex supervisor task を登録/有効化（15min + logon trigger、実行中はスキップ）
# - Telegram relay / inbox task を登録/有効化（relay 1min fallback + inbox long-poll + logon trigger）
# - Claude 系 scheduled task は停止/無効化し、Codex-only を維持する
# - 旧 Claude-Code-Remote の Telegram long-poller と同名 task を停止し、getUpdates を Codex inbox に一本化する
# - Task Scheduler Operational log を有効化し、wrapper 起動前の失敗も Windows event から追跡可能にする
# - 現在起動中の Claude デスクトップアプリも閉じる（削除しない）
#
# Windows の AutoAdminLogon はパスワードを OS 側に保存する設定なので、この script では変更しない。
# 既に autologon が設定済みなら AtLogOn trigger で再起動後に自動復帰する。未設定なら警告だけ出す。

param(
  [int]$SupervisorIntervalMinutes = 15,
  [int]$TelegramIntervalMinutes = 1,
  [switch]$NoLogonTrigger,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$Repo = 'C:\dev\orica-simulator'
$Control = Split-Path -Parent $PSScriptRoot
$Pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $Pwsh)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $Pwsh = $resolvedPwsh.Source }
}
if (-not (Test-Path $Pwsh)) {
  Write-Host "[codex-autostart] pwsh.exe が見つからない: $Pwsh" -ForegroundColor Red
  exit 1
}
$Node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $Node = $n; break }
}
if (-not $Node) {
  $resolvedNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($resolvedNode) { $Node = $resolvedNode.Source }
}

function Disable-OricaTasks {
  param([string]$Pattern)
  $tasks = @(Get-ScheduledTask -TaskName $Pattern -ErrorAction SilentlyContinue)
  if ($tasks.Count -eq 0) {
    Write-Host "[codex-autostart] legacy task '$Pattern' は未登録" -ForegroundColor DarkGray
    return
  }
  foreach ($task in $tasks) {
    try { Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
    Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
    Write-Host "[codex-autostart] task '$($task.TaskName)' を停止/無効化した（削除なし）" -ForegroundColor Yellow
  }
}

function Stop-ClaudeDesktopIfRunning {
  $processes = @(Get-Process -Name 'Claude' -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    Write-Host "[codex-autostart] Claude desktop process は起動していない" -ForegroundColor DarkGray
    return
  }
  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      Write-Host "[codex-autostart] Claude desktop process PID=$($process.Id) を終了した" -ForegroundColor Yellow
    } catch {
      Write-Host "[codex-autostart] WARN: Claude desktop process PID=$($process.Id) の終了に失敗: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}
function Disable-LegacyTelegramPollingTasks {
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue)
  foreach ($task in $tasks) {
    $actionText = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join "`n")
    if ($actionText -notmatch '(?i)claude-code-remote' -or $actionText -notmatch '(?i)telegram-polling\.js') {
      continue
    }
    try { Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
    Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
    Write-Host "[codex-autostart] legacy Telegram polling task '$($task.TaskName)' を停止/無効化した" -ForegroundColor Yellow
  }
}

function Stop-LegacyTelegramPollers {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $byPid = @{}
  foreach ($process in $processes) { $byPid[[int]$process.ProcessId] = $process }

  foreach ($process in $processes) {
    if ($process.Name -notin @('node.exe', 'node') -or $process.CommandLine -notmatch '(?i)telegram-polling\.js') {
      continue
    }
    $ancestor = $process
    $legacyLauncher = $null
    while ($ancestor -and [int]$ancestor.ParentProcessId -gt 0) {
      $ancestor = $byPid[[int]$ancestor.ParentProcessId]
      if ($ancestor -and $ancestor.CommandLine -match '(?i)claude-code-remote') {
        $legacyLauncher = $ancestor
        break
      }
    }
    if (-not $legacyLauncher) { continue }
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "[codex-autostart] legacy Telegram poller PID=$($process.ProcessId) を終了した" -ForegroundColor Yellow
    } catch {
      Write-Host "[codex-autostart] WARN: legacy Telegram poller PID=$($process.ProcessId) の終了に失敗: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    try {
      Stop-Process -Id $legacyLauncher.ProcessId -Force -ErrorAction Stop
    } catch {}
  }
}

function Enable-TaskSchedulerOperationalLog {
  & "$env:SystemRoot\System32\wevtutil.exe" sl 'Microsoft-Windows-TaskScheduler/Operational' /e:true
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[codex-autostart] Task Scheduler Operational log を有効化した" -ForegroundColor Green
  } else {
    Write-Host "[codex-autostart] WARN: Task Scheduler Operational log を有効化できない（管理者権限が必要な場合あり）" -ForegroundColor Yellow
  }
}


function Invoke-RegisterScript {
  param(
    [string]$ScriptName,
    [string[]]$ExtraArgs
  )
  $script = Join-Path $Control "scripts\$ScriptName"
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script) + $ExtraArgs
  if ($NoLogonTrigger) { $args += "-NoLogonTrigger" }
  & $Pwsh @args
  if ($LASTEXITCODE -ne 0) {
    throw "$ScriptName failed with exit $LASTEXITCODE"
  }
}

function Test-AutoAdminLogon {
  try {
    $winlogon = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction Stop
    return [string]$winlogon.AutoAdminLogon -eq '1'
  } catch {
    return $false
  }
}

function Get-SupervisorRunActiveReason {
  $task = Get-ScheduledTask -TaskName 'orica-full-run-supervisor' -ErrorAction SilentlyContinue
  if ($task -and [string]$task.State -eq 'Running') {
    return "scheduled task state is Running"
  }

  if (-not $Node) {
    Write-Host "[codex-autostart] WARN: node.exe が見つからないため supervisor lock status を確認できない" -ForegroundColor Yellow
    return "supervisor lock status unavailable: node.exe not found"
  }

  $lockScript = Join-Path $Repo "scripts\supervisor-lock.mjs"
  $lockOut = & $Node $lockScript status --lane supervisor --ttl 240 2>&1
  $lockCode = $LASTEXITCODE
  $lockText = ($lockOut -join "`n").Trim()
  if ($lockCode -eq 1 -and $lockText -match '\bheld\b') {
    return "supervisor lock held: $lockText"
  }
  if ($lockCode -ne 0 -and $lockCode -ne 1) {
    Write-Host "[codex-autostart] WARN: supervisor lock status failed (exit $lockCode): $lockText" -ForegroundColor Yellow
    return "supervisor lock status failed (exit $lockCode): $lockText"
  }
  return $null
}

Disable-OricaTasks -Pattern 'orica-*claude*'
Disable-OricaTasks -Pattern 'orica-card-impl-loop'
Disable-LegacyTelegramPollingTasks
Stop-LegacyTelegramPollers
Stop-ClaudeDesktopIfRunning
Enable-TaskSchedulerOperationalLog

Invoke-RegisterScript -ScriptName 'register-supervisor-task.ps1' -ExtraArgs @("-IntervalMinutes", "$SupervisorIntervalMinutes")
Invoke-RegisterScript -ScriptName 'register-telegram-relay-task.ps1' -ExtraArgs @("-IntervalMinutes", "$TelegramIntervalMinutes")
Invoke-RegisterScript -ScriptName 'register-telegram-inbox-task.ps1' -ExtraArgs @("-IntervalMinutes", "$TelegramIntervalMinutes")

if (-not (Test-AutoAdminLogon)) {
  Write-Host "[codex-autostart] WARN: Windows AutoAdminLogon は確認できない。ログオン後の自動復帰は有効だが、OSログイン自体は手動になる可能性あり。" -ForegroundColor Yellow
}

if ($RunNow) {
  foreach ($task in @('orica-telegram-inbox', 'orica-telegram-relay', 'orica-full-run-supervisor')) {
    if ($task -eq 'orica-full-run-supervisor') {
      $activeReason = Get-SupervisorRunActiveReason
      if ($activeReason) {
        Write-Host "[codex-autostart] task '$task' は既存 run 駆動中のため即時実行しない ($activeReason)" -ForegroundColor Yellow
        continue
      }
    }
    schtasks /Run /TN $task | Out-Null
    Write-Host "[codex-autostart] task '$task' を即時実行した" -ForegroundColor Cyan
  }
}

Write-Host "[codex-autostart] Codex-only autostart configured." -ForegroundColor Green
Write-Host "[codex-autostart] engine/card の実行 worker は Codex に統一済み。" -ForegroundColor Cyan
