' 隐藏启动手部服务：由 wscript 调起 powershell，窗口样式 0（完全隐藏）
' 用法：wscript.exe hands-hidden.vbs "D:\...\hands-server.ps1"
Dim shell, target, command
Set shell = CreateObject("WScript.Shell")
target = WScript.Arguments(0)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & target & """"
shell.Run command, 0, False
