# chat-share：检查双击 .claudeshare 为什么没按预期打开。只读取，不改任何设置。
# chat-share: checks why double-clicking .claudeshare does not open as expected. Read-only; changes nothing.
# 用法：右键 →「用 PowerShell 运行」。报告写到 %USERPROFILE%\.claude\plugins\data\chat-share-double-click-report.txt
# Usage: right-click → "Run with PowerShell". The report goes to %USERPROFILE%\.claude\plugins\data\chat-share-double-click-report.txt

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace ChatShareDiag -Name Native -MemberDefinition @'
[DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint str, string assoc, string extra, [Out] System.Text.StringBuilder outStr, ref uint outLen);
'@
function Q([uint32]$str, [string]$assoc, [string]$verb = 'open') {
  $sb = New-Object System.Text.StringBuilder 2048; [uint32]$n = 2048
  $hr = [ChatShareDiag.Native]::AssocQueryString(0, $str, $assoc, $verb, $sb, [ref]$n)
  return "{0} (hr=0x{1:X})" -f $sb.ToString(), $hr
}
function Dump([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return "  (missing) $path" }
  $lines = @("  [$path]")
  $item = Get-Item -LiteralPath $path
  foreach ($name in $item.GetValueNames()) { $lines += "    " + ($(if ($name) { $name } else { '(default)' })) + " = " + $item.GetValue($name) }
  foreach ($sub in Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue) { $lines += Dump $sub.PSPath }
  return $lines
}

$r = @()
$r += "time      : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$r += "windows   : " + [Environment]::OSVersion.VersionString + " / " + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue).DisplayVersion
$r += "ps        : " + $PSVersionTable.PSVersion
$r += "opens with: " + (Q 1 '.claudeshare')
$r += "progid    : " + (Q 20 '.claudeshare')
$r += ""
$r += "--- HKCU Classes"
$r += Dump 'HKCU:\Software\Classes\.claudeshare'
$r += Dump 'HKCU:\Software\Classes\ChatShare.claudeshare'
$r += Dump 'HKCU:\Software\Classes\claudeshare_auto_file'
$r += "--- Explorer FileExts (user choices)"
$r += Dump 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.claudeshare'
$r += "--- HKLM Classes"
$r += Dump 'HKLM:\Software\Classes\.claudeshare'
$r += "--- handler script"
$h = Join-Path $PSScriptRoot 'open-claudeshare.ps1'
$r += "  exists: " + (Test-Path -LiteralPath $h) + "  $h"
$r += "  execution policy: " + ((Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ', ')

$out = Join-Path $env:USERPROFILE '.claude\plugins\data\chat-share-double-click-report.txt'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$r | Out-File -Encoding utf8 $out
[void][System.Windows.Forms.MessageBox]::Show("Report saved / 报告已保存:`n$out", 'chat-share', 'OK', 'Information')
