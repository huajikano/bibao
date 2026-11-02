import fs from 'node:fs'

// 1) hands-server：截图支持只截窗口区域
let p = 'bin/hands-server.ps1'
let s = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
const oldShot = `        'shot' {
          $s = Get-Screen
          $raw = New-Object System.Drawing.Bitmap $s.width, $s.height
          $g = [System.Drawing.Graphics]::FromImage($raw)
          $g.CopyFromScreen($s.x, $s.y, 0, 0, $raw.Size)`
const newShot = `        'shot' {
          $s = Get-Screen
          $cx = $s.x; $cy = $s.y; $cw = $s.width; $ch = $s.height
          if ($null -ne $argv.rect) {
            $cx = [int]$argv.rect.x; $cy = [int]$argv.rect.y
            $cw = [int]$argv.rect.w; $ch = [int]$argv.rect.h
            if ($cw -le 0 -or $ch -le 0) { $cx = $s.x; $cy = $s.y; $cw = $s.width; $ch = $s.height }
          }
          $raw = New-Object System.Drawing.Bitmap $cw, $ch
          $g = [System.Drawing.Graphics]::FromImage($raw)
          $g.CopyFromScreen($cx, $cy, 0, 0, $raw.Size)`
if (!s.includes(oldShot)) throw new Error('shot anchor missing')
s = s.replace(oldShot, newShot)
// 缩放判断要用截出来的尺寸
s = s.replace('if ($maxWidth -gt 0 -and $maxWidth -lt $s.width) {', 'if ($maxWidth -gt 0 -and $maxWidth -lt $cw) {')
s = s.replace('$scale = $maxWidth / $s.width', '$scale = $maxWidth / $cw')
s = s.replace('$w = [int]($s.width * $scale); $h = [int]($s.height * $scale)', '$w = [int]($cw * $scale); $h = [int]($ch * $scale)')
s = s.replace('$outW = $s.width; $outH = $s.height', '$outW = $cw; $outH = $ch')
fs.writeFileSync(p, '\uFEFF' + s)

// 2) input.js：shot 支持 rect
p = 'core/input.js'
let c = fs.readFileSync(p, 'utf8')
c = c.replace(
  "  shot(file, { maxWidth = 0, format = 'png' } = {}) {\n    return this.act('shot', { path: file, maxWidth, format }, 20000)\n  }",
  "  shot(file, { maxWidth = 0, format = 'png', rect = null } = {}) {\n    return this.act('shot', { path: file, maxWidth, format, rect }, 20000)\n  }",
)
fs.writeFileSync(p, c)

// 3) index.js：循环里只截游戏窗口
p = 'index.js'
let t = fs.readFileSync(p, 'utf8')
t = t.replace(
  "        const file = path.join(dataDir, 'screens', `auto-${Date.now()}.jpg`)\n        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg' })",
  "        const file = path.join(dataDir, 'screens', `auto-${Date.now()}.jpg`)\n        const winRect = (await inputAgent.rect(settings.game.window ?? 'TFT')) ?? null\n        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg', rect: winRect })",
)
fs.writeFileSync(p, t)
console.log('crop shot:', t.includes('rect: winRect'), 'hands rect:', s.includes('argv.rect'))
