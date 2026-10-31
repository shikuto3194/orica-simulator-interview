# Explicit Telegram work precedes ordinary audits/ISMCTS after infrastructure checks.
# This helper does not acquire lane locks, launch workers, or send reports.
function Get-SupervisorFollowupPlan {
  param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$Log
  )
  $acceptanceJson = & $Node $Script reconcile-acceptance --repo $Repo --worktree $Worktree 2>> $Log
  if ($LASTEXITCODE -ne 0 -or -not $acceptanceJson) { throw "Follow-up acceptance lookup failed; preserve requests and retry" }
  "[$(Get-Date -Format o)] follow-up acceptance: $($acceptanceJson -join '')" | Add-Content $Log
  $planJson = & $Node $Script plan --repo $Repo 2>> $Log
  if ($LASTEXITCODE -ne 0 -or -not $planJson) { throw "Follow-up plan failed; preserve requests and retry" }
  return ($planJson -join "`n") | ConvertFrom-Json
}

function Select-SupervisorFollowupWork {
  param($AuditPlan, $FollowupPlan)
  if ($FollowupPlan.schemaVersion -ne 1 -or $FollowupPlan.selectedIds -isnot [array] -or
      $FollowupPlan.block -isnot [string] -or @($FollowupPlan.selectedIds).Count -gt 1) {
    throw "Invalid follow-up dispatch plan"
  }
  foreach ($id in $FollowupPlan.selectedIds) {
    if ($id -isnot [string] -or $id -notmatch '^followup-[0-9a-f]{20}$') { throw "Invalid follow-up ID" }
  }
  if ($null -ne $FollowupPlan.auditTurnDue -and $FollowupPlan.auditTurnDue -isnot [bool]) {
    throw "Invalid follow-up audit turn"
  }
  if ($FollowupPlan.auditTurnDue -eq $true -and @($FollowupPlan.selectedIds).Count -eq 1 -and
      $AuditPlan.action -in @("implementation-required", "audit-review-required")) {
    return [pscustomobject]@{
      action = $AuditPlan.action
      selectedIds = @()
      auditForFollowupIds = @($FollowupPlan.selectedIds)
      workerFocus = "長期依頼 $($FollowupPlan.selectedIds -join ', ') は未完のまま保持。前回の実行枠が終了したため、今回は通常監査を最大1バッチ進める。監査worker起動後に依頼の次受入単位へ戻る。件数や終了コードで長期依頼を完了にしない。`n" + $AuditPlan.workerFocus
    }
  }
  if (@($FollowupPlan.selectedIds).Count -gt 0 -and
      $AuditPlan.action -in @("audits-clean", "implementation-required", "audit-review-required")) {
    return [pscustomobject]@{
      action = "telegram-work-required"
      selectedIds = @($FollowupPlan.selectedIds)
      workerFocus = "長期目標は今回検証・統合する受入単位を1つ定め、到達点・残条件・次の実験を既存taskへ記録する。未完のまま正常終了した依頼は、次に通常監査1バッチの実行枠を挟んで継続する。今回の最優先作業はTelegram依頼 $($FollowupPlan.selectedIds -join ', ')。durable follow-up欄の受付原本JSONと添付を全文読み、現行main・関連回帰・後続依頼と照合する。最初にmanual/ai-reference/00_meta/followup-acceptance.mdに従い既存の成功gate証跡を確認する。対応済みなら依頼IDごとの全受入条件・修正commit・実際の検査assertionをrecord-acceptanceへ登録し、reconcile-acceptanceで公開mainへの採用確認後に閉じる。同じ証跡で条件を満たす他のpending依頼も全文を読み個別にcoverageを確認して同じbatchへ含め、未確認IDを残す。文言の類似・後続ID・単なる終了コードで完了にしない。同じ内容と条件の有効証跡があれば重い共通検証を繰り返さない。証跡不足・新条件・変更・影響不明なら必要な通常検証へ戻す。修正が必要なら原文・添付・正源と照合し修正・回帰・gate・verifier・commit後に受入証跡を登録し親統合要求まで進む。統合要求中・未完了はpendingを保持する。通常のISMCTS/監査作業へ置き換えない。既存救出変更は保全し、前提復旧が必要なら依頼IDと理由を報告する。"
    }
  }
  return [pscustomobject]@{ action = $AuditPlan.action; workerFocus = $AuditPlan.workerFocus; selectedIds = @() }
}

