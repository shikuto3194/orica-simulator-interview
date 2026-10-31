# usage-limit-breaker.ps1 — usage limit サーキットブレーカー共通ロジック。
#
# Codex/Claude 両CLIが「usage limit ... try again at <date>」形式のエラーを返した
# ケースで、リセットまで盲目的にリトライし続けて空撃ちする事故が発生した
# (2026-07-02、orica-full-run-supervisor が 04:00〜13:00 に10連続 exit 1)。
# レーンごとの state file に reset 日時を記録し、それまでの run は CLI 起動どころか
# supervisor/run lock acquire 前に即 skip する。3レーン
# (run-supervisor-iteration.ps1 / run-card-impl-iteration.ps1)
# で同じ判別・パース処理を持たないよう共通化 (SSOT)。
#
# 呼び出し側の使い方 (各 *-iteration.ps1):
#   . (Join-Path $Repo "scripts\lib\usage-limit-breaker.ps1")
#   $Log 定義直後に: if (Test-UsageLimitBreaker -LogDir $LogDir -Lane "<lane>" -Log $Log) { exit 0 }
#   worker 呼び出し直後 ($code 確定後) に:
#     Register-UsageLimitHitIfDetected -LogDir $LogDir -Lane "<lane>" -Log $Log -Code $code
#
# 手動解除: `pnpm usage-limit:clear` (scripts/clear-usage-limit.mjs) で
# logs/usage-limit-state.<lane>.json を削除できる（ユーザーが reset 日時より前に
# クォータを回復させた場合など、state file は検知時点の reset 日時しか知らないため）。

function Get-UsageLimitStateFilePath {
  param([string]$LogDir, [string]$Lane)
  return Join-Path $LogDir "usage-limit-state.$Lane.json"
}

# "You've hit your usage limit. ... try again at Jul 7th, 2026 10:49 AM." から
# reset 日時を抽出する。パース不能なら $null を返す (呼び出し側は WARN ログのみ、致命扱いしない)。
function Get-UsageLimitResetDateFromText {
  param([string]$Text)
  $m = [regex]::Match(
    $Text,
    'try again at ([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)',
    'IgnoreCase'
  )
  if (-not $m.Success) { return $null }
  $normalized = "{0} {1}, {2} {3}:{4} {5}" -f $m.Groups[1].Value, $m.Groups[2].Value, `
    $m.Groups[3].Value, $m.Groups[4].Value, $m.Groups[5].Value, $m.Groups[6].Value.ToUpperInvariant()
  foreach ($fmt in @("MMM d, yyyy h:mm tt", "MMMM d, yyyy h:mm tt")) {
    try {
      return [DateTime]::ParseExact($normalized, $fmt, [System.Globalization.CultureInfo]::InvariantCulture)
    }
    catch { }
  }
  return $null
}

# 各 *-iteration.ps1 の冒頭で呼ぶ。armed 中で reset 日時前なら $true を返す
# （呼び出し側は CLI 起動・lock acquire を一切せず exit 0 する）。
# reset 経過後は state file を自動削除して $false を返す（通常運用に復帰）。
function Test-UsageLimitBreaker {
  param([string]$LogDir, [string]$Lane, [string]$Log)
  $stateFile = Get-UsageLimitStateFilePath -LogDir $LogDir -Lane $Lane
  if (-not (Test-Path $stateFile)) { return $false }
  try {
    $state = Get-Content -Raw $stateFile | ConvertFrom-Json
    $resetAt = [DateTime]::Parse(
      $state.resetAt, [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::RoundtripKind
    )
    if ((Get-Date) -lt $resetAt) {
      "[$(Get-Date -Format o)] $Lane run skipped: usage limit circuit breaker active until $($state.resetAt) (detected $($state.detectedAt))" | Add-Content $Log
      return $true
    }
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    "[$(Get-Date -Format o)] $Lane usage limit circuit breaker expired ($($state.resetAt) 経過), 通常運用に復帰" | Add-Content $Log
    return $false
  }
  catch {
    "[$(Get-Date -Format o)] WARN: $Lane usage limit state file 解析失敗、無視して続行 ($($_.Exception.Message))" | Add-Content $Log
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    return $false
  }
}

# worker 呼び出し直後 ($code 確定後) に呼ぶ。失敗時のみログ末尾から usage limit を検知し、
# 検知できれば reset 日時を state file に記録して armed する。
function Register-UsageLimitHitIfDetected {
  param([string]$LogDir, [string]$Lane, [string]$Log, [int]$Code)
  if ($Code -eq 0) { return }
  $tail = Get-Content $Log -Tail 200 -ErrorAction SilentlyContinue
  $hitLine = $tail | Where-Object { $_ -match "hit your usage limit" } | Select-Object -Last 1
  if (-not $hitLine) { return }
  $resetAt = Get-UsageLimitResetDateFromText -Text $hitLine
  if (-not $resetAt) {
    "[$(Get-Date -Format o)] WARN: $Lane usage limit 検知したが reset 日時のパースに失敗: $hitLine" | Add-Content $Log
    return
  }
  $stateFile = Get-UsageLimitStateFilePath -LogDir $LogDir -Lane $Lane
  $stateJson = @{
    resetAt    = $resetAt.ToString("o")
    detectedAt = (Get-Date -Format o)
    rawMessage = $hitLine.Trim()
  } | ConvertTo-Json
  Set-Content -Path $stateFile -Value $stateJson -Encoding UTF8
  "[$(Get-Date -Format o)] $Lane usage limit circuit breaker armed until $($resetAt.ToString('o'))" | Add-Content $Log
}
