# run-telegram-relay.ps1 — orica-telegram-relay タスクの実体（1 回分の中継）。
#
# logs/codex-hub-outbox/ の未処理 JSON を Telegram へ中継する（relay-outbox-to-telegram.mjs）。
# 従来モバイル通知は「Codex App heartbeat automation」が担っていたが、これは発火毎にアプリ
# 使用量（週間クォータ）を 1 ターン消費し、~30分毎 × 累計 488 回でクォータを枯渇させた
# （2026-07-04）。本タスクは無料の Telegram Bot API 経由で進捗/裁定/完了/エラーを届け、
# heartbeat automation を止めてもモバイル通知を失わないための repo 側の恒常経路。
#
# 送信自体は best-effort で再試行するが、未送信が残った run は nonzero で終了して Task Scheduler
# に可視化する。タスクを無効化しないため、次 tick で FIFO 再試行される。
# 単一インスタンスは task の MultipleInstances IgnoreNew で保証（relay は冪等なのでロック不要）。

$ErrorActionPreference = "Continue"
$Repo = "C:\dev\orica-simulator"
$LogDir = Join-Path $Repo "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir "telegram-relay.log"

# node 解決（scheduled-task 文脈は PATH に無いことがある。他 wrapper と同方式）。
$node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $node = $n; break }
}
if (-not $node) {
  $resolved = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($resolved) { $node = $resolved.Source }
}
if (-not $node) {
  "[$(Get-Date -Format o)] ABORT: node 不在（relay skip）" | Add-Content $Log
  exit 1
}

# 空 outbox 時のログノイズを避けるため、未処理 JSON がある時だけ relay を回して記録する。
$outbox = Join-Path $LogDir "codex-hub-outbox"
$pending = @()
if (Test-Path $outbox) {
  $pending = @(Get-ChildItem -LiteralPath $outbox -Filter *.json -File -ErrorAction SilentlyContinue)
}
if ($pending.Count -eq 0) { exit 0 }

"[$(Get-Date -Format o)] relay start (pending=$($pending.Count))" | Add-Content $Log
& $node (Join-Path $Repo "scripts\relay-outbox-to-telegram.mjs") --max 20 --strict-exit *>> $Log 2>&1
$relayExitCode = $LASTEXITCODE
if ($relayExitCode -ne 0) {
  "[$(Get-Date -Format o)] ERROR: relay failed (exit=$relayExitCode, pending=$($pending.Count))" | Add-Content $Log
  exit $relayExitCode
}
exit 0
