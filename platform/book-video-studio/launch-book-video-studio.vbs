Option Explicit

Dim shell, fso, baseDir, url, command, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:3000/"

If Not IsStudioReady(url) Then
  shell.CurrentDirectory = baseDir
  If Not fso.FolderExists(fso.BuildPath(baseDir, "data")) Then
    fso.CreateFolder(fso.BuildPath(baseDir, "data"))
  End If
  command = "cmd.exe /d /c npm.cmd run dev >> data\studio.log 2>&1"
  shell.Run command, 0, False
End If

For i = 1 To 30
  If IsStudioReady(url) Then
    shell.Run url, 1, False
    WScript.Quit 0
  End If
  WScript.Sleep 1000
Next

MsgBox "Book Video Studio could not start. Check data\studio.log.", 16, "Book Video Studio"
WScript.Quit 1

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Function IsStudioReady(targetUrl)
  Dim request
  On Error Resume Next
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 1000, 1000, 1000, 1000
  request.Open "GET", targetUrl, False
  request.Send
  IsStudioReady = (Err.Number = 0 And request.Status >= 200 And request.Status < 500)
  Err.Clear
  On Error GoTo 0
End Function
