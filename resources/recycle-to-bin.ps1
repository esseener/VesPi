# Moves one file to the Windows Recycle Bin. Path is argv, never interpolated into -Command.
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