function Get-SupervisorAuditIssues {
  param($Report, [string]$Field, [string[]]$Severities)
  $property = $Report.PSObject.Properties[$Field]
  if ($null -eq $property) { throw "missing $Field array" } # Unknown review counts are not zero.
  if ($property.Value -isnot [array]) { throw "invalid $Field array" }
  foreach ($issue in $property.Value) {
    if ($issue.cardNo -isnot [string] -or [string]::IsNullOrWhiteSpace($issue.cardNo) -or
        $issue.kind -isnot [string] -or [string]::IsNullOrWhiteSpace($issue.kind) -or
        $issue.detail -isnot [string] -or [string]::IsNullOrWhiteSpace($issue.detail) -or
        $issue.severity -notin $Severities) {
      throw "invalid $Field finding"
    }
    $issue
  }
}

function Format-SupervisorAuditIssue {
  param([string]$Audit, $Issue)
  $evidence = if ($Issue.evidence -is [string]) { $Issue.evidence } else { $Issue.evidence | ConvertTo-Json -Depth 12 -Compress }
  $suffix = if ($evidence) { " | evidence=$evidence" } else { "" }
  "- ${Audit}: $($Issue.cardNo) [$($Issue.kind)] $($Issue.detail)$suffix"
}

function Get-SupervisorReviewBatch {
  param([array]$CoverageReviews, [array]$FidelityReviews, [int]$Limit = 20)
  $entries = @(
    foreach ($source in @(@{ name = "coverage"; issues = $CoverageReviews }, @{ name = "fidelity"; issues = $FidelityReviews })) {
      foreach ($issue in $source.issues) {
        $revalidation = $issue.reviewResolution.previouslyReviewed -eq $true -or $issue.reviewResolution.reason -notin @($null, "unregistered", "registry_missing")
        [pscustomobject]@{
          audit = $source.name
          workType = if ($revalidation) { "revalidation" } else { "first-review" }
          priority = if ($revalidation) { 1 } else { 0 }
          kind = $issue.kind
          cardNo = $issue.cardNo
          issue = $issue
        }
      }
    }
  )
  # Finish previously unseen claims before repeatedly refreshing old receipts.
  # Keep a family together so one regression/verifier/commit covers the batch.
  @($entries | Sort-Object priority, kind, audit, cardNo | Select-Object -First $Limit)
}

