# run-telegram-inbox.ps1 — orica-telegram-inbox タスクの実体（1 回分の受信同期）。
#
# Telegram Bot API getUpdates を Codex 用 inbox に同期し、/ruling 回答は needs-ruling.jsonl
# を含め独立した即時受付workerへ渡す。supervisor実行中も受付・返答・キュー登録を進める。
#
# best-effort・exit 0 固定。受信不達や認証情報不足で無人ループ全体を止めない。

param(
  [switch]$Watch,
  [int]$PollTimeoutSeconds = 50,
  [int]$IdleDelaySeconds = 1,
  [int]$MaxLoops = 0
)

$ErrorActionPreference = "Continue"
$Repo = "C:\dev\orica-simulator"
$LogDir = Join-Path $Repo "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir "telegram-inbox.log"
$Lock = Join-Path $LogDir "telegram-inbox.lock"
$InboxScript = Join-Path $Repo "scripts\telegram-inbox.mjs"
$RelayScript = Join-Path $Repo "scripts\relay-outbox-to-telegram.mjs"
$InboxLockStream = $null

function Update-InboxLock {
  if (-not $InboxLockStream) { return }
  $payload = [System.Text.Encoding]::UTF8.GetBytes("pid=$PID at=$(Get-Date -Format o)`n")
  $InboxLockStream.SetLength(0)
  $InboxLockStream.Write($payload, 0, $payload.Length)
  $InboxLockStream.Flush()
}

function Acquire-InboxLock {
  if (Test-Path $Lock) {
    try {
      $age = (Get-Date) - (Get-Item -LiteralPath $Lock).LastWriteTime
      if ($age.TotalMinutes -gt 15) {
        Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  try {
    $script:InboxLockStream = [System.IO.File]::Open(
      $Lock,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
    Update-InboxLock
    return $true
  } catch [System.IO.IOException] {
    return $false
  }
}

function Release-InboxLock {
  if ($InboxLockStream) {
    try { $InboxLockStream.Close() } catch {}
    $script:InboxLockStream = $null
  }
  try { Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue } catch {}
}

$node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $node = $n; break }
}
if (-not $node) {
  $resolved = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($resolved) { $node = $resolved.Source }
}
if (-not $node) {
  "[$(Get-Date -Format o)] ABORT: node 不在（inbox skip）" | Add-Content $Log
  exit 0
}

if (-not (Acquire-InboxLock)) {
  "[$(Get-Date -Format o)] telegram inbox skipped: another instance is active" | Add-Content $Log
  exit 0
}

function Invoke-InboxOnce {
  param([int]$TimeoutSeconds)

  $pollArgs = @($InboxScript, "poll", "--max", "20")
  if ($TimeoutSeconds -gt 0) {
    $pollArgs += @("--timeout", "$TimeoutSeconds")
  }

  & $node @pollArgs *>> $Log 2>&1
  & $node $InboxScript apply-rulings *>> $Log 2>&1
  & $node $InboxScript quarantine-risky *>> $Log 2>&1

  # apply-rulings / poll ack が outbox を積んだ場合は、relay task の次 tick を待たずに流す。
  & $node $RelayScript --max 10 *>> $Log 2>&1
}

try {
  if ($Watch) {
    "[$(Get-Date -Format o)] telegram inbox watch start (timeout=${PollTimeoutSeconds}s)" | Add-Content $Log
    $loops = 0
    while ($true) {
      Update-InboxLock
      Invoke-InboxOnce -TimeoutSeconds $PollTimeoutSeconds
      $loops += 1
      if ($MaxLoops -gt 0 -and $loops -ge $MaxLoops) { break }
      if ($IdleDelaySeconds -gt 0) {
        Start-Sleep -Seconds $IdleDelaySeconds
      }
    }
    "[$(Get-Date -Format o)] telegram inbox watch end (loops=$loops)" | Add-Content $Log
    exit 0
  }

  "[$(Get-Date -Format o)] telegram inbox poll start" | Add-Content $Log
  Invoke-InboxOnce -TimeoutSeconds 0
  "[$(Get-Date -Format o)] telegram inbox poll end" | Add-Content $Log
  exit 0
} finally {
  Release-InboxLock
}
