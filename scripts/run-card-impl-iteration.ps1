# run-card-impl-iteration.ps1 — orica-card-impl-loop タスクの 1 回分の実体。
#
# headless Codex を新規文脈で起動し
# card-impl lane (card-data のみ変換) の 1 イテレーションを無人実行する。
# A レーン (card-data 変換) を Codex supervisor と独立した worktree+lock で並走させる。
#
# engine Codex lane との独立性:
#   - worktree: C:\dev\orica-wt\autorun-cards (engine-drain とは別)
#   - lock lane: card-impl (supervisor とは別 lane lock)
#   - 編集 scope: packages/card-data/ のみ。rules-core は読むだけ、編集禁止
#   - 起動前 task0 gate: coverage todo > 0、または lane=card-impl の具体 cluster がある場合だけ
#     Codex を起動する。stub/F2-quartz の粗い候補確認は engine lane 側へ戻す。
#
# 単一インスタンス保証は二重: (1) タスクの MultipleInstances IgnoreNew、
# (2) wrapper が owner token 付き lock (lane=card-impl) を Codex 起動前に acquire。
#
# 停止/再開はユーザー専権:
#   停止: schtasks /Change /TN orica-card-impl-loop /DISABLE
#   再開: schtasks /Change /TN orica-card-impl-loop /ENABLE
# 正源: manual/ai-reference/30_plan/lane-prompts.md の Cards Lane。

$ErrorActionPreference = "Stop"
$Repo = "C:\dev\orica-simulator"
$Worktree = "C:\dev\orica-wt\autorun-cards"
$LogDir = Join-Path $Repo "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir "card-impl-run.log"

# usage limit サーキットブレーカー (2026-07-02、3レーン共通化):
# Codex CLI が "usage limit ... try again at <date>" を返すケースで、リセットまで
# 盲目的にリトライして空撃ちするのを防ぐ。判別・パース処理は scripts/lib/usage-limit-breaker.ps1
# に SSOT 化（run-supervisor-iteration.ps1 と共通）。
# タスク自体は有効のまま (ENABLE/DISABLE はユーザー専権)。手動解除は `pnpm usage-limit:clear`。
. (Join-Path $Repo "scripts\lib\usage-limit-breaker.ps1")
if (Test-UsageLimitBreaker -LogDir $LogDir -Lane "card-impl" -Log $Log) { exit 0 }

# node 解決
$node = $null
foreach ($n in @("C:\Program Files\nodejs\node.exe", "$env:ProgramFiles\nodejs\node.exe")) {
  if (Test-Path $n) { $node = $n; break }
}
if (-not $node) { $node = "node" }

$pwshHost = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
if (-not (Test-Path $pwshHost)) {
  $resolvedPwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($resolvedPwsh) { $pwshHost = $resolvedPwsh.Source }
}

function Get-CardCoverageTodoCount {
  $coverageRaw = & $node "$Repo\scripts\cards-coverage.mjs" --json 2>> $Log
  if ($LASTEXITCODE -ne 0 -or -not $coverageRaw) {
    "[$(Get-Date -Format o)] ABORT: cards coverage task0 check failed (exit $LASTEXITCODE)" | Add-Content $Log
    exit 1
  }
  try {
    $coverage = ($coverageRaw -join "`n") | ConvertFrom-Json
    if ($null -ne $coverage.todoCount) { return [int]$coverage.todoCount }
    if ($coverage.totals -and $null -ne $coverage.totals.todo) { return [int]$coverage.totals.todo }
  }
  catch {
    "[$(Get-Date -Format o)] ABORT: cards coverage task0 JSON parse failed: $($_.Exception.Message)" | Add-Content $Log
    exit 1
  }
  "[$(Get-Date -Format o)] ABORT: cards coverage task0 check missing todo count" | Add-Content $Log
  exit 1
}

