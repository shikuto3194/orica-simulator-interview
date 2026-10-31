# register-claude-task.ps1 — 旧コマンド名向けの Codex supervisor 互換入口。
#
# 新しい Claude task は登録しない。通常呼出しは register-supervisor-task.ps1 へ転送する。
# -Unregister は残存する旧 task 名だけを削除し、Codex supervisor には触れない。

param(
  [int]$IntervalMinutes = 60,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$LegacyTaskName = "orica-engine-claude-iteration"
$Repo = "C:\dev\orica-simulator"

if ($Unregister) {
  schtasks /Delete /TN $LegacyTaskName /F *> $null
  Write-Host "[legacy-register] legacy task '$LegacyTaskName' を削除した" -ForegroundColor Green
  exit 0
}

$Pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $Pwsh)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $Pwsh = $resolvedPwsh.Source }
}
if (-not (Test-Path $Pwsh)) {
  Write-Error "[legacy-register] pwsh.exe が見つからない"
  exit 1
}

Write-Warning "[legacy-register] Claude task は登録しない。Codex supervisor を登録する。"
& $Pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\register-supervisor-task.ps1") -IntervalMinutes $IntervalMinutes
exit $LASTEXITCODE
