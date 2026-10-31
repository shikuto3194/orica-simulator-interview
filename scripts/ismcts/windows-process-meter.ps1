# Private read-only helper. Its target comes from the caller's guardian spawn.
param([ValidateSet(1,2)][int]$Threads = 1)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$meter = $null
$bootstrapLease = $null
try {
    . (Join-Path $PSScriptRoot 'windows-affinity.ps1')
    Set-OricaHelperLimits -Threads $Threads
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-bootstrap-lease.cs')
    $bootstrapLease = [OricaBootstrapLease]::new()
    $attach = [Console]::ReadLine() | ConvertFrom-Json
    if ($attach.op -ne 'attach' -or $attach.threads -ne $Threads -or $attach.pid -isnot [long] -and $attach.pid -isnot [int] -or $attach.pid -lt 1 -or $attach.pid -gt [uint32]::MaxValue) { throw 'Invalid meter attachment' }
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-control-lease.cs'),(Join-Path $PSScriptRoot 'windows-process-meter.cs')
    $meter = [OricaProcessMeter]::new([uint32]$attach.pid)
    # A live retained guardian handle is now responsible for meter lifetime.
    # Validate the non-renewable bootstrap deadline before this handoff.
    $bootstrapLease.Complete()
    [Console]::WriteLine((@{op='attached';target=$meter.Measure($false);helper=[OricaProcessMeter]::Self()} | ConvertTo-Json -Depth 4 -Compress))
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $line | ConvertFrom-Json
        if ($request.op -notin 'sample','finish') { throw 'Invalid meter request' }
        $terminal = $request.op -eq 'finish'
        [Console]::WriteLine((@{op=($terminal ? 'finished' : 'sample');target=$meter.Measure($terminal);helper=[OricaProcessMeter]::Self()} | ConvertTo-Json -Depth 4 -Compress))
        if ($terminal) { break }
    }
} catch {
    [Console]::WriteLine('{"op":"error","reason":"process_accounting_failed"}')
    exit 1
} finally {
    if ($null -ne $meter) { $meter.Dispose() }
    if ($null -ne $bootstrapLease) { $bootstrapLease.Dispose() }
}
