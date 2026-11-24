# chat-share：双击 .claudeshare 时运行。把对话导入 Claude，问要不要重启，重启后直接打开这段对话。
# chat-share: runs when a .claudeshare file is double-clicked. Imports the conversation into Claude,
# asks whether to restart Claude, and opens the conversation after the restart.
#
# 用法 / Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File open-claudeshare.ps1 -Lang zh "<file>"
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$File,
  [ValidateSet('zh', 'en')][string]$Lang = 'zh',
  [switch]$NoPrompt   # 测试用：不弹窗、不重启 / for testing: no dialogs, no restart
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$T = @{
  zh = @{
    caption      = '对话分享'
    notPackage   = '这不是对话分享导出的文件。'
    failed       = '导入失败：'
    askRestart   = "已导入《{0}》（放在 {1}）。`n`nClaude 需要重启才能在侧边栏显示它。现在重启吗？`n`n注意：重启会中断 Claude 里正在进行的任务。"
    notRunning   = "已导入《{0}》。现在打开 Claude。"
    later        = "已导入《{0}》。下次打开 Claude 时，它会出现在左边侧边栏。"
    noDesktop    = "已导入《{0}》，但没找到 Claude 桌面 app 的会话目录。可以在命令行进入 {1}，运行：`nclaude --resume {2}"
  }
  en = @{
    caption      = 'chat-share'
    notPackage   = 'This is not a file exported by chat-share.'
    failed       = 'Import failed: '
    askRestart   = "Imported `"{0}`" (into {1}).`n`nClaude needs a restart to show it in the sidebar. Restart now?`n`nNote: restarting stops anything Claude is running right now."
    notRunning   = "Imported `"{0}`". Opening Claude now."
    later        = "Imported `"{0}`". It will appear in the sidebar the next time you open Claude."
    noDesktop    = "Imported `"{0}`", but the Claude desktop app's session folder was not found. In a terminal, go to {1} and run:`nclaude --resume {2}"
  }
}[$Lang]

function Show-Box([string]$text, [string]$buttons = 'OK', [string]$icon = 'Information') {
  if ($NoPrompt) { Write-Host "[dialog] $text"; return 'Yes' }
  return [System.Windows.Forms.MessageBox]::Show($text, $T.caption, $buttons, $icon).ToString()
}

