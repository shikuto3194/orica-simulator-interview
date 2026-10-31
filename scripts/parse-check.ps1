param([Parameter(Mandatory)][string]$Path)
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
  Write-Host "PARSE_ERRORS: $($errors.Count)"
  foreach ($e in $errors) { Write-Host "  $($e.Message) @ line $($e.Extent.StartLineNumber)" }
  exit 1
}
Write-Host "PARSE_OK"
exit 0
