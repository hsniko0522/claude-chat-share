# chat-share：取消“双击打开 .claudeshare”，恢复原来的打开方式。
# chat-share: turns off double-click opening for .claudeshare files and restores the previous handler.
# 用法：右键这个文件 →“用 PowerShell 运行”。 Usage: right-click → "Run with PowerShell".
& (Join-Path $PSScriptRoot 'setup-double-click.ps1') -Undo
