# chat-share：设置“双击 .claudeshare 文件 → 导入 Claude 并打开”。只需运行一次。
# chat-share: makes double-clicking a .claudeshare file import it into Claude and open it. Run once.
#
# 用法：在资源管理器里右键这个文件 →“用 PowerShell 运行”。取消：运行 undo-double-click.ps1。
# Usage: right-click this file in File Explorer → "Run with PowerShell". To undo, run undo-double-click.ps1.
#
# 只改当前用户自己的文件类型设置（HKCU），不需要管理员权限。
# Only changes the current user's file type settings (HKCU); no administrator rights needed.
param(
  [switch]$Undo,
  [ValidateSet('zh', 'en', '')][string]$Lang = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if (-not $Lang) { $Lang = if ((Get-Culture).Name -like 'zh*') { 'zh' } else { 'en' } }

$T = @{
  zh = @{
    caption  = '对话分享 · 双击打开'
    done     = "设置好了。现在双击 .claudeshare 文件，会导入对话，并问你要不要重启 Claude 打开它。`n`n打开方式：{0}"
    notYet   = "设置已写入，但 Windows 现在还会用别的程序打开 .claudeshare：`n{0}`n`n可以右键一个 .claudeshare 文件 →「打开方式」→「选择其他应用」，选「Windows PowerShell」或「Claude conversation (chat-share)」，并勾选「始终」。"
    undone   = '已取消。.claudeshare 恢复成原来的打开方式。'
    noScript = '找不到 open-claudeshare.ps1，请确认这个脚本还在 chat-share 的 bin 文件夹里。'
    failed   = '设置失败：'
  }
  en = @{
    caption  = 'chat-share · Double-click'
    done     = "All set. Double-clicking a .claudeshare file now imports the conversation and asks whether to restart Claude to open it.`n`nOpens with: {0}"
    notYet   = "The setting is saved, but Windows still opens .claudeshare files with another program:`n{0}`n`nRight-click a .claudeshare file → Open with → Choose another app, pick `"Windows PowerShell`" or `"Claude conversation (chat-share)`", and tick Always."
    undone   = 'Turned off. .claudeshare files open the way they did before.'
    noScript = 'open-claudeshare.ps1 was not found. Make sure it is still in the chat-share bin folder.'
    failed   = 'Setup failed: '
  }
}[$Lang]

Add-Type -Namespace ChatShare -Name Native -MemberDefinition @'
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, System.IntPtr a, System.IntPtr b);
[DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint str, string assoc, string extra, [Out] System.Text.StringBuilder outStr, ref uint outLen);
'@
function Get-OpenCommand {
  $sb = New-Object System.Text.StringBuilder 2048; [uint32]$n = 2048
  [void][ChatShare.Native]::AssocQueryString(0, 1, '.claudeshare', 'open', $sb, [ref]$n)
  return $sb.ToString()
}

$progId = 'ChatShare.claudeshare'
$ext    = 'HKCU:\Software\Classes\.claudeshare'
$prog   = "HKCU:\Software\Classes\$progId"
$choice = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.claudeshare'

try {
  if ($Undo) {
    $prev = (Get-ItemProperty -LiteralPath $ext -ErrorAction SilentlyContinue).ChatSharePrevious
    if ($prev) {
      Set-ItemProperty -LiteralPath $ext -Name '(default)' -Value $prev
      Remove-ItemProperty -LiteralPath $ext -Name 'ChatSharePrevious'
    } elseif ((Get-ItemProperty -LiteralPath $ext -ErrorAction SilentlyContinue).'(default)' -eq $progId) {
      Remove-ItemProperty -LiteralPath $ext -Name '(default)'
    }
    if (Test-Path -LiteralPath "$ext\OpenWithProgids") { Remove-ItemProperty -LiteralPath "$ext\OpenWithProgids" -Name $progId -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $prog) { Remove-Item -LiteralPath $prog -Recurse }
    [ChatShare.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
    [void][System.Windows.Forms.MessageBox]::Show($T.undone, $T.caption, 'OK', 'Information')
    exit 0
  }

  $handler = Join-Path $PSScriptRoot 'open-claudeshare.ps1'
  if (-not (Test-Path -LiteralPath $handler)) { throw $T.noScript }
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$handler`" -Lang $Lang `"%1`""

  # 1. 注册我们的打开方式 / register our handler
  if (-not (Test-Path -LiteralPath "$prog\shell\open\command")) { New-Item -Path "$prog\shell\open\command" -Force | Out-Null }
  Set-ItemProperty -LiteralPath $prog -Name '(default)' -Value 'Claude conversation (chat-share)'
  Set-ItemProperty -LiteralPath "$prog\shell\open" -Name 'FriendlyAppName' -Value 'Claude conversation (chat-share)'
  Set-ItemProperty -LiteralPath "$prog\shell\open\command" -Name '(default)' -Value $cmd

  # 2. 让 .claudeshare 默认用它，记下原来的以便取消时还原 / make it the default, remembering the old one
  if (-not (Test-Path -LiteralPath $ext)) { New-Item -Path $ext | Out-Null }
  $old = (Get-ItemProperty -LiteralPath $ext -ErrorAction SilentlyContinue).'(default)'
  if ($old -and $old -ne $progId) { Set-ItemProperty -LiteralPath $ext -Name 'ChatSharePrevious' -Value $old }
  Set-ItemProperty -LiteralPath $ext -Name '(default)' -Value $progId
  if (-not (Test-Path -LiteralPath "$ext\OpenWithProgids")) { New-Item -Path "$ext\OpenWithProgids" | Out-Null }
  New-ItemProperty -LiteralPath "$ext\OpenWithProgids" -Name $progId -Value '' -PropertyType String -Force | Out-Null

  # 3. 清掉以前“始终用某个程序打开 .claudeshare”的选择，它会盖过上面的设置
  #    Clear an earlier "always open .claudeshare with ..." choice, which would override the setting above
  foreach ($sub in 'UserChoice', 'UserChoiceLatest') {
    if (Test-Path -LiteralPath "$choice\$sub") { Remove-Item -LiteralPath "$choice\$sub" -Recurse -Force }
  }
  [ChatShare.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

  # 4. 问 Windows 现在实际会用什么打开 / ask Windows what it will actually use now
  $now = Get-OpenCommand
  if ($now -like '*open-claudeshare.ps1*') {
    [void][System.Windows.Forms.MessageBox]::Show(($T.done -f $now), $T.caption, 'OK', 'Information')
  } else {
    [void][System.Windows.Forms.MessageBox]::Show(($T.notYet -f $now), $T.caption, 'OK', 'Warning')
  }
} catch {
  [void][System.Windows.Forms.MessageBox]::Show($T.failed + $_.Exception.Message, $T.caption, 'OK', 'Error')
  exit 1
}