function Get-OpenCardImplClusterCount {
  $registryPath = Join-Path $Repo "autorun-queue\cluster-registry.json"
  if (-not (Test-Path $registryPath)) { return 0 }
  try {
    $registry = Get-Content -Raw $registryPath | ConvertFrom-Json
    $clusters = @($registry.clusters | Where-Object {
      $_.lane -eq "card-impl" -and $_.status -eq "open"
    })
    return $clusters.Count
  }
  catch {
    "[$(Get-Date -Format o)] WARN: card-impl cluster task0 check failed: $($_.Exception.Message)" | Add-Content $Log
    return 0
  }
}

$coverageTodoCount = Get-CardCoverageTodoCount
$openCardImplClusterCount = Get-OpenCardImplClusterCount
if ($coverageTodoCount -le 0 -and $openCardImplClusterCount -le 0) {
  "[$(Get-Date -Format o)] card-impl run skipped: task0 no work (coverage todo=0, card-impl clusters=0)" | Add-Content $Log
  exit 0
}

# Codex CLI 解決（task0 で仕事ありと判定した後だけ行う）
$codex = $null
foreach ($c in @(
  "$env:APPDATA\npm\codex.cmd",
  "$env:LOCALAPPDATA\Microsoft\WindowsApps\codex.exe"
)) {
  if (Test-Path $c) { $codex = $c; break }
}
if (-not $codex) {
  $resolvedCodex = Get-Command codex.exe -ErrorAction SilentlyContinue
  if (-not $resolvedCodex) { $resolvedCodex = Get-Command codex.cmd -ErrorAction SilentlyContinue }
  if ($resolvedCodex) { $codex = $resolvedCodex.Source }
}
if (-not $codex) {
  "[$(Get-Date -Format o)] ABORT: Codex CLI 不在" | Add-Content $Log
  exit 1
}

$prompt = @'
あなたは orica-simulator の card-impl Codex lane です（新規文脈）。

必ず読む:
- CLAUDE.md
- manual/ai-reference/30_plan/lane-prompts.md の Cards Lane
- manual/ai-reference/30_plan/autorun-runbook.md
- manual/ai-reference/28_policy/04_card-addition-decision-table.md
- manual/ai-reference/20_design/11_structured-effect-model.md

作業場所:
- C:\dev\orica-wt\autorun-cards （あなたの cwd は既にここ）
- branch: feat/autorun-cards
- run 冒頭で local main に追従する: git merge --ff-only main（失敗時 git rebase main）。

担当 mode / cluster（wrapper が決定）:
__CLUSTER_BLOCK__

他 lane が active hold している off-limits cluster（一切触らない）:
__OFFLIMITS_BLOCK__

前run のクラッシュ救出stash（limitヒット等で駆動中に落ちた回の残骸。iteration冒頭で軽く確認、
主タスクを止めてまで深追いしない。使うか drop するか明示判断し、無視して終了しない）:
__CRASH_STASH_BLOCK__

このレーンの目的:
- coverage todo > 0 のカードを、弾順・カード番号順で effects 化する。
- wrapper が lane=card-impl の具体 cluster を注入した場合は、その cluster の card-data だけを処理する。
- engine Codex lane (rules-core 拡張) と並走するため、編集 scope を card-data に厳格制限する。

