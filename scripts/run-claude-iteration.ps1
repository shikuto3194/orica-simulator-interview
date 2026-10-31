# run-claude-iteration.ps1 — 旧 task 名向けの Codex 互換 shim。
#
# Claude worker は廃止済み。このファイルを古い Scheduled Task や手動コマンドから
# 呼んでも Claude CLI は解決・起動せず、現行 Codex supervisor の 1 iteration へ転送する。

$ErrorActionPreference = "Stop"
$Repo = "C:\dev\orica-simulator"
$Pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $Pwsh)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $Pwsh = $resolvedPwsh.Source }
}
if (-not (Test-Path $Pwsh)) {
  Write-Error "[legacy-engine-shim] pwsh.exe が見つからない"
  exit 1
}

$SupervisorWrapper = Join-Path $Repo "scripts\run-supervisor-iteration.ps1"
Write-Warning "[legacy-engine-shim] Claude lane は廃止済み。Codex supervisor へ転送する。"
& $Pwsh -NoProfile -ExecutionPolicy Bypass -File $SupervisorWrapper
exit $LASTEXITCODE
