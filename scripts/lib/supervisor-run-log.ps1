# Create a new file for this invocation. Never rotate, truncate, move, or delete
# the historical supervisor-run.log or a file held by a running worker.
function New-SupervisorRunLog {
  param([Parameter(Mandatory)][string]$LogDir, [Parameter(Mandatory)][int]$RunProcessId)
  $runLogDir = Join-Path $LogDir 'supervisor-runs'
  [System.IO.Directory]::CreateDirectory($runLogDir) | Out-Null
  $runStamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
  $runKey = [guid]::NewGuid().ToString('N')
  $runLog = Join-Path $runLogDir "$runStamp-$RunProcessId-$runKey.log"
  $stream = [System.IO.File]::Open($runLog, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
  $stream.Dispose()
  return $runLog
}
