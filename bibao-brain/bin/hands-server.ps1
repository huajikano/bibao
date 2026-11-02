# 手部代理：一个只在本机回环监听的 HTTP 小服务，负责真的动鼠标键盘、截图。
# 由你自己启动（双击 start-hands.bat），不要挂进 DSH 进程里。
# 接口：
#   GET  /health            -> {ok, screen}
#   GET  /pos               -> {ok,x,y}
#   GET  /size              -> {ok,width,height,x,y}
#   POST /act {cmd,args}    -> cmd: move|click|drag|key|type|shot
#   POST /quit              -> 退出

param([int]$Port = 8788)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BibaoHands {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flag, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int X; public int Y; }
}
"@

$LEFTDOWN = 0x0002; $LEFTUP = 0x0004; $RIGHTDOWN = 0x0008; $RIGHTUP = 0x0010

function Get-Screen {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  return @{ width = $vs.Width; height = $vs.Height; x = $vs.X; y = $vs.Y }
}

function Write-Json($ctx, $status, $object) {
  $json = $object | ConvertTo-Json -Compress -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "比宝的手已就绪：http://127.0.0.1:$Port/  （关掉这个窗口就停）"

$running = $true
while ($running) {
  $ctx = $listener.GetContext()
  $path = $ctx.Request.Url.AbsolutePath
  try {
    if ($path -eq '/health') {
      $s = Get-Screen
      Write-Json $ctx 200 @{ ok = $true; screen = $s }
    }
    elseif ($path -eq '/pos') {
      $p = New-Object BibaoHands+POINT
      [BibaoHands]::GetCursorPos([ref]$p) | Out-Null
      Write-Json $ctx 200 @{ ok = $true; x = $p.X; y = $p.Y }
    }
    elseif ($path -eq '/size') {
      $s = Get-Screen
      Write-Json $ctx 200 (@{ ok = $true } + $s)
    }
    elseif ($path -eq '/act' -and $ctx.Request.HttpMethod -eq 'POST') {
      $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $cmd = [string]$body.cmd
      $argv = $body.args
      switch ($cmd) {
        'move' {
          [BibaoHands]::SetCursorPos([int]$argv.x, [int]$argv.y) | Out-Null
          Write-Json $ctx 200 @{ ok = $true }
        }
        'click' {
          if ($null -ne $argv.x) { [BibaoHands]::SetCursorPos([int]$argv.x, [int]$argv.y) | Out-Null }
          if ($argv.button -eq 'r') {
            [BibaoHands]::mouse_event($RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            [BibaoHands]::mouse_event($RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
          } else {
            [BibaoHands]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            [BibaoHands]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
          }
          Write-Json $ctx 200 @{ ok = $true }
        }
        'drag' {
          $ms = if ($null -ne $argv.ms) { [int]$argv.ms } else { 300 }
          [BibaoHands]::SetCursorPos([int]$argv.x1, [int]$argv.y1) | Out-Null
          [BibaoHands]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
          $steps = [Math]::Max(5, [Math]::Floor($ms / 30))
          for ($i = 1; $i -le $steps; $i++) {
            $x = [int]([double]$argv.x1 + ([double]$argv.x2 - [double]$argv.x1) * $i / $steps)
            $y = [int]([double]$argv.y1 + ([double]$argv.y2 - [double]$argv.y1) * $i / $steps)
            [BibaoHands]::SetCursorPos($x, $y) | Out-Null
            Start-Sleep -Milliseconds ([Math]::Max(8, [int]($ms / $steps)))
          }
          [BibaoHands]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
          Write-Json $ctx 200 @{ ok = $true }
        }
        'key' {
          [System.Windows.Forms.SendKeys]::SendWait([string]$argv.combo)
          Write-Json $ctx 200 @{ ok = $true }
        }
        'type' {
          [System.Windows.Forms.SendKeys]::SendWait([string]$argv.text)
          Write-Json $ctx 200 @{ ok = $true }
        }
        'shot' {
          $s = Get-Screen
          $raw = New-Object System.Drawing.Bitmap $s.width, $s.height
          $g = [System.Drawing.Graphics]::FromImage($raw)
          $g.CopyFromScreen($s.x, $s.y, 0, 0, $raw.Size)
          $maxWidth = if ($null -ne $argv.maxWidth) { [int]$argv.maxWidth } else { 0 }
          if ($maxWidth -gt 0 -and $maxWidth -lt $s.width) {
            $scale = $maxWidth / $s.width
            $w = [int]($s.width * $scale); $h = [int]($s.height * $scale)
            $small = New-Object System.Drawing.Bitmap $w, $h
            $g2 = [System.Drawing.Graphics]::FromImage($small)
            $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g2.DrawImage($raw, 0, 0, $w, $h)
            $g2.Dispose()
            if ([string]$argv.format -eq 'jpeg') {
              $small.Save([string]$argv.path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            } else {
              $small.Save([string]$argv.path, [System.Drawing.Imaging.ImageFormat]::Png)
            }
            $small.Dispose()
            $outW = $w; $outH = $h
          } else {
            $raw.Save([string]$argv.path, [System.Drawing.Imaging.ImageFormat]::Png)
            $outW = $s.width; $outH = $s.height
          }
          $g.Dispose(); $raw.Dispose()
          Write-Json $ctx 200 @{ ok = $true; path = [string]$argv.path; width = $outW; height = $outH }
        }
        default { Write-Json $ctx 400 @{ ok = $false; error = "unknown cmd $cmd" } }
      }
    }
    elseif ($path -eq '/quit') {
      Write-Json $ctx 200 @{ ok = $true }
      $running = $false
    }
    else {
      Write-Json $ctx 404 @{ ok = $false; error = 'not found' }
    }
  } catch {
    Write-Json $ctx 500 @{ ok = $false; error = $_.Exception.Message }
  }
}
$listener.Stop()