# JSON 字符串里的写法（和 JS 的 JSON.stringify 一致：只转义 \ 和 "）
function Esc-Json([string]$s) { return $s.Replace('\', '\\').Replace('"', '\"') }

# Claude Code 存会话的目录名：路径里非字母数字的字符都换成 -
function Encode-Cwd([string]$p) { return ($p -replace '[^A-Za-z0-9]', '-') }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stage = Join-Path $env:TEMP ('chat-share-' + [guid]::NewGuid().ToString('N'))

try {
  if (-not (Test-Path -LiteralPath $File)) { throw "File not found: $File" }

  # 1. 解包：先复制成英文名，tar 只用相对路径，避开中文路径问题
  New-Item -ItemType Directory -Force $stage | Out-Null
  Copy-Item -LiteralPath $File -Destination (Join-Path $stage 'package.claudeshare')
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  Push-Location $stage
  try { & $tar -xf 'package.claudeshare' 2>$null; if ($LASTEXITCODE -ne 0) { throw $T.notPackage } } finally { Pop-Location }

  $manifestPath = Join-Path $stage 'manifest.json'
  if (-not (Test-Path $manifestPath)) { throw $T.notPackage }
  $manifest = [IO.File]::ReadAllText($manifestPath, $utf8) | ConvertFrom-Json
  if (-not ([string]$manifest.format).StartsWith('claude-code-share/')) { throw $T.notPackage }

  # 2. 读出会话记录：v2 分段在 session\，v1 是一个 session.jsonl
  $sessDir = Join-Path $stage 'session'
  $sb = New-Object System.Text.StringBuilder
  if (Test-Path $sessDir) {
    # Mac 打包时会夹带 ._xxx 隐藏文件（Mac 的文件属性，不是对话），跳过
    Get-ChildItem -LiteralPath $sessDir -Filter '*.jsonl' | Where-Object { -not $_.Name.StartsWith('._') } | Sort-Object Name | ForEach-Object {
      [void]$sb.Append([IO.File]::ReadAllText($_.FullName, $utf8))
    }
  } else {
    [void]$sb.Append([IO.File]::ReadAllText((Join-Path $stage 'session.jsonl'), $utf8))
  }
  $text = $sb.ToString()

  # 3. 换成新的会话 ID，把原来的文件夹路径换成本机的用户目录
  $oldSid = [string]$manifest.sourceSessionId
  $newSid = [guid]::NewGuid().ToString()
  $target = $env:USERPROFILE
  $title = if ($manifest.title) { [string]$manifest.title } else { if ($Lang -eq 'zh') { '导入的对话' } else { 'Imported conversation' } }

  $text = $text.Replace('"sessionId":"' + $oldSid + '"', '"sessionId":"' + $newSid + '"')
  $oldCwd = [string]$manifest.sourceCwd
  if ($oldCwd) {
    foreach ($key in 'cwd', 'relocatedCwd') {
      $text = $text.Replace('"' + $key + '":"' + (Esc-Json $oldCwd), '"' + $key + '":"' + (Esc-Json $target))
    }
  }
  $lines = $text -split "`n" | Where-Object { $_.Trim() -ne '' -and $_ -notmatch '"type":"(custom-title|agent-name)"' }
  $lines += '{"type":"custom-title","customTitle":"' + (Esc-Json $title) + '","sessionId":"' + $newSid + '"}'
  $lines += '{"type":"agent-name","agentName":"' + (Esc-Json $title) + '","sessionId":"' + $newSid + '"}'

  $projDir = Join-Path $env:USERPROFILE ('.claude\projects\' + (Encode-Cwd $target))
  New-Item -ItemType Directory -Force $projDir | Out-Null
  [IO.File]::WriteAllText((Join-Path $projDir "$newSid.jsonl"), (($lines -join "`n") + "`n"), $utf8)

  # 附带文件夹（子任务记录、大段工具输出）：robocopy 不受 260 字符路径上限的限制
  $side = Join-Path $stage $oldSid
  if ($oldSid -and (Test-Path $side)) {
    & robocopy $side (Join-Path $projDir $newSid) /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  }

  # 4. 写进桌面 app 的会话列表（侧边栏读的就是这里）：找最近用过的那个目录
  $roots = @()
  foreach ($base in @($env:LOCALAPPDATA, $env:APPDATA)) {
    if (-not $base) { continue }
    Get-ChildItem -LiteralPath $base -Directory -Filter 'Claude*' -ErrorAction SilentlyContinue | ForEach-Object {
      $roots += Join-Path $_.FullName 'claude-code-sessions'
      Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { $roots += Join-Path $_.FullName 'claude-code-sessions' }
    }
  }
  $best = $null; $bestTime = [datetime]::MinValue
  foreach ($r in $roots) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    Get-ChildItem -LiteralPath $r -Directory | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory } | ForEach-Object {
      $newest = Get-ChildItem -LiteralPath $_.FullName -Filter 'local_*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($newest -and $newest.LastWriteTime -gt $bestTime) { $best = $_.FullName; $bestTime = $newest.LastWriteTime }
    }
  }

  if (-not $best) {
    [void](Show-Box ($T.noDesktop -f $title, $target, $newSid))
    exit 0
  }

  $now = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $localId = 'local_' + [guid]::NewGuid().ToString()
  $meta = [ordered]@{
    sessionId = $localId; cliSessionId = $newSid
    cwd = $target; originCwd = $target
    folderPlace = [ordered]@{ cwd = $target; realPath = $target }
    gitAnchorsFolderRealpath = $target
    createdAt = $now; lastActivityAt = $now; lastFocusedAt = $now; lastTurnEdgeAt = $now
    isArchived = $false; title = $title; titleSource = 'user'; permissionMode = 'default'
    lastAssistantCliSessionId = $newSid
  }
  if ($manifest.model) { $meta.model = [string]$manifest.model }
  if ($manifest.effort) { $meta.effort = [string]$manifest.effort }
  [IO.File]::WriteAllText((Join-Path $best "$localId.json"), ($meta | ConvertTo-Json -Depth 5), $utf8)
  if ($NoPrompt) { Write-Output "[imported] $localId $newSid" }

  # 5. 重启 Claude 并打开这段对话（只关桌面 app 本身，不碰别的程序）
  $link = "claude://claude.ai/epitaxy/$localId"
  $desktop = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\WindowsApps\Claude_*\app\Claude.exe' })
  if ($desktop.Count -eq 0) {
    [void](Show-Box ($T.notRunning -f $title))
    if (-not $NoPrompt) { Start-Process $link }
    exit 0
  }
  $answer = Show-Box ($T.askRestart -f $title, $target) 'YesNo' 'Question'
  if ($answer -eq 'Yes') {
    if (-not $NoPrompt) {
      $desktop | Stop-Process -Force
      Start-Sleep -Seconds 3
      Start-Process $link
    }
  } else {
    [void](Show-Box ($T.later -f $title))
  }
} catch {
  [void](Show-Box ($T.failed + $_.Exception.Message) 'OK' 'Error')
  exit 1
} finally {
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
