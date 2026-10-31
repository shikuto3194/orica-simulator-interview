function Invoke-FullRunCheckoutPreflight {
  param(
    [Parameter(Mandatory)][string]$Node,
    [Parameter(Mandatory)][string]$Script,
    [Parameter(Mandatory)][string]$Repo
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Node
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  foreach ($argument in @($Script, "--repo", $Repo, "--full-run")) {
    [void]$startInfo.ArgumentList.Add($argument)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Could not start checkout preflight: $Node" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }

  if ($exitCode -ne 0) {
    $detail = (@($stderr, $stdout) | Where-Object { $_ }) -join [Environment]::NewLine
    $detail = $detail.Trim()
    if ($detail.Length -gt 1600) {
      $detail = $detail.Substring(0, 1600) + "..."
    }
    $message = "Full-run checkout/ref binding failed (exit $exitCode); preserve existing work"
    if ($detail) { $message += ": $detail" }
    throw $message
  }

  return $stdout
}
