#!/usr/bin/env pwsh
<#
.SYNOPSIS
  OneDrive 同期の負荷源（node_modules・ビルド成果物・重い未追跡アセット）を
  OneDrive 外へ退避し、元の場所に junction を張る（パス維持のまま非同期化）。

.DESCRIPTION
  OneDrive は junction / reparse point を同期対象外にする性質を利用する。
  実体を ExternalBase（既定 C:\dev\orica-ext）へ Move（同一ボリュームなら即時リネーム）し、
  元パスに mklink /J で junction を作る。データは削除せず保全する。
    - 安全策: git 追跡下のパスは対象から除外（誤って junction 化しない）。
    - 冪等  : 既に junction のパスはスキップ。
    - 失敗時: その対象だけ巻き戻し、他は続行（処理結果を最後に一覧表示）。

  ※ 実行前に OneDrive を一時停止（タスクトレイ → 同期の一時停止）しておくと、
     ファイルロックによる Move 失敗を避けられる。

.PARAMETER ExternalBase
  実体の退避先。既定 C:\dev\orica-ext（OneDrive 外）。

.PARAMETER Targets
  リポジトリルートからの相対パス配列。

.PARAMETER Restore
  逆操作。junction を外し、実体を元の場所へ戻す。

.EXAMPLE
  ./scripts/externalize-onedrive.ps1
  ./scripts/externalize-onedrive.ps1 -Restore
#>
[CmdletBinding()]
param(
  [string]$ExternalBase = "C:\dev\orica-ext",
  [string[]]$Targets = @(
    "node_modules",
    "apps/cli/dist",
    "apps/playground-web/dist",
    "packages/ai/dist",
    "packages/card-data/dist",
    "packages/rules-core/dist"
  ),
  [switch]$Restore
)

$ErrorActionPreference = "Stop"

$repoRoot = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw "git リポジトリが見つかりません ($PSScriptRoot)" }
$repoRoot = $repoRoot -replace '/', '\'

function Test-IsJunction([string]$p) {
  # OneDrive Files On-Demand は全アイテムに ReparsePoint 属性を付けるため、属性では判定不可。
  # LinkType（Junction / SymbolicLink のみ非 null）で本物の junction だけを検出する。
  if (-not (Test-Path -LiteralPath $p)) { return $false }
  $lt = (Get-Item -LiteralPath $p -Force).LinkType
  return ($lt -eq 'Junction' -or $lt -eq 'SymbolicLink')
}

$results = @()

foreach ($rel in $Targets) {
  $relWin   = $rel -replace '/', '\'
  $linkPath = Join-Path $repoRoot $relWin
  $extPath  = Join-Path $ExternalBase $relWin
  $status   = ""

  try {
    if ($Restore) {
      if (Test-IsJunction $linkPath) {
        [System.IO.Directory]::Delete($linkPath, $false)   # junction リンクのみ削除（実体は残る）
        if (Test-Path -LiteralPath $extPath) {
          New-Item -ItemType Directory -Force -Path (Split-Path $linkPath) | Out-Null
          Move-Item -LiteralPath $extPath -Destination $linkPath
          $status = "restored ← $extPath"
        } else {
          $status = "WARN: 実体が見つからない ($extPath)"
        }
      } else {
        $status = "skip (junction でない)"
      }
      $results += [pscustomobject]@{ Target = $rel; Result = $status }
      continue
    }

    # --- externalize ---
    if (-not (Test-Path -LiteralPath $linkPath)) { $results += [pscustomobject]@{ Target = $rel; Result = "skip (なし)" }; continue }
    if (Test-IsJunction $linkPath) { $results += [pscustomobject]@{ Target = $rel; Result = "skip (既に junction)" }; continue }

    # 安全策: git 追跡下なら除外
    $tracked = git -C $repoRoot ls-files -- "$rel" | Select-Object -First 1
    if ($tracked) { $results += [pscustomobject]@{ Target = $rel; Result = "SKIP: git 追跡下のため除外" }; continue }

    if (Test-Path -LiteralPath $extPath) { throw "退避先が既に存在: $extPath" }

    New-Item -ItemType Directory -Force -Path (Split-Path $extPath) | Out-Null
    Move-Item -LiteralPath $linkPath -Destination $extPath
    cmd /c mklink /J "$linkPath" "$extPath" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Move-Item -LiteralPath $extPath -Destination $linkPath   # 巻き戻し
      throw "mklink 失敗（巻き戻し済み）"
    }
    $status = "externalized → $extPath"
  } catch {
    $status = "ERROR: $($_.Exception.Message)"
  }

  $results += [pscustomobject]@{ Target = $rel; Result = $status }
}

Write-Host ""
$results | Format-Table -AutoSize
Write-Host "確認: git status（追跡変更なし）/ pnpm / build が正常に動くこと。" -ForegroundColor Cyan
