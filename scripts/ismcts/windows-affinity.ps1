# Constrain only the newly-created helper; never accept an external PID.
function Set-OricaHelperLimits([int]$Threads) {
    $current = [System.Diagnostics.Process]::GetCurrentProcess()
    try {
        $current.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
        $current.ProcessorAffinity = Get-OricaSharedAffinity -Allowed $current.ProcessorAffinity -Threads $Threads
    } finally { $current.Dispose() }
}
function Get-OricaSharedAffinity([IntPtr]$Allowed, [int]$Threads) {
    if ($Threads -notin 1,2) { throw 'Invalid processor slots' }
    $allowedMask = [BitConverter]::ToUInt64([BitConverter]::GetBytes($Allowed.ToInt64()), 0)
    $sharedMask = [uint64]0
    $selected = 0
    for ($bit = 0; $bit -lt 64 -and $selected -lt $Threads; $bit++) {
        $candidate = [uint64]1 -shl $bit
        if (($allowedMask -band $candidate) -ne 0) {
            $sharedMask = $sharedMask -bor $candidate
            $selected++
        }
    }
    if ($selected -ne $Threads) { throw 'Insufficient allowed processors' }
    return [IntPtr]::new([BitConverter]::ToInt64([BitConverter]::GetBytes($sharedMask), 0))
}
