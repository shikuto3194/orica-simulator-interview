#!/usr/bin/env pwsh
<#
.SYNOPSIS
  プロジェクトを OneDrive 外 (C:\dev\orica-simulator) へ移動する。
  OneDrive が .git / ソースを同期することによる破損リスク・ファイル監視の取りこぼし
  (stale dev server)・セッション中のツリー変動を解消する。

.DESCRIPTION
  - 同一ボリューム (C:) 内の移動なので即時リネーム。852MB の .git でも一瞬。
  - node_modules / dist の junction (-> C:\dev\orica-ext) は絶対パス先なので移動後も機能する。
  - Claude Code はプロジェクトをパス由来のキーで管理するため、メモリ/セッション履歴を
    新パスのキーへ複製する (旧キーは保全)。
  - データ安全ガード: 作業ツリーが clean かつ origin/main と同期済みのときだけ移動する。

  ★ 実行前チェックリスト:
    1) この PowerShell をプロジェクト「外」で開く (例: cd C:\ )。中に居ると移動できない。
    2) dev サーバー / エディタ / Claude Code セッションを全て閉じる
       (ファイルロック回避 + セッション履歴を取りこぼさず複製するため)。
    3) OneDrive を一時停止 (タスクトレイ -> 同期の一時停止)。移動後に再開すると
       移動元のクラウドコピーが削除される (= 想定どおり)。

.PARAMETER Source
  既定 C:\Users\kensh\OneDrive\ドキュメント\orica-simulator
.PARAMETER Dest
  既定 C:\dev\orica-simulator
.PARAMETER Force
  clean でない / origin と未同期でも続行 (緊急時のみ・非推奨)。

.EXAMPLE
  cd C:\
  & "C:\Users\kensh\OneDrive\ドキュメント\orica-simulator\scripts\migrate-out-of-onedrive.ps1"
#>
[CmdletBinding()]
param(
  [string]$Source = "C:\Users\kensh\OneDrive\ドキュメント\orica-simulator",
  [string]$Dest   = "C:\dev\orica-simulator",
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$env:GIT_TERMINAL_PROMPT = "0"   # git が認証待ちでハングするのを防ぐ (失敗させる)

function ConvertTo-ClaudeProjectKey([string]$p) {
  # Claude Code のプロジェクトキー: 英数字以外を '-' に置換 (大文字小文字は保持)。
  # 例 C:\Users\kensh\OneDrive\ドキュメント\orica-simulator
  #  -> C--Users-kensh-OneDrive--------orica-simulator
  return ($p -replace '[^A-Za-z0-9]', '-')
}

# 0) このシェルがプロジェクト内に居ないこと (中に居ると移動不可)
$here = (Get-Location).Path
if ($here.ToLower().StartsWith($Source.ToLower())) {
  throw "このシェルはプロジェクト内 ($here) です。cd C:\ など外へ出てから再実行してください。"
}

# 1) ソース存在 / 移動先未存在
if (-not (Test-Path -LiteralPath $Source)) { throw "ソースが見つからない: $Source" }
if (Test-Path -LiteralPath $Dest) { throw "移動先が既に存在: $Dest (中身を退避してから再実行)" }

# 2) OneDrive 稼働中なら警告
if (Get-Process -Name OneDrive -ErrorAction SilentlyContinue) {
  Write-Warning "OneDrive が稼働中です。移動前に一時停止を強く推奨 (ファイルロック / 競合回避)。"
}

# 3) git 安全ガード: clean かつ origin/main と同期済み (Force 時はスキップ)
Push-Location $Source
try {
  $dirty = git status --porcelain
  if ($dirty -and -not $Force) {
    Write-Host $dirty
    throw "作業ツリーが clean ではありません。commit/push してから再実行 (緊急時のみ -Force)。"
  }
  if (-not $Force) {
    $local = (git rev-parse HEAD).Trim()
    git fetch origin --quiet
    $remote = (git rev-parse origin/main).Trim()
    if ($local -ne $remote) {
      throw "origin/main ($remote) とローカル HEAD ($local) が不一致。git push origin main 後に再実行 (緊急時のみ -Force)。"
    }
    Write-Host "git ガード OK (clean / origin と同期: $local)" -ForegroundColor Green
  }
} finally { Pop-Location }

# 4) 移動 (同一ボリューム = 即時 atomic rename)
#    Move-Item は node_modules 等の junction へ再帰し部分移動・失敗するため使わない。
#    [System.IO.Directory]::Move は再帰せずトップのディレクトリエントリのみ改名する
#    (junction / 読み取り専用 / hidden な子もそのまま一緒に移動する)。
New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
[System.IO.Directory]::Move($Source, $Dest)
Write-Host "移動完了: $Source -> $Dest" -ForegroundColor Green

# 5) Claude Code メモリ/セッション履歴の引き継ぎ (旧キーは保全)
$projBase = Join-Path $env:USERPROFILE ".claude\projects"
$oldDir = Join-Path $projBase (ConvertTo-ClaudeProjectKey $Source)
$newDir = Join-Path $projBase (ConvertTo-ClaudeProjectKey $Dest)
if ((Test-Path -LiteralPath $oldDir) -and -not (Test-Path -LiteralPath $newDir)) {
  Copy-Item -LiteralPath $oldDir -Destination $newDir -Recurse -ErrorAction SilentlyContinue
  Write-Host "Claude メモリ/履歴を複製: $oldDir -> $newDir" -ForegroundColor Green
} elseif (Test-Path -LiteralPath $newDir) {
  Write-Warning "新キーが既存のため複製skip: $newDir (必要なら手動マージ)"
} else {
  Write-Warning "旧キーが見つからず複製skip: $oldDir"
}

# 6) 残り手順の案内
Write-Host ""
Write-Host "=== 残り手順 ===" -ForegroundColor Cyan
Write-Host "1) cd `"$Dest`""
Write-Host "2) git status / pnpm test で動作確認 (junction が C:\dev\orica-ext を指して生きているか)"
Write-Host "3) OneDrive を再開 (移動元のクラウドコピーは自動削除 = 想定どおり)"
Write-Host "4) 今後この新パスでセッション / エディタを開く"
Write-Host "5) (任意) node_modules/dist を project 内へ戻して C:\dev\orica-ext 依存を解消:"
Write-Host "     & `"$Dest\scripts\externalize-onedrive.ps1`" -Restore"
Write-Host "   OneDrive 外になったので junction 退避はもう不要。"
