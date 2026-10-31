' run-hidden.vbs - launch a command with NO console window and wait for it to exit.
'
' Why ASCII-only: wscript/cscript read .vbs as the system ANSI codepage (Shift-JIS on a
' Japanese Windows). UTF-8 multibyte comment bytes get misparsed and break compilation,
' so this file is intentionally pure ASCII.
'
' Background: a scheduled task with LogonType=InteractiveToken that launches pwsh.exe /
' node.exe directly shows a console window on the logged-on desktop; long-running or hung
' runs then leave that window sitting there. wscript.exe itself has no window, so launching
' the child from here with WindowStyle=0 keeps it hidden. bWaitOnReturn=True blocks until the
' child exits, so Task Scheduler still tracks duration / MultipleInstances / ExecutionTimeLimit
' (InteractiveToken is preserved).
'
' Usage: wscript.exe run-hidden.vbs <exe> [arg1] [arg2] ...
'   Args after the script are the child exe + its args. Args containing spaces are re-quoted
'   into a single command line.

Option Explicit
Dim sh, i, a, cmd
Set sh = CreateObject("WScript.Shell")

If WScript.Arguments.Count = 0 Then
  WScript.Quit 2
End If

cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  a = WScript.Arguments(i)
  If InStr(a, " ") > 0 And Left(a, 1) <> """" Then
    a = """" & a & """"
  End If
  If i > 0 Then cmd = cmd & " "
  cmd = cmd & a
Next

' WindowStyle 0 = hidden, bWaitOnReturn True = wait for the child to finish.
WScript.Quit sh.Run(cmd, 0, True)
