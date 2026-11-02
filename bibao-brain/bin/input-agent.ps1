# 比宝的"手"：常驻的输入代理。
# 逐行读命令、逐行回 ok，避免每次动作都重启进程。
# 用法：pwsh -NoProfile -ExecutionPolicy Bypass -File input-agent.ps1
# 命令：
#   pos                     -> ok x y
#   move x y
#   click [l|r] x y
#   down [l|r] / up [l|r]
#   drag x1 y1 x2 y2 [ms]
#   key "ctrl+a"            组合键，支持 + 连接
#   type 文本               直接键入（SendKeys）
#   shot 路径.png           全屏截图
#   size                    -> ok width height
#   quit

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BibaoInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flag, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public struct POINT { public int X; public int Y; }
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$KEYUP = 0x0002

function Say($text) { [Console]::Out.WriteLine($text); [Console]::Out.Flush() }

function Move-To($x, $y) { [BibaoInput]::SetCursorPos([int]$x, [int]$y) | Out-Null }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  $parts = $line -split '\s+', 2
  $cmd = $parts[0].ToLower()
  $rest = if ($parts.Length -gt 1) { $parts[1] } else { '' }
  try {
    switch ($cmd) {
      'quit' { Say 'ok bye'; break }
      'pos' {
        $p = New-Object BibaoInput+POINT
        [BibaoInput]::GetCursorPos([ref]$p) | Out-Null
        Say "ok $($p.X) $($p.Y)"
      }
      'size' {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        Say "ok $($vs.Width) $($vs.Height) $($vs.X) $($vs.Y)"
      }
      'move' {
        $xy = $rest -split '\s+'
        Move-To $xy[0] $xy[1]
        Say 'ok moved'
      }
      'click' {
        $args = $rest -split '\s+'
        $button = 'l'
        if ($args[0] -in @('l', 'r')) { $button = $args[0]; $args = $args[1..($args.Length - 1)] }
        if ($args.Length -ge 2) { Move-To $args[0] $args[1] }
        if ($button -eq 'r') {
          [BibaoInput]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 40
          [BibaoInput]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
        } else {
          [BibaoInput]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 40
          [BibaoInput]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        }
        Say 'ok clicked'
      }
      'down' {
        $flag = if ($rest -eq 'r') { $MOUSEEVENTF_RIGHTDOWN } else { $MOUSEEVENTF_LEFTDOWN }
        [BibaoInput]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
        Say 'ok down'
      }
      'up' {
        $flag = if ($rest -eq 'r') { $MOUSEEVENTF_RIGHTUP } else { $MOUSEEVENTF_LEFTUP }
        [BibaoInput]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
        Say 'ok up'
      }
      'drag' {
        $a = $rest -split '\s+'
        $ms = if ($a.Length -ge 5) { [int]$a[4] } else { 300 }
        Move-To $a[0] $a[1]
        [BibaoInput]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        $steps = [Math]::Max(4, [Math]::Floor($ms / 30))
        for ($i = 1; $i -le $steps; $i++) {
          $x = [int]([double]$a[0] + ([double]$a[2] - [double]$a[0]) * $i / $steps)
          $y = [int]([double]$a[1] + ([double]$a[3] - [double]$a[1]) * $i / $steps)
          Move-To $x $y
          Start-Sleep -Milliseconds ([Math]::Max(8, [int]($ms / $steps)))
        }
        [BibaoInput]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        Say 'ok dragged'
      }
      'key' {
        [System.Windows.Forms.SendKeys]::SendWait($rest)
        Say 'ok key'
      }
      'type' {
        [System.Windows.Forms.SendKeys]::SendWait($rest)
        Say 'ok typed'
      }
      'shot' {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
        $bmp.Save($rest, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
        Say "ok shot $rest"
      }
      default { Say "err unknown $cmd" }
    }
  } catch {
    Say "err $($_.Exception.Message)"
  }
}
