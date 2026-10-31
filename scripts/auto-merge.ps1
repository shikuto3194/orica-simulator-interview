# Source lane stays immutable; only new unpublished candidates are rebased.
param(
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$Worktree,
  [int]$FuzzGames = 200,
  [string]$ExpectedHead,
  [string]$ResultFile,
  [ValidatePattern('^[a-f0-9]{32}$')][string]$AttemptId,
  [ValidatePattern('^[a-f0-9]{32}$')][string]$ResumeAttempt,
  [switch]$DeferReview,
  [switch]$SkipFuzz,
  [switch]$NoPush
)
$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-ChildItem Env:GIT_* | ForEach-Object { Remove-Item -LiteralPath $_.PSPath }
$common = git -C $Worktree rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -ne 0) { throw "Cannot locate shared Git repository" }
$Primary = Split-Path -Parent $common
$SourceWorktree = $Worktree
$SourceBranch = $Branch
$SourceHead = git -C $Worktree rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Cannot read source HEAD" }
$ValidatedHead = $SourceHead
$AutoMergeAttempt = if ($AttemptId) { $AttemptId } else { [guid]::NewGuid().ToString("N") }
$AutoMergePhase = "preconditions"
$AutoMergeTerminalRecorded = $false
$AttemptRecorder = Join-Path $PSScriptRoot "auto-merge-status.mjs"
$CheckoutResolver = Join-Path $PSScriptRoot "full-run-checkouts.mjs"
$RemoteScript = Join-Path $PSScriptRoot "remote-main-integration.mjs"
$LockScript = Join-Path $PSScriptRoot "supervisor-lock.mjs"
$LockHeartbeatRunner = Join-Path $PSScriptRoot "run-with-lock-heartbeat.mjs"
$MergeLockToken = [guid]::NewGuid().ToString("N")
$LockHeld = $false
$PublicationGuard = $null
$ReceiptWritten = $false
$LastGateExit = 0
$CandidateCheckpoint = $null
$ObservedRemote = $null
function Write-AutoMergeStatus([string]$status, [string]$phase, [int]$code = 0, [string]$message = "") {
  $script:AutoMergePhase = $phase
  $recordArgs = @($AttemptRecorder, "record", "--repo", $Primary, "--workdir", $SourceWorktree,
    "--id", $AutoMergeAttempt, "--pid", "$PID", "--branch", $SourceBranch,
    "--status", $status, "--phase", $phase, "--exit-code", "$code", "--head", $ValidatedHead, "--source-head", $SourceHead)
  if ($message) { $recordArgs += @("--error", $message) }
  if ($script:ObservedRemote) { $recordArgs += @("--observed-remote", $script:ObservedRemote) }
  if ($script:CandidateCheckpoint) { $recordArgs += @("--candidate", ($script:CandidateCheckpoint | ConvertTo-Json -Compress)) }
  if ($status -eq "completed") {
    if (-not $script:PublicationGuard) { throw "Missing final publication guard" }
    $recordArgs += @("--publication-guard", $script:PublicationGuard)
  }
  if ($script:LockHeld) {
    & node $LockHeartbeatRunner --lock-script $LockScript --lane merge --token $MergeLockToken -- node @recordArgs
  } else { & node @recordArgs }
  if ($LASTEXITCODE -ne 0) { throw "Could not persist auto-merge status ($phase)" }
  if ($status -in @("completed", "failed", "local_only")) { $script:AutoMergeTerminalRecorded = $true }
}
function Assert-LaneUnchanged {
  $head = git -C $SourceWorktree rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $head -ne $SourceHead) { throw "lane HEAD changed during integration" }
  $branchNow = git -C $SourceWorktree symbolic-ref --short HEAD
  if ($LASTEXITCODE -ne 0 -or $branchNow -ne $SourceBranch) { throw "lane branch changed during integration" }
  $dirty = git -C $SourceWorktree status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw "lane became dirty during integration" }
}
function Assert-IntegrationTarget {
  $targetJson = & node $CheckoutResolver --repo $Primary --integration
  if ($LASTEXITCODE -ne 0) { throw "main integration checkout is unavailable; preserve all other checkouts" }
  $target = ($targetJson -join "`n") | ConvertFrom-Json
  if (-not $target.configured) { throw "pinned full-run checkout configuration is missing" }
  if ($script:Integration -and $script:Integration -ne $target.integrationWorktree) { throw "main integration checkout changed" }
  $script:Integration = $target.integrationWorktree
}
function Test-Ancestor([string]$older, [string]$newer) {
  git -C $SourceWorktree merge-base --is-ancestor $older $newer
  if ($LASTEXITCODE -eq 0) { return $true }
  if ($LASTEXITCODE -eq 1) { return $false }
  throw "Git ancestry query failed"
}
function Get-RemoteMain {
  $value = & node $RemoteScript fetch $SourceWorktree
  if ($LASTEXITCODE -ne 0 -or ($value -join "") -notmatch '^[0-9a-f]{40,64}$') { throw "remote main fetch failed; preserve all checkouts" }
  return ($value -join "").Trim()
}
function Assert-VerifierEvidence {
  param([Parameter(Mandatory)][string]$EvidenceWorktree)
  $evidenceOutput = @(& node $RemoteScript evidence $EvidenceWorktree 2>&1)
  if ($LASTEXITCODE -ne 0) { throw ("adversarial verifier evidence invalid or branch tree changed after verification: " + ($evidenceOutput -join "`n")) }
}
function Assert-IntegrationEvidence {
  Assert-VerifierEvidence $SourceWorktree
  if ($Worktree -ne $SourceWorktree) { Assert-VerifierEvidence $Worktree }
}
function Invoke-Gate {
  param([Parameter(Mandatory)][scriptblock]$Cmd)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Cmd 2>&1 | ForEach-Object { Write-Host $_ }
    $script:LastGateExit = $LASTEXITCODE
    return ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host $_
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}
function Invoke-IntegrationGate([string]$name, [scriptblock]$command) {
  $script:LastGateExit = 0
  Write-AutoMergeStatus "running" $name
  Write-Host "[auto-merge] gate: $name ..."
  if (-not (Invoke-Gate -Cmd $command)) { throw "gate failed: $name" }
}
function Remove-OwnReceipt {
  if ($script:ReceiptWritten -and $ResultFile -and (Test-Path -LiteralPath $ResultFile)) {
    $saved = Get-Content -Raw -LiteralPath $ResultFile | ConvertFrom-Json
    if ($saved.attemptId -ne $AutoMergeAttempt) { throw "publication receipt changed; preserve it for inspection" }
    Remove-Item -LiteralPath $ResultFile
    $script:ReceiptWritten = $false
  }
}
function Release-MergeLock {
  if ($script:LockHeld) {
    & node $LockScript release --lane merge --token $MergeLockToken | Out-Null
    $script:LockHeld = $false
    if ($LASTEXITCODE -ne 0) {
      $script:LastGateExit = 0
      $cleanupFailure = "merge lock cleanup failed; preserve published commits and inspect the lock guard"
      try { Write-AutoMergeStatus "failed" "merge_lock_cleanup" 1 $cleanupFailure }
      finally { Remove-OwnReceipt }
      throw $cleanupFailure
    }
  }
}
try {
  $resumeRecord = $null
  if ($ResumeAttempt) {
    $resumeFile = Join-Path $Primary "logs/auto-merge-runs/$ResumeAttempt.json"
    if (-not (Test-Path -LiteralPath $resumeFile)) { throw "resume attempt is missing; preserve candidate" }
    $resumeRecord = Get-Content -LiteralPath $resumeFile -Raw | ConvertFrom-Json
    if ($resumeRecord.sourceHead -ne $SourceHead -or $resumeRecord.workdir -ne $SourceWorktree -or $resumeRecord.branch -ne $SourceBranch) {
      throw "resume candidate identity changed; preserve previous attempt"
    }
    $CandidateCheckpoint = $resumeRecord.candidate
    $ObservedRemote = if ($resumeRecord.observedRemote) { $resumeRecord.observedRemote } else { $resumeRecord.candidate.remote }
  }
  Write-AutoMergeStatus "running" "preconditions"
  if ($SkipFuzz) { throw "SkipFuzz is no longer supported; required validation cannot be bypassed" }
  if ($ExpectedHead -and $ExpectedHead -ne $SourceHead) { throw "lane HEAD changed after integration request" }
  Assert-LaneUnchanged
  Assert-IntegrationTarget
  if ($Integration -eq $Worktree) { throw "lane and integration checkout must differ" }
  if ($NoPush -and -not (Test-Ancestor refs/heads/main $SourceHead)) { throw "main is not an ancestor of the requested lane; synchronize the lane first" }
  & node $RemoteScript writers $SourceWorktree
  if ($LASTEXITCODE -ne 0) { throw "source verifier writers require synchronization and fresh independent review" }
  Assert-VerifierEvidence $SourceWorktree
  $CandidateSource = $SourceHead
  $done = $false
  $previousRemote = $ObservedRemote
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Assert-LaneUnchanged
    Assert-IntegrationTarget
    $mainBefore = git -C $Integration rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "Cannot read main HEAD" }
    $Worktree = $SourceWorktree
    $Branch = $SourceBranch
    $ValidatedHead = $SourceHead
    $candidate = $false
    $retained = $null
    if (-not $NoPush) {
      Write-AutoMergeStatus "running" "fetching_remote"
      $remote = Get-RemoteMain
      if ($previousRemote -and -not (Test-Ancestor $previousRemote $remote)) { throw "remote main history moved backwards or diverged; stop without publication" }
      $previousRemote = $remote
      $ObservedRemote = $remote
      if ($resumeRecord.candidate) {
        $retained = $resumeRecord.candidate
        # Validate before trusting its head as a source that preserves local main.
        $saved = & node $RemoteScript resume-candidate $SourceWorktree ($retained | ConvertTo-Json -Compress) $SourceHead $retained.main $retained.remote
        if ($LASTEXITCODE -ne 0) { throw "retained candidate changed; preserve it for inspection" }
        $retained = ($saved -join "`n") | ConvertFrom-Json
        $CandidateCheckpoint = $retained
        if (-not (Test-Ancestor $retained.remote $remote)) { throw "remote main moved backwards or diverged since saved publication; stop without publication" }
        if (-not $retained.mergeHead) { $CandidateSource = $retained.head }
      }
      $resumeRecord = $null
      if (-not (Test-Ancestor $mainBefore $CandidateSource) -and -not (Test-Ancestor $mainBefore $remote)) { throw "local main is not preserved by source or fetched remote; stop without publication" }
      if ($retained -or -not (Test-Ancestor $remote $CandidateSource)) {
        Write-AutoMergeStatus "running" "rebasing_candidate"
        if ($retained -and $retained.remote -eq $remote -and $mainBefore -in @($retained.main, $retained.head)) {
          $Worktree = $retained.worktree
          $Branch = $retained.branch
          $candidate = $true
          Write-Host "[auto-merge] resuming retained candidate $($retained.head)"
        } else {
          if ($DeferReview) {
            Write-AutoMergeStatus "running" "waiting_review"
            $script:LastGateExit = 75
            throw "new independent review deferred by usage limit; preserve source and previous candidates"
          }
          $candidatePath = Join-Path (Split-Path -Parent $Integration) "remote-main-$AutoMergeAttempt-$attempt"
          $prepared = & node $RemoteScript prepare $SourceWorktree $CandidateSource $mainBefore $remote $candidatePath
          if ($LASTEXITCODE -ne 0) { throw "remote rebase candidate failed; conflict candidate is preserved" }
          $prepared = ($prepared -join "`n") | ConvertFrom-Json
          $Worktree = $prepared.directory
          $Branch = $prepared.branch
          $candidate = $true
          $snapshot = & node $RemoteScript checkpoint $Worktree $SourceHead $mainBefore $remote
          if ($LASTEXITCODE -ne 0) { throw "Cannot preserve prepared candidate checkpoint" }
          $CandidateCheckpoint = ($snapshot -join "`n") | ConvertFrom-Json
        }
        # An interrupted install has no completion receipt. The offline frozen
        # install is idempotent and also restores missing checkout-local shims.
        if ($DeferReview) {
          & node $RemoteScript evidence $Worktree *> $null
          if ($LASTEXITCODE -ne 0) {
            Write-AutoMergeStatus "running" "waiting_review"
            $script:LastGateExit = 75
            throw "new independent review deferred by usage limit; candidate preserved before gates"
          }
        }
        Push-Location $Worktree
        try { Invoke-IntegrationGate "candidate_dependencies" { pnpm install --offline --frozen-lockfile --ignore-scripts } }
        finally { Pop-Location }
        & node $RemoteScript hooks $Worktree $SourceWorktree
        if ($LASTEXITCODE -ne 0) { throw "normal candidate commit/push hooks are unavailable" }
        $dependencyDirty = git -C $Worktree status --porcelain
        if ($LASTEXITCODE -ne 0 -or $dependencyDirty) { throw "dependency preparation changed candidate tree: $dependencyDirty" }
        $snapshot = & node $RemoteScript checkpoint $Worktree $SourceHead $mainBefore $remote
        if ($LASTEXITCODE -ne 0) { throw "Cannot preserve candidate checkpoint" }
        $CandidateCheckpoint = ($snapshot -join "`n") | ConvertFrom-Json
      }
    }
    $gateTree = git -C $Worktree rev-parse "HEAD^{tree}"
    if ($LASTEXITCODE -ne 0) { throw "Cannot snapshot candidate tree" }
    Push-Location $Worktree
    try {
      $planText = & node scripts/harness/run-gates.mjs --profile merge --plan
      if ($LASTEXITCODE -ne 0) { throw "could not determine merge validation scope" }
      $plan = ($planText -join "`n") | ConvertFrom-Json
      Invoke-IntegrationGate "verify:merge" { pnpm verify:merge }
      if ($plan.fuzzRequired -ne $false) {
        $previousFuzzGames = $env:FUZZ_GAMES
        $previousFuzzHead = $env:FUZZ_CANDIDATE_HEAD
        $previousFuzzTree = $env:FUZZ_CANDIDATE_TREE
        try {
          $env:FUZZ_GAMES = "$FuzzGames"
          $env:FUZZ_CANDIDATE_HEAD = git rev-parse HEAD
          if ($LASTEXITCODE -ne 0) { throw "Cannot bind fuzz to candidate HEAD" }
          $env:FUZZ_CANDIDATE_TREE = git rev-parse "HEAD^{tree}"
          if ($LASTEXITCODE -ne 0) { throw "Cannot bind fuzz to candidate tree" }
          Invoke-IntegrationGate "fuzz ($FuzzGames games)" { pnpm fuzz }
        } finally {
          $env:FUZZ_GAMES = $previousFuzzGames
          $env:FUZZ_CANDIDATE_HEAD = $previousFuzzHead
          $env:FUZZ_CANDIDATE_TREE = $previousFuzzTree
        }
      }
      $gateDirty = git status --porcelain
      if ($LASTEXITCODE -ne 0 -or $gateDirty -or (git rev-parse "HEAD^{tree}") -ne $gateTree) { throw "candidate tree changed during gates; fresh validation required" }
      if ($candidate) {
        # A retained exact-tree archive can survive a wait/restart; a changed
        # remote/base/tree still goes through the normal fresh review path.
        $retainedReview = $false
        if ($retained -and $Worktree -eq $retained.worktree) {
          & node $RemoteScript evidence $Worktree *> $null
          $retainedReview = $LASTEXITCODE -eq 0
        }
        if (-not $retainedReview) {
          if ($DeferReview) { $script:LastGateExit = 75; throw "new independent review deferred by usage limit" }
          Invoke-IntegrationGate "independent_review" { & node $RemoteScript review $Worktree }
        }
      }
      if ((git rev-parse "HEAD^{tree}") -ne $gateTree) { throw "candidate tree changed after final gates" }
      $ValidatedHead = git rev-parse HEAD
      if ($LASTEXITCODE -ne 0) { throw "Cannot read validated candidate" }
      if ($CandidateCheckpoint) {
        $snapshot = & node $RemoteScript checkpoint $Worktree $SourceHead $mainBefore $remote
        if ($LASTEXITCODE -ne 0) { throw "Cannot preserve reviewed candidate checkpoint" }
        $CandidateCheckpoint = ($snapshot -join "`n") | ConvertFrom-Json
      }
    } finally { Pop-Location }
    Assert-IntegrationEvidence
    Assert-LaneUnchanged
    $candidateDirty = git -C $Worktree status --porcelain
    if ($LASTEXITCODE -ne 0 -or $candidateDirty) { throw "validated candidate is dirty: $candidateDirty" }
    Write-AutoMergeStatus "running" "waiting_merge_lock"
    & node $LockScript acquire --lane merge --token $MergeLockToken --label "auto-merge $SourceBranch" --ttl 20 --wait 600
    if ($LASTEXITCODE -ne 0) { throw "could not acquire merge lane lock" }
    $LockHeld = $true
    try {
      & node $LockScript refresh --lane merge --token $MergeLockToken
      if ($LASTEXITCODE -ne 0) { throw "merge lane lock owner verification failed" }
      Assert-IntegrationTarget
      Assert-LaneUnchanged
      if ((git -C $Integration rev-parse HEAD) -ne $mainBefore) { throw "local main advanced during validation; retry after normal lane synchronization" }
      if (-not $NoPush) {
        $fresh = Get-RemoteMain
        if (-not (Test-Ancestor $remote $fresh)) { throw "remote main history changed during validation; stop without publication" }
        $previousRemote = $fresh
        $ObservedRemote = $fresh
        if (-not (Test-Ancestor $fresh $ValidatedHead)) {
          Write-Host "[auto-merge] remote advanced after validation; retry $attempt/3"
          continue
        }
      }
      Assert-IntegrationEvidence
      if (-not (Test-Ancestor refs/heads/main $ValidatedHead)) { throw "validated candidate does not preserve local main ancestry" }
      Write-AutoMergeStatus "running" "merging"
      & node $LockHeartbeatRunner --lock-script $LockScript --lane merge --token $MergeLockToken -- git -C $Integration merge --ff-only $ValidatedHead
      if ($LASTEXITCODE -ne 0) { throw "ff-only merge failed" }
      if (-not $NoPush) {
        Assert-LaneUnchanged
        Assert-IntegrationTarget
        if ((git -C $Integration rev-parse HEAD) -ne $ValidatedHead) { throw "local main changed before push" }
        Assert-IntegrationEvidence
        Write-AutoMergeStatus "running" "pushing"
        $publication = & node $RemoteScript prepare-push $Worktree $SourceWorktree $SourceBranch $SourceHead $Branch $ValidatedHead $Integration $AutoMergeAttempt $fresh
        if ($LASTEXITCODE -ne 0) { throw "Cannot bind normal pre-push publication guard" }
        $publication = ($publication -join "`n") | ConvertFrom-Json
        $PublicationGuard = $publication.guardFile
        $pushOutput = @()
        & node $LockHeartbeatRunner --lock-script $LockScript --lane merge --token $MergeLockToken -- git -C $Worktree -c ("core.hooksPath=" + $publication.directory) push --porcelain origin ($ValidatedHead + ":refs/heads/main") 2>&1 |
          Tee-Object -Variable pushOutput | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
          if (Test-Path -LiteralPath ($PublicationGuard + ".hook-result.json")) {
            $hookExit = & node $RemoteScript hook-exit $PublicationGuard
            if ($LASTEXITCODE -ne 0) { throw "Invalid normal pre-push hook result" }
            if ($hookExit -eq 75) {
              $script:LastGateExit = 75
              throw "normal pre-push validation lease wait; preserve publication for resume"
            }
          }
          $remoteRejected = @($pushOutput | Where-Object {
            "$_" -match '^!\t[^\t]*:refs/heads/main\t(?:\[rejected\] \((?:non-fast-forward|fetch first)\)|\[remote rejected\] \(incorrect old value provided\))$'
          }).Count -gt 0
          $advertised = $null
          $advertisementRejected = $false
          $advertisementFile = $PublicationGuard + ".advertisement.json"
          if (Test-Path -LiteralPath $advertisementFile) {
            $advertisement = Get-Content -Raw -LiteralPath $advertisementFile | ConvertFrom-Json
            if ($advertisement.attemptId -ne $AutoMergeAttempt -or $advertisement.remoteHead -ne $fresh -or $advertisement.advertisedHead -notmatch '^[a-f0-9]{40,64}$') {
              throw "Invalid remote main advertisement binding"
            }
            $advertised = $advertisement.advertisedHead
            $advertisementRejected = $advertisement.retryRequired -eq $true
          }
          if (-not $remoteRejected -and -not $advertisementRejected) { throw "push failed without explicit remote concurrency rejection; check hook, authentication or connection failure" }
          if (-not $advertised) { throw "remote main advertisement unavailable after push rejection; stop without publication" }
          $afterFailure = Get-RemoteMain
          if (-not (Test-Ancestor $fresh $advertised) -or -not (Test-Ancestor $advertised $afterFailure)) {
            throw "remote main history changed at push advertisement; stop without publication"
          }
          Write-Host "[auto-merge] push recovery: before=$fresh observed=$afterFailure candidate=$ValidatedHead"
          $ObservedRemote = $afterFailure
          if ($afterFailure -ne $fresh -and (Test-Ancestor $fresh $afterFailure) -and -not (Test-Ancestor $afterFailure $ValidatedHead)) {
            $previousRemote = $afterFailure
            $CandidateSource = $ValidatedHead
            Write-Host "[auto-merge] remote advanced during push; retry $attempt/3"
            continue
          }
          throw "push failed without forward remote movement; check pre-push hook gates"
        }
        Assert-LaneUnchanged
        Assert-IntegrationEvidence
        $publishedRemote = Get-RemoteMain
        if (-not (Test-Ancestor $ValidatedHead $publishedRemote)) { throw "remote does not contain the published candidate" }
        Assert-IntegrationTarget
        if ((git -C $Integration rev-parse HEAD) -ne $ValidatedHead) { throw "local main changed during push" }
        Assert-LaneUnchanged
        Assert-IntegrationEvidence
        Write-Host "[auto-merge] remote main verified: published=$ValidatedHead observed=$publishedRemote source=$SourceHead"
      }
      if ($NoPush) { Write-AutoMergeStatus "local_only" "local_merged" }
      else { Write-AutoMergeStatus "completed" "published" }
      if ($ResultFile) {
        $result = @{ schemaVersion = 2; publicationGuard = $PublicationGuard; sourceHead = $SourceHead; head = $ValidatedHead; tree = (git -C $Worktree rev-parse 'HEAD^{tree}'); attemptId = $AutoMergeAttempt; workdir = $SourceWorktree }
        [System.IO.File]::WriteAllText($ResultFile, ($result | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
        $ReceiptWritten = $true
      }
      $done = $true
    } finally { Release-MergeLock }
    if ($done) { break }
  }
  if (-not $done) { throw "remote main retry limit reached (3); preserved candidates, no further push" }
  Write-Host "[auto-merge] done: $ValidatedHead"
  exit 0
} catch {
  $failure = $_.Exception.Message
  $failureCode = if ($LastGateExit -eq 75) { 75 } elseif ($AutoMergePhase -eq "preconditions") { 2 } else { 1 }
  if (-not $AutoMergeTerminalRecorded) {
    try { Write-AutoMergeStatus "failed" $AutoMergePhase $failureCode $failure }
    catch { $failureCode = 1; Write-Host "[auto-merge] status recording failed: $_" }
  }
  Write-Host "[auto-merge] ABORT: $failure"
  exit $failureCode
} finally { Release-MergeLock }