function Invoke-SupervisorPreWorker {
  param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$Log,
    [string]$StorageScript = (Join-Path $PSScriptRoot "../artifact-storage.mjs")
  )

  $plan = [pscustomobject]@{
    action = "audits-clean"
    coverageTodo = $null
    fidelityViolations = $null
    coverageViolations = $null
    auditReviews = $null
    reviewBatch = @()
    auditInputs = $null
    workerFocus = "coverage / fidelity は review を含め全件0。ISMCTS programの次タスクを確認する。既存修正の必須 gate / verifier / commit / main 統合を省略しない。"
  }
  try {
    $storageJson = & $Node $StorageScript status --repo $Worktree
    $storageExit = $LASTEXITCODE
    $storage = ($storageJson -join "`n") | ConvertFrom-Json
    if ($storageExit -ne 0 -or $storage.status -notin @("ok", "warning", "blocked")) {
      throw "storage measurement failed: $($storage.workerFocus)"
    }
    if ($storage.status -ne "ok") {
      $plan.action = "storage-cleanup-required"
      $plan.workerFocus = "容量警告: artifacts=$($storage.totalGiB) GiB / free=$($storage.freeGiB) GiB. $($storage.workerFocus)"
      return [pscustomobject]@{
        plan = $plan
        loopJson = ([pscustomobject]@{ schemaVersion = 1; action = $plan.action; skipWorker = $false; harvestRan = $false } | ConvertTo-Json -Compress)
        loopExitCode = 0
      }
    }
  } catch {
    $plan.action = "storage-repair-required"
    $plan.workerFocus = "容量計測失敗。新規収集の前に計測を修復する: $($_.Exception.Message)"
    return [pscustomobject]@{
      plan = $plan
      loopJson = ([pscustomobject]@{ schemaVersion = 1; action = $plan.action; skipWorker = $false; harvestRan = $false } | ConvertTo-Json -Compress)
      loopExitCode = 0
    }
  }
  try {
    $reports = @{}
    foreach ($audit in @("cards-coverage.mjs", "cards-fidelity-audit.mjs")) {
      # Run the current worktree's audit, never a potentially stale saved report/baseline.
      #
      # Do not redirect the child stderr directly to the shared supervisor log.  Windows
      # permits another supervisor/relay writer to hold that file without append sharing;
      # in that case the redirection itself fails and turns a valid JSON audit into a
      # spurious audit-repair-required run.  Capture first, then make a best-effort log
      # append after the child has completed.
      $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) (
        "orica-supervisor-$($audit)-$([Guid]::NewGuid().ToString('N')).stderr"
      )
      try {
        $auditJson = & $Node (Join-Path $Worktree "scripts/$audit") --json 2> $stderrPath
        $auditExitCode = $LASTEXITCODE
        if (Test-Path -LiteralPath $stderrPath) {
          $auditStderr = Get-Content -Raw -LiteralPath $stderrPath
          if ($auditStderr) {
            try {
              [System.IO.File]::AppendAllText($Log, $auditStderr)
            } catch {
              # Logging must not invalidate a successfully measured audit.
            }
          }
        }
      } finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
      }
      if ($auditExitCode -ne 0 -or -not $auditJson) { throw "$audit failed (exit $auditExitCode)" }
      $reports[$audit] = ($auditJson -join "`n") | ConvertFrom-Json
    }
    $coverage = $reports["cards-coverage.mjs"]
    $fidelity = $reports["cards-fidelity-audit.mjs"]
    $mirror = $fidelity.auditInputs.mirror
    if ($null -eq $mirror -or $mirror.status -ne "present" -or $mirror.sha256 -notmatch '^[a-f0-9]{64}$') {
      throw "shared audit mirror is missing or unmeasured; restore the reviewed source version recorded in scripts/audit-mirror-provenance.json, not a stale lane copy"
    }
    $plan.auditInputs = $fidelity.auditInputs
    $todo = $coverage.totals.todo
    if (($todo -isnot [int] -and $todo -isnot [long]) -or $todo -lt 0 -or
        $coverage.todoCards -isnot [array] -or $coverage.todoCards.Count -ne $todo) {
      throw "cards-coverage.mjs returned invalid totals.todo / todoCards"
    }
    if ($fidelity.violations -isnot [array] -or $fidelity.clean -isnot [bool] -or
        $fidelity.clean -ne ($fidelity.violations.Count -eq 0)) {
      throw "cards-fidelity-audit.mjs returned invalid violations / clean"
    }
    $plan.coverageTodo = $todo
    $plan.fidelityViolations = $fidelity.violations.Count
    $coverageIssues = @(Get-SupervisorAuditIssues $coverage "auditIssues" @("violation", "review"))
    $coverageViolations = @($coverageIssues | Where-Object { $_.severity -eq "violation" })
    $coverageReviews = @($coverageIssues | Where-Object { $_.severity -eq "review" })
    $fidelityReviews = @(Get-SupervisorAuditIssues $fidelity "semanticReviews" @("review"))
    foreach ($check in @(
      @{ report = $coverage; field = "auditViolationCount"; count = $coverageViolations.Count },
      @{ report = $coverage; field = "auditReviewCount"; count = $coverageReviews.Count },
      @{ report = $fidelity; field = "semanticReviewCount"; count = $fidelityReviews.Count }
    )) {
      $property = $check.report.PSObject.Properties[$check.field]
      if ($null -eq $property -or ($property.Value -isnot [int] -and $property.Value -isnot [long]) -or $property.Value -ne $check.count) {
        throw "invalid $($check.field) count"
      }
    }
    $plan.coverageViolations = $coverageViolations.Count
    $plan.auditReviews = $coverageReviews.Count + $fidelityReviews.Count
    $plan.reviewBatch = @(Get-SupervisorReviewBatch $coverageReviews $fidelityReviews)
    if ($todo -gt 0 -or $plan.fidelityViolations -gt 0 -or $plan.coverageViolations -gt 0 -or $plan.auditReviews -gt 0) {
      $plan.action = if ($todo -gt 0 -or $plan.fidelityViolations -gt 0 -or $plan.coverageViolations -gt 0) { "implementation-required" } else { "audit-review-required" }
      $lines = @(
        "原文監査の対応が必要: coverage todo=$todo / structural violations=$($plan.coverageViolations) / fidelity violations=$($plan.fidelityViolations) / review=$($plan.auditReviews)。",
        "現在の engine-drain worktree で lane-prompt-codex-engine.md に従い、下記の原文監査結果を優先して対応する。無関係な assigned cluster を理由に監査結果を放置しない。",
        "(B) は親カードの backFace。原文を読み、実効果と盤面を検証する回帰テストを実装し、gate / verifier / commit / 統合まで進める。",
        "violation は検出された構造・本文制約の不一致。review は未確定の類似候補なので、必ず原文・Q&A・既存裁定と実装を照合してから修正する。",
        "正しい実装を誤検出した場合は、正しいDSL表現・carrierを検知器に認識させ、壊れた例と正しい例の両方を回帰にする。カード番号だけの除外や根拠のないbaseline更新で件数を消さない。",
        "静的には曖昧さが残る正しい実装は、manual/ai-reference/00_meta/fidelity-detection.md の confirmed_correct 手順で根拠・通常gateで実行する回帰を記録する。本文/実装/検知器/エンジン/裁定/テストの内容hashが一致する間だけ有効で、violationは解消できない。確認記録も回帰実行・verifier・commitの対象にする。",
        "裁定未確定は needs-ruling に根拠と質問を記録し、実装済みとは数えない。監査と修正後は両監査を再実行し、残件を次runへ渡す。",
        "stub 追加・textRef の付け替え・監査除外だけを実装完了としない。DSL 不足は共通 primitive を実装する。",
        "2026-10-05 ユーザー指示: 監査残件を修正後、ismcts-full-run/README.md のI0〜I7へ進む。監査0でtaskを停止しない。",
        "durable follow-up は監査修正または承認済みISMCTS programに必要なものを対応し、無関係な独立探索へ拡張しない。",
        "review は未着手を優先し、同種の最大20件を1バッチとして渡す。各候補の原文・盤面を確認し、確定分の変更をまとめてから関連回帰・finish-check・verifier・commit・統合を各1回行う。1件ごとの全件gateを繰り返さない。途中でコード修正が必要なら修正とその回帰を優先し、残件は未確認のまま次へ渡す。",
        "確認記録だけのバッチは pnpm codex:finish-check --plan の専用review gateを使う。engine/card-data変更は通常の全検証を維持する。記録生成だけで確認済みにしない。",
        "以下は違反の先頭20件ずつと、今回のreviewバッチ。全件は cards:coverage --json / cards:fidelity --json で確認する。"
      )
      $lines += @($coverage.todoCards | Select-Object -First 20 | ForEach-Object { "- coverage: $_" })
      $lines += @($fidelity.violations | Select-Object -First 20 | ForEach-Object { Format-SupervisorAuditIssue "fidelity" $_ })
      $lines += @($coverageViolations | Select-Object -First 20 | ForEach-Object { Format-SupervisorAuditIssue "coverage violation" $_ })
      $lines += @($plan.reviewBatch | ForEach-Object { Format-SupervisorAuditIssue "$($_.audit) $($_.workType)" $_.issue })
      $plan.workerFocus = $lines -join "`n"
    }
  } catch {
    # Unknown is not zero. Let a worker repair the measurement before any harvest.
    $plan.action = "audit-repair-required"
    $plan.workerFocus = "カード監査の計測失敗: $($_.Exception.Message)。残量0と扱わず、現在の worktree で cards:coverage / cards:fidelity の実行エラーを修正し、再計測後に実装へ進む。debug harvest は未実行。詳細: $Log"
  }

  return [pscustomobject]@{
    plan = $plan
    loopJson = ([pscustomobject]@{ schemaVersion = 1; action = $plan.action; skipWorker = $false; harvestRan = $false } | ConvertTo-Json -Compress)
    loopExitCode = 0
  }
}

