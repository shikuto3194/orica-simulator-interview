# change-engine-claude-interval.ps1 — 旧コマンド名向けの Codex supervisor 互換入口。
#
# Claude lane は廃止済み。指定間隔で Codex supervisor task を再登録する。

param(
  [Parameter(Mandatory = $true)][int]$IntervalMinutes
)

$ErrorActionPreference = "Stop"
$Repo = "C:\dev\orica-simulator"
$Pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $Pwsh)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $Pwsh = $resolvedPwsh.Source }
}
if (-not (Test-Path $Pwsh)) {
  Write-Error "[legacy-interval] pwsh.exe が見つからない"
  exit 1
}

Write-Warning "[legacy-interval] Claude lane は廃止済み。Codex supervisor の間隔を変更する。"
& $Pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\register-supervisor-task.ps1") -IntervalMinutes $IntervalMinutes
exit $LASTEXITCODE
