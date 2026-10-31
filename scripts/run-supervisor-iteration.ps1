# run-supervisor-iteration.ps1 — orica-full-run-supervisor タスクの 1 回分の実体。
#
# headless Codex を新規文脈で起動し full-run-worker-brief.md の 1 イテレーションを無人実行する。
# 各 run は新規文脈なので、冒頭は軽量 brief + active lane prompt だけを読ませる。
# 単一インスタンス保証は二重: (1) タスクの MultipleInstances IgnoreNew、
# (2) wrapper が owner token 付き supervisor-lock をCodex起動前に acquire。
#
# 2026-10-06 ユーザー許可: AI強化は可能なら24時間自律実行。LLM成果確認は実装・検証後に2時間間隔へ。
# 正源: manual/ai-reference/30_plan/full-run-supervisor.md / full-run-worker-brief.md

$ErrorActionPreference = "Stop"
# Node emits UTF-8; merged redirection and captured output decode through the
# console encoding. Keep native stdin UTF-8 as well, before any native command.
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-ChildItem Env:GIT_* | ForEach-Object { Remove-Item -LiteralPath $_.PSPath }
$Repo = "C:\dev\orica-simulator"
$Control = Split-Path -Parent $PSScriptRoot
# 無人 run は worktree でのみ作業（full-run-supervisor.md 正源、main working tree は対話セッション専有）。
# supervisor は engine worktree で coverage / fidelity の実装残件も処理する。
# card-data と DSL の両方を修正できる単一 worker とし、別の cards task の起動を待たない。
$Worktree = $null
$LogDir = Join-Path $Repo "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
. (Join-Path $Control 'scripts\lib\supervisor-run-log.ps1')
$Log = New-SupervisorRunLog -LogDir $LogDir -RunProcessId $PID
$env:ORICA_SUPERVISOR_RUN_LOG = $Log
$BootstrapLog = Join-Path $LogDir "supervisor-bootstrap.log"

# worker 本体・usage breaker・lock 以前の例外も残す。Task Scheduler Operational log が無効でも
# 「PowerShell に入ったか」を切り分けられるよう、通常の巨大な run log と分離する。
function Write-SupervisorBootstrapLog {
  param([string]$Message)
  try {
    "[$(Get-Date -Format o)] pid=$PID user=$env:USERNAME $Message" | Add-Content -LiteralPath $BootstrapLog
  } catch {
    # Bootstrap log 自体の I/O 障害は task の終了コードに任せる。ここで例外を隠して通常処理を壊さない。
  }
}

trap {
  Write-SupervisorBootstrapLog "UNHANDLED: $($_.Exception.Message)"
  exit 1
}

Write-SupervisorBootstrapLog "wrapper entered runLog=$Log"

# usage limit サーキットブレーカー (2026-07-02 導入、2026-07-02 に3レーン共通化):
# Codex が "usage limit ... try again at <date>" を返すとリセットまで盲目的に
# 毎時リトライして空撃ちする事故が発生 (04:00〜13:00 に10連続 exit 1)。判別・パース処理は
# scripts/lib/usage-limit-breaker.ps1 に SSOT 化（run-card-impl-iteration.ps1 と共通）。
# タスク自体は有効のまま (ENABLE/DISABLE はユーザー
# 専権、これは同一の「実行許可」内でのコスト回避に過ぎない)。reset 経過後は自動的に通常運用へ戻る。
# 手動解除: `pnpm usage-limit:clear` (reset 日時より前にユーザーがクォータを回復させた場合)。
. (Join-Path $Control "scripts\lib\usage-limit-breaker.ps1")
try {
  if (Test-UsageLimitBreaker -LogDir $LogDir -Lane "codex-supervisor" -Log $Log) {
    Write-SupervisorBootstrapLog "usage-limit breaker defers new worker; reconcile completed publications first"
    $workerUsageBlocked = $true
  }
} catch {
  Write-SupervisorBootstrapLog "usage-limit breaker failed: $($_.Exception.Message)"
  exit 1
}

