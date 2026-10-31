# Private JSON-lines guardian. No OS operation accepts a caller-supplied PID.
param([ValidateSet(1,2)][int]$Threads = 1)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'windows-affinity.ps1')
$ownedJob = $null
$controlLease = $null
$bootstrapLease = $null
$operation = 'create'
try {
    # The immutable spawn argument constrains even the small lease compiler.
    Set-OricaHelperLimits -Threads $Threads
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-bootstrap-lease.cs')
    $bootstrapLease = [OricaBootstrapLease]::new()
    $launch = [Console]::ReadLine() | ConvertFrom-Json
    if ($launch.op -ne 'create' -or $launch.threads -ne $Threads -or $launch.wallMs -lt 1 -or $launch.wallMs -gt 1200000 -or $launch.resourceWatchdog -isnot [bool] -or $null -eq $launch.writeTransferLimitBytes -or $launch.writeTransferLimitBytes -lt -1 -or $launch.writeTransferLimitBytes -gt 2147483648 -or $launch.writeTransferLimitBytes -ne [long]$launch.writeTransferLimitBytes) {
        throw 'Invalid launch contract'
    }
    # Constrain this newly-created guardian before compilation and child launch.
    # The job selects from this same mask, so guardian and job share CPU slots.
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-control-lease.cs'),(Join-Path $PSScriptRoot 'windows-job.cs')
    # Fix computational settings in this guardian only; never alter host env.
    $env:OMP_NUM_THREADS = [string]$launch.threads
    $env:MKL_NUM_THREADS = [string]$launch.threads
    $env:OPENBLAS_NUM_THREADS = [string]$launch.threads
    $env:UV_THREADPOOL_SIZE = [string]$launch.threads
    $ownedJob = [OricaOwnedJob]::new($launch.executable, $launch.commandLine, $launch.cwd, $launch.threads, $launch.wallMs, $launch.resourceWatchdog, [long]$launch.writeTransferLimitBytes)
    $controlLease = [OricaControlLease]::new()
    $bootstrapLease.Complete()
    [Console]::WriteLine((@{op='created';sample=$ownedJob.Measure()} | ConvertTo-Json -Depth 6 -Compress))
    while ($null -ne ($requestLine = [Console]::ReadLine())) {
        $request = $requestLine | ConvertFrom-Json
        $operation = $request.op
        if ($request.op -notin 'start','sample','heartbeat','terminate','finish') { throw 'Invalid owned job operation' }
        $controlLease.Touch()
        switch ($request.op) {
            'start' { $ownedJob.Start([string]$request.hostToken); [Console]::WriteLine('{"op":"started"}') }
            'sample' { [Console]::WriteLine((@{op='sample';sample=$ownedJob.Measure()} | ConvertTo-Json -Depth 6 -Compress)) }
            'heartbeat' { $ownedJob.Heartbeat([string]$request.hostToken); [Console]::WriteLine('{"op":"heartbeat"}') }
            'terminate' { $ownedJob.Terminate(); [Console]::WriteLine('{"op":"terminated"}') }
            'finish' { [Console]::WriteLine((@{op='finished';terminal=$ownedJob.Finish()} | ConvertTo-Json -Depth 7 -Compress)) }
            default { throw 'Invalid owned job operation' }
        }
    }
} catch {
    # Deliberately omit command/argv/env and Win32 exception text from evidence.
    $nativeError = 0
    if ($null -ne $_.Exception.InnerException -and $_.Exception.InnerException -is [System.ComponentModel.Win32Exception]) {
        $nativeError = $_.Exception.InnerException.NativeErrorCode
    }
    $errorType = $_.Exception.GetType().Name
    $innerType = if ($null -ne $_.Exception.InnerException) { $_.Exception.InnerException.GetType().Name } else { '' }
    $reasonCode = 'owned_job_operation_failed'
    if ($innerType -eq 'MembershipChangedException' -and $_.Exception.InnerException.ReasonCode -in @('membership_incomplete','membership_count_changed','membership_set_changed','membership_accounting_changed')) {
        $reasonCode = $_.Exception.InnerException.ReasonCode
    }
    [Console]::WriteLine((@{op='error';reason=$reasonCode;stage=$operation;nativeError=$nativeError;errorType=$errorType;innerType=$innerType} | ConvertTo-Json -Compress))
    exit 1
} finally {
    if ($null -ne $ownedJob) { $ownedJob.Dispose() }
    if ($null -ne $controlLease) { $controlLease.Dispose() }
    if ($null -ne $bootstrapLease) { $bootstrapLease.Dispose() }
}