# Bootstrap is deliberately useful before I0 exists. Unknown/corrupt plans repair,
# never finish or disable the task. I0 owns semantic receipt verification.
function Get-SupervisorIsmctsWork {
  param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][string]$Integration
  )
  $entry = "manual/ai-reference/30_plan/ismcts-full-run/README.md"
  $result = [pscustomobject]@{
    schemaVersion = 1
    action = "ismcts-implementation-required"
    skipWorker = $false
    nextTask = "I0"
    evidenceState = "unverified"
    workerFocus = "2026-10-05承認済みISMCTS programを開始する。$entry とtasks/resources/evidenceを読み、I0のcontroller・予算guard・証跡基盤を実装し検証・統合する。VM作成は課金見積により自動承認審査で拒否済み。承認済みPC経路を使い、I0完了前の大量探索/学習は禁止。既存変更があれば先に最終化する。"
  }
  $controller = Join-Path $Worktree "scripts/ismcts-program.mjs"
  if (-not (Test-Path -LiteralPath $controller -PathType Leaf)) { return $result }
  try {
    $json = & $Node $controller plan --repo $Repo --worktree $Worktree --integration $Integration
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "plan command failed (exit $LASTEXITCODE)" }
    $plan = ($json -join "`n") | ConvertFrom-Json -NoEnumerate
    if ($null -eq $plan -or $plan.GetType() -ne [System.Management.Automation.PSCustomObject] -or
        ($plan.schemaVersion -isnot [int] -and $plan.schemaVersion -isnot [long]) -or
        $plan.schemaVersion -ne 1 -or $plan.skipWorker -isnot [bool] -or
        $plan.action -isnot [string] -or $plan.nextTask -isnot [string] -or $plan.evidenceState -isnot [string] -or
        $plan.action -notin @("ismcts-implementation-required", "ismcts-monitor", "ismcts-wait") -or
        $plan.nextTask -notmatch '^(I[0-7]|maintenance)$' -or
        $plan.evidenceState -notin @("unverified", "valid", "invalid") -or
        $plan.workerFocus -isnot [string] -or [string]::IsNullOrWhiteSpace($plan.workerFocus)) {
      throw "invalid ISMCTS plan schema"
    }
    if (($plan.action -eq "ismcts-implementation-required" -and $plan.skipWorker) -or
        ($plan.action -eq "ismcts-monitor" -and ($plan.evidenceState -ne "valid" -or $plan.nextTask -ne "maintenance")) -or
        ($plan.action -eq "ismcts-wait" -and (-not $plan.skipWorker -or $plan.waitReason -isnot [string] -or $plan.waitReason -notin @("deferred_load", "deferred_budget", "awaiting_approval")))) {
      throw "inconsistent ISMCTS plan action"
    }
    if ($plan.skipWorker) {
      # A valid budget/monitor result cannot hide rescued or unpublished work.
      # Keep this cheap: no second set of card audits on an idle monitor tick.
      try {
        $pending = & git -C $Worktree status --porcelain
        if ($LASTEXITCODE -ne 0) { throw "lane status failed" }
        $branch = & git -C $Worktree branch --show-current
        if ($LASTEXITCODE -ne 0 -or -not $branch) { throw "lane branch check failed" }
        $stashes = & git -C $Worktree stash list '--format=%H%x09%gs'
        if ($LASTEXITCODE -ne 0) { throw "lane rescue stash check failed" }
        $rescued = @($stashes | Where-Object { $_.Contains("On ${branch}: sync-worktree auto-rescue") })
        & git -C $Worktree merge-base --is-ancestor HEAD refs/heads/main
        if ($LASTEXITCODE -notin @(0, 1)) { throw "lane integration check failed" }
        if ($pending -or $rescued.Count -gt 0 -or $LASTEXITCODE -eq 1) {
          throw "uncommitted/unmerged lane or unreviewed auto-rescue stash: $($rescued -join '; ')"
        }
      } catch {
        $result.nextTask = $plan.nextTask
        $result.workerFocus = "ISMCTS待機より既存変更の最終化を優先する。$($_.Exception.Message)。Git状態を確認し、未確認救出stashの確認・必要gate・verifier・commit・親への統合要求を完了する。他treeを変更せず、調査失敗をcleanとみなさない。"
        return $result
      }
    }
    return $plan
  } catch {
    $result.evidenceState = "invalid"
    $result.workerFocus = "ISMCTS controllerの計測失敗。完了・待機扱いにせずI0を修復する: $($_.Exception.Message)。$entry とevidence.mdに従い、修復・回帰・gate・verifier・統合を行う。"
    return $result
  }
}