# Codex CLI 解決（PATH に無い scheduled-task 文脈でも動くよう絶対パス優先）。
$codex = $null
# The bundled CLI supports the full-run model; older npm CLIs may reject it.
$bundledCodexRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
$bundledCodex = Get-ChildItem -LiteralPath $bundledCodexRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  ForEach-Object { Join-Path $_.FullName "codex.exe" } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
foreach ($c in @(
  $bundledCodex,
  "$env:APPDATA\npm\codex.cmd",
  "$env:LOCALAPPDATA\Microsoft\WindowsApps\codex.exe"
)) {
  if ($c -and (Test-Path -LiteralPath $c)) { $codex = $c; break }
}
if (-not $codex) {
  $resolvedCodex = Get-Command codex.exe -ErrorAction SilentlyContinue
  if (-not $resolvedCodex) { $resolvedCodex = Get-Command codex.cmd -ErrorAction SilentlyContinue }
  if ($resolvedCodex) { $codex = $resolvedCodex.Source }
}

# node 解決（scheduled-task 文脈は PATH に無いことがある）。Codex JSONL を state/outbox に
# 保存する stream ラッパーの起動に使う。
$node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $node = $n; break }
}
if (-not $node) { $node = "node" }

$prompt = @'
あなたは orica-simulator フルラン supervisor の Codex worker（新規文脈）です。
CLAUDE.md と manual/ai-reference/30_plan/full-run-worker-brief.md を読み、1 run を実行してください。

2026-10-05開始・2026-10-06追加のユーザー明示指示（旧AI除外・監査0停止・9停止条件より優先）:
- ISMCTSの実装と検証はこのフルランが担う。manual/ai-reference/30_plan/ismcts-full-run/README.md を入口にI0〜I7を依存順で実行する。
- continuous-learning.md に従い、資源が許す限り24時間の生成・学習・評価・モデル自動更新をLLM非依存で実装する。I0の時間予算移行とI6a/b/c・I7の72時間自律運用証跡を満たす。120分は当初のLLM成果確認周期であり学習周期ではない。
- solo-fallback.md に従い、一人バトルは現行モデル→旧正常モデル→checkpoint不要の簡易AIへ復帰する。探索service全停止・旧版破損でも全入力を合法に完了し、二重適用・秘密情報参照・認証迂回を防ぐ。
- coverage / fidelity の残件・計測失敗は先に修復する。監査0だけで停止せずISMCTSへ進む。無関係なEDH探索/無制限soakへ拡張しない。
- VM経路は確認済みだが、月額見積のため作成は自動承認審査で拒否された。VM容量は未確認。PC CPU/GPU代替は承認済み。resources.mdの実用上限を守り、課金VM作成を別経路で再試行しない。
- I0の資源guardと証跡基盤を先に実装する。秘密情報境界・完全な合法入力・本番GUI接続・性能を実ログで反証する。古い緑や自己申告で次タスクへ進まない。
- 実装・検証・配備完了後、I7の親側検証で既存taskを120分間隔へ移行し監視/修正を継続する。workerが手動disableや早期移行をしてはならない。
- supervisor lockはwrapperが取得・refresh・解放する。worker/sub-agentは操作しない。
- 容量警告/計測失敗はartifact-storage.mdに従い処理する。保護データ削除や上限引上げで回避しない。
- 監査対象は現在のengine-drainでlane-prompt-codex-engine.mdに従い対応する。DSL拡張も監査修正に必要な範囲を扱う。
- tree変更とsnapshot/queue更新 → 必須gate → adversarial verifier → pnpm verified-commit → 統合要求の順を守る。統合は node scripts/supervisor-integration.mjs request で親runnerへ渡し、fuzz省略は要求しない。確認記録のみの検証範囲はmanifestが自動判定する。要求後はtreeを変更せず終了する。親runnerがauto-mergeの終了コード・ログ・remote mainを確認してからrunを完了する。primaryの別タスクのbranchや未コミット差分に触らない。
- 監査元の版不一致は実装修正ではなく入力の確認対象。scripts/audit-mirror-provenance.json と配布元・訂正履歴・カード画像を照合する。古いミラーに合わせた値やテストの巻き戻し、hashだけの無根拠な更新は禁止。
- wrapperが選択したTelegram依頼は通常の監査/ISMCTSより優先する。運用報告は参照データとして扱い、古い方針で現在の依頼を覆さない。実装済み/配備済み/監視移行済み/強さ実証済みを分けて報告する。
- 進捗/裁定は既存supervisor-report経路へ記録する。runnerの最終回答報告と重複させない。
- 修正途中のVitest単体確認は pnpm test:unit <repo相対の.test.tsファイル...> を使う。共有lease・最大2forkで対象ファイルを確認し、単体成功を最終finish・独立査読・ledger・fuzz・統合検証の代用にしない。
- adversarial-verifier-prompt.mdはcommit直前にspawn-verifier.mjsから読む。

