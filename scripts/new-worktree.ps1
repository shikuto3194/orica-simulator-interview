#!/usr/bin/env pwsh
<#
.SYNOPSIS
  並行作業用の git worktree を OneDrive 外に作成し、pnpm install まで行う補助スクリプト。

.DESCRIPTION
  「セッション1本 = worktree 1本 = ブランチ1本」の運用を補助する。
  各 worktree は独立した作業ツリー・index・HEAD を持つため、複数の Claude Code
  セッションを同じファイルで衝突させずに並行実行できる。worktree は既定で
  OneDrive 同期外（C:\dev\orica-wt 配下）に作成する（同期churn / ファイルロック回避）。

.PARAMETER Task
  作業名。worktree ディレクトリ名とブランチ名（既定 feat/<Task>）に使う。

.PARAMETER Port
  dev サーバー（vite）の推奨ポート。未指定なら 4173 + 既存 worktree 数で自動採番。

.PARAMETER From
  分岐元ブランチ。既定 main。

.PARAMETER Branch
  作成するブランチ名。既定 feat/<Task>。

.PARAMETER BaseDir
  worktree 置き場。既定 C:\dev\orica-wt（OneDrive 外を推奨）。

.PARAMETER Remove
  指定時は worktree とブランチ（safe delete）を削除する。

.EXAMPLE
  ./scripts/new-worktree.ps1 -Task brave-combine
  ./scripts/new-worktree.ps1 -Task four-of-a-kind -Port 4175 -From main
  ./scripts/new-worktree.ps1 -Task brave-combine -Remove
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Task,
  [int]$Port,
  [string]$From = "main",
  [string]$Branch,
  [string]$BaseDir = "C:\dev\orica-wt",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

# このスクリプトが置かれているリポジトリのルートを解決（worktree から実行しても可）。
$repoRoot = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw "git リポジトリが見つかりません ($PSScriptRoot)" }

if (-not $Branch) { $Branch = "feat/$Task" }
$wtPath = Join-Path $BaseDir $Task

# --- 削除モード ---
if ($Remove) {
  git -C $repoRoot worktree remove $wtPath
  if ($LASTEXITCODE -ne 0) { throw "worktree remove に失敗: $wtPath（未コミット変更がある場合は手動で確認）" }
  git -C $repoRoot branch -d $Branch
  Write-Host "削除完了: $wtPath / ブランチ $Branch" -ForegroundColor Green
  return
}

# --- 作成モード ---
if ($BaseDir -match "OneDrive") {
  Write-Warning "BaseDir が OneDrive 配下です。同期churn / ファイルロックを避けるため OneDrive 外を推奨します。"
}

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null

if (Test-Path $wtPath) { throw "既に存在します: $wtPath（別の Task 名にするか -Remove で削除）" }

# ポート未指定なら 4173(メイン用) + 既存 worktree 数で採番。
if (-not $Port) {
  $existing = @(git -C $repoRoot worktree list).Count
  $Port = 4173 + $existing
}

git -C $repoRoot worktree add $wtPath -b $Branch $From
if ($LASTEXITCODE -ne 0) { throw "worktree add に失敗（ブランチ名の重複等を確認）: $Branch" }

Write-Host "pnpm install 実行中 ($wtPath) ..." -ForegroundColor Cyan
Push-Location $wtPath
try {
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install に失敗" }
} finally {
  Pop-Location
}

# .claude/ は gitignore のため worktree に複製されない。許可リスト(settings.local.json)と
# フックが無いと scheduled/無人セッションが毎ツール許可待ちで止まるため、main からコピーする。
$srcClaude = Join-Path $repoRoot ".claude"
$dstClaude = Join-Path $wtPath ".claude"
if (Test-Path $srcClaude) {
  New-Item -ItemType Directory -Force -Path $dstClaude | Out-Null
  foreach ($item in @("settings.json", "settings.local.json")) {
    $p = Join-Path $srcClaude $item
    if (Test-Path $p) { Copy-Item $p $dstClaude -Force }
  }
  foreach ($dir in @("hooks", "commands", "rules")) {
    $p = Join-Path $srcClaude $dir
    if (Test-Path $p) { Copy-Item $p $dstClaude -Recurse -Force }
  }
  Write-Host "[OK] .claude/ (settings + hooks + rules) を worktree にコピー" -ForegroundColor Green
}

# external-qa/ (独自) と external-qa-official/ (公式FAQ全件) も gitignore のため複製されない。
# 裁定確定の参照元として worktree にコピーする。
foreach ($qaDir in @("external-qa", "external-qa-official")) {
  $srcQa = Join-Path $repoRoot $qaDir
  $dstQa = Join-Path $wtPath $qaDir
  if (Test-Path $srcQa) {
    New-Item -ItemType Directory -Force -Path $dstQa | Out-Null
    Copy-Item "$srcQa\*" $dstQa -Recurse -Force
    Write-Host "[OK] $qaDir/ を worktree にコピー" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "[OK] worktree 準備完了" -ForegroundColor Green
Write-Host "  パス    : $wtPath"
Write-Host "  ブランチ: $Branch  (from $From)"
Write-Host ""
Write-Host "次の手順:"
Write-Host "  1) 別ターミナルを開き:  cd `"$wtPath`""
Write-Host "  2) そのディレクトリで Claude Code セッションを起動"
Write-Host "  3) dev サーバー:  npx vite --config apps/playground-web/vite.config.ts --port $Port"
Write-Host ""
Write-Host "完了後の統合と片付け:"
Write-Host "  git switch main; git merge --ff-only $Branch"
Write-Host "  ./scripts/new-worktree.ps1 -Task $Task -Remove"
