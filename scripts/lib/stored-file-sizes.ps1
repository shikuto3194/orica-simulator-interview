$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ArtifactStoredSize {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetCompressedFileSizeW(string path, out uint high);
  [DllImport("kernel32.dll")]
  private static extern void SetLastError(uint error);
  public static long Read(string path) {
    SetLastError(0);
    uint high;
    uint low = GetCompressedFileSizeW(path, out high);
    int error = Marshal.GetLastWin32Error();
    if (low == uint.MaxValue && error != 0) throw new Win32Exception(error, path);
    return checked((long)(((ulong)high << 32) | low));
  }
}
'@
$artifactPaths = ConvertFrom-Json ([Console]::In.ReadToEnd())
$artifactSizes = @($artifactPaths | ForEach-Object { [ArtifactStoredSize]::Read($_) })
[Console]::WriteLine((ConvertTo-Json -InputObject $artifactSizes -Compress))