== 他laneが機械ロック保持中のscope（カード/効果を触らない） ==
__OFF_LIMITS__

== 前runのクラッシュ救出stash ==
__CRASH_STASH_BLOCK__

== durable supervisor follow-ups ==
__SUPERVISOR_FOLLOWUPS__

== Telegram inbox (Codex only) ==
__CODEX_INBOX_BLOCK__

== 今回の作業指示 (wrapperの最終判断) ==
__WORKER_FOCUS__
'@

"[$(Get-Date -Format o)] supervisor run start (cli=$codex)" | Add-Content $Log
Write-SupervisorBootstrapLog "supervisor run start (cli=$codex)"

$lockScript = Join-Path $Control "scripts\supervisor-lock.mjs"
$lockToken = [guid]::NewGuid().ToString("N")
$lockLabel = "run-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$lockLane = "supervisor"

# 障害復旧構造 (2026-06-21):
# 旧構造は acquire→各種準備→try{worker}finally{release} で、try の前で異常終了 (例:
# $ErrorActionPreference="Stop" 由来の throw・外部 kill) すると lock release も
# `supervisor run end` 行も書かれず追跡不能になっていた。新構造は acquire 直後に外側
# try/finally で全包し、acquire 成立時のみ finally で release + end 行を必ず書く。
# acquire 自体が失敗 (skipped/abort) のときは end 行を書かない (skip/abort 行で代替)。
$code = 1
$lockAcquired = $false
$CodexOnly = $true
$cardLockLane = "card-impl"
$cardLockToken = [guid]::NewGuid().ToString("N")
$cardLockAcquired = $false