# A zero result on an uncommitted/ahead lane must never disable the scheduler.
# Re-audit both trees only after confirming that the lane has landed on clean main.
function Get-SupervisorAuditCompletion {
  param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][string]$Log,
    [string]$StorageScript = (Join-Path $PSScriptRoot "../artifact-storage.mjs")
  )
  $result = [pscustomobject]@{ action = "finalization-required"; workerFocus = "監査0でも未統合の修正は終了扱いにしない。必須 gate / verifier / commit / main 統合を完了する。" }
  try {
    $laneStatus = & git -C $Worktree status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "lane git status failed" }
    if ($laneStatus) { return $result }
    $laneBranch = & git -C $Worktree branch --show-current
    if ($LASTEXITCODE -ne 0 -or -not $laneBranch) { throw "lane branch check failed" }
    $stashes = & git -C $Worktree stash list '--format=%H%x09%gs'
    if ($LASTEXITCODE -ne 0) { throw "lane rescue stash check failed" }
    $rescueStashes = @($stashes | Where-Object { $_.Contains("On ${laneBranch}: sync-worktree auto-rescue") })
    if ($rescueStashes.Count -gt 0) {
      $result.workerFocus = "監査0でも自動退避された未確認の修正が残るため停止しない。救出stashの内容を確認し、採用する修正は復元・検証・main統合する。不要と判断する場合も根拠と保存先を記録する。`n" + ($rescueStashes -join "`n")
      return $result
    }
    $laneHead = & git -C $Worktree rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "lane HEAD check failed" }
    & git -C $Worktree merge-base --is-ancestor HEAD main
    if ($LASTEXITCODE -eq 1) { return $result }
    if ($LASTEXITCODE -ne 0) { throw "lane integration check failed" }
    $mainBranch = & git -C $Repo branch --show-current
    if ($LASTEXITCODE -ne 0) { throw "primary branch check failed" }
    $mainStatus = & git -C $Repo status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "primary git status failed" }
    if ($mainBranch -ne "main" -or $mainStatus) {
      $result.action = "awaiting-primary"
      $result.workerFocus = "監査対象の修正は統合済み。対話側primaryの作業終了後に再計測する。taskは有効のまま維持し、他タスクの変更・branchには触らない。"
      return $result
    }
    $mainHead = & git -C $Repo rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "primary HEAD check failed" }
    $inputFingerprint = $null
    foreach ($tree in @($Worktree, $Repo)) {
      $fresh = Invoke-SupervisorPreWorker -Node $Node -Worktree $tree -Log $Log -StorageScript $StorageScript
      if ($fresh.plan.action -ne "audits-clean") {
        $result.action = $fresh.plan.action
        $result.workerFocus = $fresh.plan.workerFocus
        return $result
      }
      $currentInput = $fresh.plan.auditInputs.mirror.sha256
      if ($null -ne $inputFingerprint -and $currentInput -ne $inputFingerprint) { throw "audit inputs changed between lane and main" }
      $inputFingerprint = $currentInput
    }
    $currentHead = & git -C $Repo rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $currentHead -ne $mainHead) { throw "primary changed during audit" }
    $currentLaneHead = & git -C $Worktree rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $currentLaneHead -ne $laneHead) { throw "lane changed during audit" }
    $currentBranch = & git -C $Repo branch --show-current
    if ($LASTEXITCODE -ne 0 -or $currentBranch -ne "main") { throw "primary branch changed during audit" }
    foreach ($tree in @($Worktree, $Repo)) {
      $status = & git -C $tree status --porcelain
      if ($LASTEXITCODE -ne 0 -or $status) { throw "tree changed during audit" }
    }
    $result.action = "audits-complete"
    $result | Add-Member -NotePropertyName mainCommit -NotePropertyValue $mainHead
    $result.workerFocus = "coverage / fidelity の todo・violation・review 全件0、修正main統合済み。ユーザー許可済みの監査範囲終了。AIデバッグを含む旧フルラン全体の完了は意味しない。"
  } catch {
    $result.action = "completion-check-failed"
    $result.workerFocus = "停止確認失敗。taskは有効のまま維持し、次runで再計測する: $($_.Exception.Message)"
  }
  return $result
}
