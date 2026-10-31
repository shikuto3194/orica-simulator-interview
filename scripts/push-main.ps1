# push-main.ps1 — 現在の local main をそのまま origin へ ff push する独立スクリプト。
#
# auto-merge.ps1 の push は「レーンが branch→main を merge した副作用」としてのみ走る。
# そのため両レーンが延々タスク中だと main が published されない（origin が遅延）。
# 本スクリプトは lane の完了と無関係に、現在の local main を origin へ publish する。
#
# 安全機構:
# - merge lane lock を取得（auto-merge と同じ lock）→ レーンの merge+push と直列化し競合回避。
# - primary が main + clean のときだけ push（対話セッションの WIP を巻き込まない）。
# - `git push origin main` は ff のみ（origin が先行＝分岐していれば Git が reject、強制しない）。
#
# 使い方:
#   pwsh scripts/push-main.ps1            # 1回 push
#   pwsh scripts/push-main.ps1 -Quiet     # ログ最小
#
# 終了コード: 0=push成功 or 既に最新 / 1=ロック取得失敗(間引き) / 2=中止(dirty/分岐/push失敗)

param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$Primary = "C:\dev\orica-simulator"
$LogDir = Join-Path $Primary "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir "push-main.log"

function Say($msg, $color = "Gray") {
  if (-not $Quiet) { Write-Host "[push-main] $msg" -ForegroundColor $color }
  "[$(Get-Date -Format o)] $msg" | Add-Content $Log
}

$node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $node = $n; break }
}
if (-not $node) { $node = "node" }

# primary が main + clean か事前確認（lock 取得前の早期 abort）。
$branch = git -C $Primary rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
  Say "abort: primary branch is $branch (expected main)" "Yellow"
  exit 2
}
$dirty = git -C $Primary status --porcelain
if ($dirty) {
  Say "abort: primary tree dirty (commit/stash first to avoid pushing WIP)" "Yellow"
  exit 2
}

# origin が既に最新なら no-op。
git -C $Primary fetch origin main --quiet 2>$null
$ahead = git -C $Primary rev-list --count origin/main..main 2>$null
if ($ahead -eq "0") {
  Say "origin/main は既に最新（push 不要）" "Green"
  exit 0
}

# merge lane lock を取得（auto-merge の merge+push と直列化）。短命・wait あり。
$LockScript = Join-Path $Primary "scripts\supervisor-lock.mjs"
$token = [guid]::NewGuid().ToString("N")
& $node $LockScript acquire --lane merge --token $token --label "push-main" --ttl 5 --wait 120 *>> $Log 2>&1
$acq = $LASTEXITCODE
if ($acq -eq 1) {
  Say "merge lane lock 保持中（別レーンが merge 中）。次回に回す" "Yellow"
  exit 1
}
if ($acq -ne 0) {
  Say "abort: merge lane lock acquire 失敗 (exit $acq)" "Red"
  exit 2
}

$code = 2
try {
  # ロック取得後に再検査（待機中に状態が変わりうる）。
  $branch2 = git -C $Primary rev-parse --abbrev-ref HEAD
  if ($branch2 -ne "main") { Say "abort: after lock, primary branch is $branch2" "Yellow"; exit 2 }
  $dirty2 = git -C $Primary status --porcelain
  if ($dirty2) { Say "abort: after lock, primary dirty" "Yellow"; exit 2 }

  $ahead2 = git -C $Primary rev-list --count origin/main..main 2>$null
  Say "pushing local main -> origin/main (ahead $ahead2)" "Cyan"
  git -C $Primary push origin main *>> $Log 2>&1
  if ($LASTEXITCODE -ne 0) {
    Say "push failed (origin 先行で分岐 or pre-push gate 失敗)。強制しない" "Red"
    $code = 2
  } else {
    Say "push 完了" "Green"
    $code = 0
  }
}
finally {
  & $node $LockScript release --lane merge --token $token *>> $Log 2>&1
}
exit $code