**編集 scope (厳守)**:
- 編集可: packages/card-data/src/cards/*.ts + 対応する packages/rules-core/test/<set>-*.test.ts の assertion 追加
- **編集禁止**: packages/rules-core/src/** (interpreter/registration/primitive 一切触らない)
- DSL/timing/interpreter 拡張が必要と判断したら needs-dsl.audit.jsonl に owner:codex で park してから次へ
- engine Codex lane の cluster と被らないよう、rules-core touch は absolute taboo

着手対象選定の優先順 (空回り禁止):
- iteration コスト ~$8 を「成果ゼロ」で消費するのは原則禁止。下記から1件は必ず拾う。
- 優先順:
  1) **assigned cluster** (wrapper が機械ロック取得済) の card-data scope
  2) **coverage todo** (`pnpm cards:coverage --json` の todo) のうち、弾順・カード番号順で card-data だけで変換できるもの
- stub/fidelity 残は engine lane が扱う。card-impl lane は READY stub / F2-quartz の粗い候補だけを理由に起動しない。
- 1 件も着手対象が無いと判定した場合のみ no-op 報告可。その場合は
  supervisor-report.mjs --kind progress に **どの優先順の何件を確認したか** を明記する。

park 規約 (verifier failure 対応):
- adversarial verifier round 1 で refute されたら、まず別 card / 別 effect index に切り替えて再試行。
  最初から park にしない。
- 「rules-core 拡張が必要」と判明したら、その card は park (needs-dsl.audit) し、他の coverage todo へ。
  card-impl lane では rules-core 自体を park 解消しに行かない（engine Codex lane の仕事）。

必須ゲート:
- npx tsc -b packages/card-data （rules-core は touch しないので tsc -b は card-data だけで足りる。
  ただし依存解決のため初回は packages/rules-core も build 済が前提）
- pnpm test （影響テストだけ最初に絞ってもよいが、最終は全件）
- pnpm cards:test-coverage --gate
- adversarial verifier（manual/ai-reference/30_plan/adversarial-verifier-prompt.md）
  ※このレーンも独立した read-only Codex verifier を起動する。手順:
    1) node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt --context-out .verifier-context.json
    2) .verifier-prompt.txt 全文を Codex sub-agent の prompt に渡し read-only で検証。最終回答は JSON のみ。
    3) 返り JSON を .verifier-report.json に保存 → node scripts/verifier-evidence.mjs record --context .verifier-context.json --report .verifier-report.json --out .verifier-result.json
    4) node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json
    5) refuted:true があれば直して手順5ゲート再実行→再検証（最大3巡）。全 vouch のときだけ次へ。
- pnpm snapshot --measure --landing "<着地>" は verifier 前に済ませる

完了:
- pnpm verified-commit -- -m "feat:/fix:/... + cardNo 明記"
- scripts/auto-merge.ps1 -Branch feat/autorun-cards -Worktree C:\dev\orica-wt\autorun-cards で main へ ff-only
- conflict 時は local main を同期 → 再 auto-merge
- supervisor-report.mjs --kind progress で hub outbox に要約を積む

停止条件 / 自律判断禁止:
- spend limit 到達なら即終了（再 cron で再試行）
- 停止/再開/方針転換はユーザー専権
'@

"[$(Get-Date -Format o)] card-impl run start (cli=$codex)" | Add-Content $Log

# worktree 健全性チェック
if (-not (Test-Path $Worktree)) {
  "[$(Get-Date -Format o)] ABORT: worktree 不在 $Worktree (scripts/new-worktree.ps1 -Task autorun-cards で作成)" | Add-Content $Log
  exit 1
}

# 初回 setup
if (-not (Test-Path (Join-Path $Worktree "node_modules"))) {
  "[$(Get-Date -Format o)] worktree setup: pnpm install + tsc -b (first run)" | Add-Content $Log
  $pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $pnpm) { $pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source }
  if (-not $pnpm) {
    "[$(Get-Date -Format o)] ABORT: pnpm 不在（worktree setup 不能）" | Add-Content $Log
    exit 1
  }
  Push-Location $Worktree
  try {
    & $pnpm install *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) { "[$(Get-Date -Format o)] ABORT: pnpm install 失敗" | Add-Content $Log; exit 1 }
    & npx tsc -b packages/rules-core packages/card-data packages/ai apps/cli *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) { "[$(Get-Date -Format o)] WARN: tsc -b 非ゼロ（Codex worker 側で再ビルド）" | Add-Content $Log }
  }
  finally { Pop-Location }
}

$lockScript = Join-Path $Repo "scripts\supervisor-lock.mjs"
$lockToken = [guid]::NewGuid().ToString("N")
$lockLabel = "run-card-impl-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$lockLane = "card-impl"

$code = 1
$lockAcquired = $false
$clusterToken = [guid]::NewGuid().ToString("N")
$clusterLockLane = $null

try {
  & $node $lockScript acquire --token $lockToken --label $lockLabel --lane $lockLane --ttl 240 *>> $Log 2>&1
  $lockAcquireCode = $LASTEXITCODE
  if ($lockAcquireCode -eq 1) {
    "[$(Get-Date -Format o)] card-impl run skipped: lock held (lane=$lockLane)" | Add-Content $Log
    exit 0
  }
  if ($lockAcquireCode -ne 0) {
    "[$(Get-Date -Format o)] ABORT: card-impl lock acquire failed (lane=$lockLane, exit $lockAcquireCode)" | Add-Content $Log
    exit 1
  }
  $lockAcquired = $true

  # 起動時に local main を origin へ publish + outbox 中継
  & $pwshHost -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\push-main.ps1") -Quiet *>> $Log 2>&1
  & $node "$Repo\scripts\relay-outbox-to-telegram.mjs" --max 10 *>> $Log 2>&1

  # worktree を local main へキャッチアップ。sync 失敗時は「同期済み」前提の通常作業ではなく
  # sync-recovery worker を起動する。
  $syncOut = & $node "$Repo\scripts\sync-worktree-to-main.mjs" --worktree $Worktree 2>> $Log
  $syncCode = $LASTEXITCODE

  # 前run のクラッシュ救出stash(sync-worktree-to-main.mjs が検知した分)。stdout を capture 化した
  # ため log へ書き戻す。無ければ既定文言（engine Codex lane と同パターン）。
  $crashStashBlock = "(前run由来の未解決クラッシュ救出stashなし)"
  if ($syncOut) {
    $syncOut | Add-Content $Log
    $syncOutText = ($syncOut -join "`n")
    if ($syncOutText -match "CRASH_RESCUE_STASH:") {
      $crashStashBlock = $syncOutText.Trim()
    }
  } else {
    $syncOutText = ""
  }
  if ($syncCode -ne 0) {
    $kind = if ($syncCode -eq 3) { "実コード競合" } else { "sync hard error" }
    "[$(Get-Date -Format o)] sync-worktree $kind (exit $syncCode); launching sync-recovery worker" | Add-Content $Log
    $syncDetail = if ($syncOutText.Trim()) { $syncOutText.Trim() } else { "(sync stdout なし。詳細は $Log の [sync-worktree] 行を確認)" }
    $syncFailureBlock = "worktree: $Worktree`nexit: $syncCode ($kind)`n$syncDetail"
    $syncFailureMessage = "startup worktree sync needs recovery; launching sync-recovery worker instead of normal card work.`n$syncFailureBlock"
    $syncFailureMessage | & $node "$Repo\scripts\supervisor-report.mjs" --repo $Repo --kind error --lane "card-impl" --stdin *>> $Log 2>&1
    $syncRecoveryPrompt = @'
あなたは orica-simulator の card-impl sync-recovery worker です。
通常のカード実装には進まず、下の startup sync 失敗を解消してください。

目的:
- 対象 worktree を local `main` に追従させ、clean な状態に戻す。
- 統合点は local `main`。`origin/main` は遅延することがあるので同期先にしない。
- primary main working tree (`C:\dev\orica-simulator`) は編集しない。

手順:
1. `git status --short --branch` と競合ファイルを確認する。
2. local `main` を対象に `git merge --no-edit main` または状況に応じて `git rebase main` を行い、実コード競合を解消する。
3. 解消後、worktree が clean で、`git merge-base --is-ancestor main HEAD` が通ることを確認する。
4. 未解決 stash がある場合は中身を確認し、この回で apply/drop の判断を記録する。
5. 既に統合待ちの変更があり、gate / verifier / commit / auto-merge まで安全に進められるなら通常手順で進める。新しい通常タスクには着手しない。
6. 解消不能なら `node C:\dev\orica-simulator\scripts\supervisor-report.mjs --kind error --stdin` で、残った競合ファイルと理由を報告する。

== startup sync failure ==
__SYNC_RECOVERY_BLOCK__

== 前run のクラッシュ救出stash ==
__CRASH_STASH_BLOCK__
'@
    $finalPrompt = $syncRecoveryPrompt.Replace('__SYNC_RECOVERY_BLOCK__', $syncFailureBlock).Replace('__CRASH_STASH_BLOCK__', $crashStashBlock)
    $promptFile = Join-Path $env:TEMP "orica-card-impl-sync-recovery-prompt.txt"
    [System.IO.File]::WriteAllText($promptFile, $finalPrompt, (New-Object System.Text.UTF8Encoding($false)))
    $workerArgs = @(
      "--label", "card-impl-sync-recovery",
      "--repo", $Repo,
      "--workdir", $Worktree,
      "--codex", $codex,
      "--prompt-file", $promptFile,
      "--state-file", (Join-Path $LogDir "codex-card-impl-state.json"),
      "--lock-script", $lockScript,
      "--lock-token", $lockToken,
      "--lock-lane", $lockLane,
      "--lock-heartbeat-seconds", "300"
    )
    & $node "$Repo\scripts\worker-codex-stream.mjs" @workerArgs *>> $Log 2>&1
    $code = $LASTEXITCODE
    Register-UsageLimitHitIfDetected -LogDir $LogDir -Lane "card-impl" -Log $Log -Code $code
    exit $code
  }

  # cluster registry の stale open 自動清掃
  & $node "$Repo\scripts\cluster-claim.mjs" audit --apply *>> $Log 2>&1

  # cluster claim を試みる (lane=card-impl)。該当 cluster が registry に無ければ coverage todo を処理する。
  $claimJson = & $node "$Repo\scripts\cluster-claim.mjs" claim --lane card-impl --token $clusterToken --ttl 60 2>> $Log
  $claimCode = $LASTEXITCODE
  $clusterBlock = $null
  $coverageBlock = "- mode: coverage (claim 可能な card-impl cluster 無し → coverage todo から拾う)`n- coverage todo count: $coverageTodoCount`n- 優先順は prompt 本文の『着手対象選定の優先順』参照`n- rules-core は絶対に編集しない。必要なら needs-dsl.audit に park。`n- 一度に1機構。終わったら exit。"
  try {
    if ($claimCode -eq 0) {
      if ([string]::IsNullOrWhiteSpace($claimJson)) {
        if ($coverageTodoCount -le 0) {
          "[$(Get-Date -Format o)] card-impl run skipped: task0 no claimed cluster after empty claim stdout (coverage todo=0)" | Add-Content $Log
          exit 0
        }
        "[$(Get-Date -Format o)] WARN: claim exit 0 だが stdout が空/null → coverage モードへフォールバック" | Add-Content $Log
        $clusterBlock = $coverageBlock
      }
      else {
        $claim = $claimJson | ConvertFrom-Json
        $clusterLockLane = $claim.lockLane
        "[$(Get-Date -Format o)] claimed cluster: $($claim.clusterId) (lock=$clusterLockLane)" | Add-Content $Log
        $clusterBlock = "- mode: cluster-assigned (機械ロック取得済)`n- cluster id: $($claim.clusterId)`n- scope: $($claim.scope)`n- 上記 scope の card-data だけを実装する。rules-core は絶対に触らない。"
      }
    }
    elseif ($claimCode -eq 3) {
      if ($coverageTodoCount -le 0) {
        "[$(Get-Date -Format o)] card-impl run skipped: task0 no claimed cluster (coverage todo=0)" | Add-Content $Log
        exit 0
      }
      "[$(Get-Date -Format o)] no cluster to claim → coverage mode (fallback)" | Add-Content $Log
      $clusterBlock = $coverageBlock
    }
    else {
      "[$(Get-Date -Format o)] ABORT: cluster-claim 失敗 (exit $claimCode)" | Add-Content $Log
      exit 1
    }
  }
  catch {
    if ($coverageTodoCount -le 0) {
      "[$(Get-Date -Format o)] ABORT: claim 分岐で例外かつ coverage todo=0: $($_.Exception.Message)" | Add-Content $Log
      exit 1
    }
    "[$(Get-Date -Format o)] WARN: claim 分岐で例外: $($_.Exception.Message) (claimCode=$claimCode, claimJsonLen=$($claimJson.Length)) → coverage モードで継続" | Add-Content $Log
    $clusterLockLane = $null
    $clusterBlock = $coverageBlock
  }

  # 他 lane が active hold している cluster を取得し off-limits に注入
  $offLimitsJson = & $node "$Repo\scripts\cluster-claim.mjs" list-locked --exclude-lane card-impl 2>> $Log
  $offLimitsBlock = "(現時点で off-limits cluster 無し。ただし engine Codex lane の active commit を確認してから rules-core 周辺の card-data touch も避けること)"
  if ($LASTEXITCODE -eq 0 -and $offLimitsJson) {
    try {
      $offLimitsArr = $offLimitsJson | ConvertFrom-Json
      if ($offLimitsArr -and $offLimitsArr.Count -gt 0) {
        $offLimitsBlock = ($offLimitsArr | ForEach-Object {
          "- [$($_.ownerLane)] $($_.clusterId): $($_.scope)"
        }) -join "`n"
      }
    } catch {
      "[$(Get-Date -Format o)] WARN: off-limits JSON parse 失敗" | Add-Content $Log
    }
  }

  # プロンプト注入 + UTF-8 一時ファイル
  $finalPrompt = $prompt.Replace('__CLUSTER_BLOCK__', $clusterBlock).Replace('__OFFLIMITS_BLOCK__', $offLimitsBlock).Replace('__CRASH_STASH_BLOCK__', $crashStashBlock)
  $promptFile = Join-Path $env:TEMP "orica-card-impl-prompt.txt"
  [System.IO.File]::WriteAllText($promptFile, $finalPrompt, (New-Object System.Text.UTF8Encoding($false)))

  # Codex JSONL ラッパー
  $workerArgs = @(
    "--label", "card-impl",
    "--repo", $Repo,
    "--workdir", $Worktree,
    "--codex", $codex,
    "--prompt-file", $promptFile,
    "--state-file", (Join-Path $LogDir "codex-card-impl-state.json"),
    "--lock-script", $lockScript,
    "--lock-token", $lockToken,
    "--lock-lane", $lockLane,
    "--lock-heartbeat-seconds", "300"
  )
  if ($clusterLockLane) {
    $workerArgs += @("--extra-lock-lane", $clusterLockLane, "--extra-lock-token", $clusterToken)
  }
  & $node "$Repo\scripts\worker-codex-stream.mjs" @workerArgs *>> $Log 2>&1
  $code = $LASTEXITCODE
  Register-UsageLimitHitIfDetected -LogDir $LogDir -Lane "card-impl" -Log $Log -Code $code
}
finally {
  if ($clusterLockLane) {
    & $node "$Repo\scripts\cluster-claim.mjs" release --lock-lane $clusterLockLane --token $clusterToken *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) {
      "[$(Get-Date -Format o)] WARN: cluster lock release rejected (lane=$clusterLockLane)" | Add-Content $Log
    }
  }
  if ($lockAcquired) {
    & $node $lockScript release --token $lockToken --lane $lockLane *>> $Log 2>&1
    if ($LASTEXITCODE -ne 0) {
      "[$(Get-Date -Format o)] WARN: card-impl lock release rejected (owner changed or I/O error)" | Add-Content $Log
    }
    "[$(Get-Date -Format o)] card-impl run end (exit $code)" | Add-Content $Log
  }
}
exit $code