try {
  # wrapper 自身が Codex 起動前に原子的に取得する。保持中 (exit 1) は正常な間引き。
  # TTL 240分: Claude lane と同じく、1 イテレーション (cluster 拡張 + 解禁カード + ゲート + verifier)
  # に十分な上限。既存 run が駆動中なら新しい Codex worker は起動しない。
  & $node $lockScript acquire --token $lockToken --label $lockLabel --lane $lockLane --ttl 240 *>> $Log 2>&1
  $lockAcquireCode = $LASTEXITCODE
  if ($lockAcquireCode -eq 1) {
    "[$(Get-Date -Format o)] supervisor run skipped: lock held (lane=$lockLane)" | Add-Content $Log
    # finally で release は不要 (lockAcquired=false で skip)。直接 exit 0 で確定。
    exit 0
  }
  if ($lockAcquireCode -ne 0) {
    "[$(Get-Date -Format o)] ABORT: supervisor lock acquire failed (lane=$lockLane, exit $lockAcquireCode)" | Add-Content $Log
    exit 1
  }
  $lockAcquired = $true

  # Coverage cards can also be selected by the independent card task. Share its
  # lane lease instead of claiming an unrelated exploration/debug cluster.
  & $node $lockScript acquire --token $cardLockToken --label $lockLabel --lane $cardLockLane --ttl 240 *>> $Log 2>&1
  $cardAcquireCode = $LASTEXITCODE
  if ($cardAcquireCode -ne 0) {
    $code = if ($cardAcquireCode -eq 1) { 0 } else { 1 }
    "[$(Get-Date -Format o)] audit worker deferred: card lane lock unavailable (exit $cardAcquireCode)" | Add-Content $Log
    exit $code
  }
  $cardLockAcquired = $true

  # Validate the pinned lane before recovery/stash/sync can write anything.
  . (Join-Path $Control "scripts\lib\full-run-checkout-preflight.ps1")
  $checkoutJson = Invoke-FullRunCheckoutPreflight -Node $node -Script (Join-Path $Control "scripts/full-run-checkouts.mjs") -Repo $Repo
  $checkouts = ($checkoutJson -join "`n") | ConvertFrom-Json
  if ($Control -ne $checkouts.integrationWorktree) { throw "Supervisor must run from the main integration checkout" }
  $Worktree = $checkouts.workerWorktree
  $Integration = $checkouts.integrationWorktree
  $ClusterRegistry = Join-Path $Worktree "autorun-queue\cluster-registry.json"
  $ClusterClaimScript = Join-Path $Worktree "scripts\cluster-claim.mjs"

  # Publication resume and initial worker execution must see the same data
  # roots. Set these after checkout resolution, before either path can queue.
  $env:ORICA_CLUSTER_REGISTRY = $ClusterRegistry
  $env:ORICA_EFFECT_DEBUG_HUB_ROOT = $Repo
  $env:ORICA_SUPERVISOR_HUB_REPO = $Repo

  # Recover confirmed dead validation owners before stashing or dispatching a
  # worker. The worker sandbox cannot remove the user-owned TEMP lease itself.
  & $node "$Control\scripts\harness\recover-gate-lease.mjs" --root $Worktree *>> $Log 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-SupervisorBootstrapLog "validation lease recovery blocked; preserving worktree and retrying next run"
    & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key validation-recovery --text "検証leaseの安全な回収を確認できず起動待機中。worktreeを保持しています。最新記録: $Log" *>> $Log 2>&1
    $code = 1
    exit $code
  }
  & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key validation-recovery --cleared --text "検証leaseの正規回収判定が通過しました。" *>> $Log 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cannot persist validation recovery resolution" }

  # Keep both existing owners alive while resuming a frozen publication. Never
  # synchronize the lane or dispatch another writer before this step completes.
  $heartbeatCommand = Join-Path $Control "scripts/run-with-lock-heartbeat.mjs"
  $resumeArgs = if ($workerUsageBlocked) { @("--defer-review") } else { @() }
  & $node $heartbeatCommand --lock-script $lockScript --lane $lockLane --token $lockToken -- `
    $node $heartbeatCommand --lock-script $lockScript --lane $cardLockLane --token $cardLockToken -- `
    $node "$Control\scripts\supervisor-integration.mjs" resume --repo $Repo --workdir $Worktree --supervisor-token $lockToken --card-token $cardLockToken @resumeArgs *>> $Log 2>&1
  $publicationCode = $LASTEXITCODE
  if ($publicationCode -eq 75) {
    Write-SupervisorBootstrapLog "publication deferred; candidate and evidence preserved; worker not started"
    $code = 0
    exit $code
  }
  if ($publicationCode -ne 0) {
    & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key publication-recovery --text "Publication reconciliation failed; lane preserved; inspect $Log" *>> $Log 2>&1
    throw "Publication reconciliation failed; preserve lane before dispatch"
  }
  & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key publication-recovery --cleared --text "Publication reconciliation completed." *>> $Log 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve publication recovery record" }
  if ($workerUsageBlocked) {
    Write-SupervisorBootstrapLog "usage-limit breaker skip after publication reconciliation"
    $code = 0
    exit $code
  }
  if (-not $codex) { throw "Codex CLI unavailable; publication reconciliation completed; new worker not started" }

  # 起動時に溜まった outbox を Telegram へ中継 (heartbeat 死活の補完)。
  & $node "$Repo\scripts\relay-outbox-to-telegram.mjs" --max 10 *>> $Log 2>&1

  # Telegram 受信を Codex 用 inbox に同期し、明示 /ruling 回答は needs-ruling.jsonl へ反映する。
  # Claude lane を使わない期間でも、裁定回答と通常指示を repo-visible な状態へ取り込む。
  & $node "$Repo\scripts\telegram-inbox.mjs" poll --max 20 *>> $Log 2>&1
  & $node "$Repo\scripts\telegram-inbox.mjs" apply-rulings *>> $Log 2>&1
  & $node "$Repo\scripts\telegram-inbox.mjs" quarantine-risky *>> $Log 2>&1
  $inboxBlock = & $node "$Repo\scripts\telegram-inbox.mjs" summary 2>> $Log
  if ($LASTEXITCODE -ne 0 -or -not $inboxBlock) {
    $inboxBlock = "(Telegram inbox summary 取得失敗。必要なら `node scripts/telegram-inbox.mjs summary` を再実行すること)"
  } else {
    $inboxBlock = ($inboxBlock -join "`n")
  }

  # All startup failures use the same persisted intervention report.
  function Write-SupervisorStartupFailure {
    param([int]$ExitCode, [string]$Detail, [string]$FailedWorktree)
    $syncFailureMessage = "startup worktree sync stopped; intervention required; worker not started. worktree: $FailedWorktree; exit: $ExitCode
$Detail"
    "[$(Get-Date -Format o)] $syncFailureMessage" | Add-Content $Log
      & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key startup-sync --text $syncFailureMessage *>> $Log 2>&1
  }

  # Fetch before dispatch; network failure must not silently use stale main.
  $remoteMain = & $node "$Control\scripts\remote-main-integration.mjs" fetch $Worktree 2>> $Log
  if ($LASTEXITCODE -ne 0) {
    $code = $LASTEXITCODE
    Write-SupervisorStartupFailure -ExitCode $code -Detail "remote main fetch failed; preserve lane. Details: $Log" -FailedWorktree $Worktree
    exit $code
  }
  "[$(Get-Date -Format o)] remote main observed: $remoteMain; publication rebase is isolated in auto-merge" | Add-Content $Log
  $laneDirty = git -C $Worktree status --porcelain
  if ($LASTEXITCODE -ne 0) {
    $code = $LASTEXITCODE
    Write-SupervisorStartupFailure -ExitCode $code -Detail "lane status check failed; preserve lane. Details: $Log" -FailedWorktree $Worktree
    exit $code
  }
  $workRecovery = $null
  if ($laneDirty) {
    $recoveryJson = & $node "$Control\scripts\supervisor-work-recovery.mjs" $Repo $Worktree 2>> $Log
    if ($LASTEXITCODE -ne 0 -or -not $recoveryJson) {
      Write-SupervisorStartupFailure -ExitCode 1 -Detail "lane is dirty; recovery is not attributable or still owned; preserve current work" -FailedWorktree $Worktree
      exit 1
    }
    $workRecovery = ($recoveryJson -join "`n") | ConvertFrom-Json
    if ($workRecovery.action -ne "recover") { throw "Invalid dirty recovery plan" }
    Write-SupervisorBootstrapLog "resuming preserved worker tree: $($workRecovery.checkpoint)"
  }

  # Preserve the lane on every startup sync failure. A pending merge cannot
  # enter the worker's clean-checkout contract and requires explicit intervention.
  # The interactive primary may be on any branch. Only refs/heads/main is synced.
  Write-SupervisorBootstrapLog "worker=$Worktree ref=$($checkouts.workerRef) integration=$Integration ref=refs/heads/main"

  $crashStashParts = @()
  foreach ($wt in @($Worktree)) {
    if ((Test-Path $wt) -and -not $workRecovery) {
      $syncOut = & $node "$Control\scripts\sync-worktree-to-main.mjs" --worktree $wt --branch $checkouts.workerRef --main refs/heads/main --preserve-work 2>> $Log
      $syncCode = $LASTEXITCODE
      if ($syncOut) {
        $syncOut | Add-Content $Log
        $syncOutText = ($syncOut -join "`n")
        if ($syncOutText -match "CRASH_RESCUE_STASH:") { $crashStashParts += $syncOutText.Trim() }
      } else {
        $syncOutText = ""
      }
      if ($syncCode -ne 0) {
        $syncDetail = if ($syncOutText.Trim()) { $syncOutText.Trim() } else { "(sync stdout なし。詳細は $Log の [sync-worktree] 行を確認)" }
        $code = $syncCode
        Write-SupervisorStartupFailure -ExitCode $code -Detail $syncDetail -FailedWorktree $wt
        exit $code
      }
    }
  }
  $crashStashBlock = if ($crashStashParts.Count -gt 0) { $crashStashParts -join "`n---`n" } else { "(前run由来の未解決クラッシュ救出stashなし)" }
  & $node "$Control\scripts\supervisor-followup.mjs" observe --repo $Repo --key startup-sync --cleared --text "Startup synchronization completed." *>> $Log 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve startup obstruction record" }
  # Read the durable user queue before any ISMCTS wait/skip decision.
  $supervisorFollowupScript = Join-Path $Control "scripts\supervisor-followup.mjs"
  # Use the same validation environment as the worker; missing or stale proof
  # keeps the request pending and falls back to the ordinary worker selection.
  . (Join-Path $Control "scripts\lib\supervisor-work-plan.ps1")
  $supervisorFollowupPlan = Get-SupervisorFollowupPlan -Node $node -Script $supervisorFollowupScript -Repo $Repo -Worktree $Worktree -Log $Log
  $supervisorFollowupBlock = $supervisorFollowupPlan.block

  # Infrastructure repair remains a prerequisite; explicit user work then wins.
  $preWorker = Invoke-SupervisorPreWorker -Node $node -Worktree $Worktree -Log $Log
  $selectedWork = Select-SupervisorFollowupWork -AuditPlan $preWorker.plan -FollowupPlan $supervisorFollowupPlan
  $implementationStatusBlock = $selectedWork.workerFocus
  $selectedFollowupIds = @($selectedWork.selectedIds)
  $auditForFollowupIds = @($selectedWork.auditForFollowupIds | Where-Object { $_ })
  "[$(Get-Date -Format o)] work-plan action=$($preWorker.plan.action) coverageTodo=$($preWorker.plan.coverageTodo) coverageViolations=$($preWorker.plan.coverageViolations) fidelityViolations=$($preWorker.plan.fidelityViolations) auditReviews=$($preWorker.plan.auditReviews)" | Add-Content $Log
  if ($selectedWork.action -eq "audits-clean" -and -not $workRecovery) {
    $ismctsPlan = Get-SupervisorIsmctsWork -Node $node -Worktree $Worktree -Repo $Repo -Integration $Integration
    $implementationStatusBlock = $ismctsPlan.workerFocus
    "[$(Get-Date -Format o)] ismcts plan action=$($ismctsPlan.action) nextTask=$($ismctsPlan.nextTask) evidence=$($ismctsPlan.evidenceState): $($ismctsPlan.workerFocus)" | Add-Content $Log
    if ($ismctsPlan.skipWorker) {
      $code = 0
      exit 0
    }
  }

  if ($workRecovery) {
    # Preserve the original acceptance unit before selecting another small task.
    $implementationStatusBlock = $workRecovery.workerFocus + "`n次の通常選択（復旧後）: " + $implementationStatusBlock
    $selectedFollowupIds = @($workRecovery.followupIds)
    $auditForFollowupIds = @()
  }

  "[$(Get-Date -Format o)] selected work=$($selectedWork.action) followups=$($selectedFollowupIds -join ',') auditFor=$($auditForFollowupIds -join ',') queued=$($supervisorFollowupPlan.taskCount)" | Add-Content $Log
  $implementationStatusBlock = "worker dispatch: RUN。以下の選択済み作業を実施する。`n" + $implementationStatusBlock
  $implementationStatusBlock += "`n受入単位: manual/ai-reference/00_meta/full-run-efficiency.mdに従い、冒頭で親目標・全受入条件・最大阻害・今回通す対戦/実行経路を特定する。最優先経路から無関係な小仕事へ移る場合は実験/反証/外部待ちの根拠を残す。基盤の追加はその阻害に必要な最小修正へ限定し、同じ受入単位の修正をまとめてtree固定→gate→独立査読→統合する。完了はcommit数ではなく対戦経路の改善・親受入完了・監査純減で報告し、未完なら試行成果/阻害/残条件/次の実験を既存taskまたはfollow-upへ残す。裁定待ちはneeds-ruling.jsonlの現行状態と最新受付を確認し、過去の固定説明より最新のユーザー訂正を優先する。"
  # 他laneのoff-limitsを取得する。照会失敗を「ロックなし」と扱わない。
  # off-limits は他 lane が *active hold* している cluster だけを列挙（list-locked subcommand）。
  # 静的 lane:claude 全列挙だと catch-all "claude-explore" が常に off-limits に入り Codex の
  # 探索能力が止まるため、active hold ベースに統一（Claude 側 wrapper と同方式）。
  $offLimits = "（現時点で active hold 中の off-limits cluster なし。legacy owner:claude も Codex takeover 対象）"
  $offLimitsJson = & $node $ClusterClaimScript list-locked --exclude-lane supervisor-audit 2>> $Log
  if ($LASTEXITCODE -ne 0 -or -not $offLimitsJson) { throw "off-limits lookup failed; keep task enabled for retry" }
  try {
      $offLimitsArr = ($offLimitsJson -join "`n") | ConvertFrom-Json -NoEnumerate
      if ($offLimitsArr -isnot [array]) { throw "invalid off-limits array" }
      if ($offLimitsArr -and $offLimitsArr.Count -gt 0) {
        $offLimits = ($offLimitsArr | ForEach-Object {
          if ($_.clusterId -isnot [string] -or -not $_.clusterId -or $_.scope -isnot [string] -or -not $_.scope -or $_.ownerLane -isnot [string]) { throw "invalid off-limits entry" }
          "- [$($_.ownerLane)] $($_.clusterId): $($_.scope)"
        }) -join "`n"
      }
  } catch {
    throw "off-limits parse failed; keep task enabled for retry: $($_.Exception.Message)"
  }

  # 一般clusterのclaimは行わない。fresh監査の対象カードを直接作業指示にする。

  # プレースホルダ置換してから UTF-8 一時ファイルへ書き出す（String.Replace でメタ文字安全）。
  $finalPrompt = $prompt.Replace('__OFF_LIMITS__', $offLimits).Replace('__CRASH_STASH_BLOCK__', $crashStashBlock).Replace('__SUPERVISOR_FOLLOWUPS__', $supervisorFollowupBlock).Replace('__CODEX_INBOX_BLOCK__', $inboxBlock).Replace('__WORKER_FOCUS__', $implementationStatusBlock)
  $promptFile = Join-Path $env:TEMP "orica-supervisor-prompt.txt"
  [System.IO.File]::WriteAllText($promptFile, $finalPrompt, (New-Object System.Text.UTF8Encoding($false)))

  # Codex JSONL ラッパー経由で毎回新規文脈を起動。結果は state/outbox に保存し、
  # Telegram relay/inbox が主モバイル経路として中継する（Codex App heartbeat は旧補助経路）。
  # runner が5分ごとに supervisor/cluster の owner token 付き refresh を行い、失敗時は worker process tree を止める。
  $workerArgs = @(
    "--label", "supervisor",
    "--repo", $Repo,
    "--workdir", $Worktree,
    "--worker-ref", $checkouts.workerRef,
    "--codex", $codex,
    "--prompt-file", $promptFile,
    "--lock-script", $lockScript,
    "--lock-token", $lockToken,
    "--lock-lane", $lockLane,
    "--lock-heartbeat-seconds", "300",
    "--extra-lock-lane", $cardLockLane,
    "--extra-lock-token", $cardLockToken
  )
  foreach ($id in $selectedFollowupIds) { $workerArgs += @("--followup-id", $id) }
  foreach ($id in $auditForFollowupIds) { $workerArgs += @("--audit-for-followup-id", $id) }
  & $node "$Control\scripts\worker-codex-stream.mjs" @workerArgs *>> $Log 2>&1
  $code = $LASTEXITCODE
  Register-UsageLimitHitIfDetected -LogDir $LogDir -Lane "codex-supervisor" -Log $Log -Code $code
}
finally {
  if ($cardLockAcquired) {
    & $node $lockScript release --token $cardLockToken --lane $cardLockLane *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) {
      "[$(Get-Date -Format o)] WARN: card lane lock release rejected" | Add-Content $Log
    }
  }
  # supervisor lock + run end は acquire 成立時のみ。skipped/abort 経路は内側で記録済。
  if ($lockAcquired) {
    & $node $lockScript release --token $lockToken --lane $lockLane *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) {
      "[$(Get-Date -Format o)] WARN: supervisor lock release rejected (owner changed or I/O error)" | Add-Content $Log
    }
    "[$(Get-Date -Format o)] supervisor run end (exit $code)" | Add-Content $Log
  }
}
exit $code
