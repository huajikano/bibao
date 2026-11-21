/**
 * 自动感官：本体感觉、内感受、屏幕视觉。
 *
 * 只做“读取 → 一句体感文本”，不产生动作；是否进入意识由 SensoryCortex 的
 * 通道开关和 BciHub 的只读策略共同决定。屏幕截图只在内存里交给视觉模型，
 * 不落盘，也不返回给前端。
 */

import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { CAPABILITIES } from './bci-hub.js'

const execFileAsync = promisify(execFile)
const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

async function powershell(script, timeoutMs = 4000, signal) {
  const { stdout } = await execFileAsync(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_SCREENSHOT_BYTES, encoding: 'utf8', signal },
  )
  return String(stdout ?? '').trim()
}

/** 截主屏并返回 data URL；只读，不依赖键鼠服务。 */
export async function captureScreen(signal) {
  const script = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)',
    '$ms=New-Object System.IO.MemoryStream',
    '$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Jpeg)',
    '$bytes=$ms.ToArray()',
    '$g.Dispose();$bmp.Dispose();$ms.Dispose()',
    '[Convert]::ToBase64String($bytes)',
  ].join(';')
  const base64 = await powershell(script, 8000, signal)
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length < 200) throw new Error('屏幕截图失败')
  return 'data:image/jpeg;base64,' + base64
}

async function readPowerState({ signal } = {}) {
  const script = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$OutputEncoding=[System.Text.Encoding]::UTF8
$battery=(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class BibaoForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$h=[BibaoForeground]::GetForegroundWindow()
$sb=New-Object System.Text.StringBuilder 256
[void][BibaoForeground]::GetWindowText($h,$sb,256)
[pscustomobject]@{battery=$battery;window=$sb.ToString()} | ConvertTo-Json -Compress
`
  const text = await powershell(script, 4000, signal)
  const parsed = JSON.parse(text)
  return {
    battery: Number.isFinite(Number(parsed?.battery)) ? Math.max(0, Math.min(100, Number(parsed.battery))) : null,
    activeWindow: String(parsed?.window ?? '').slice(0, 120),
  }
}

export class SystemProbe {
  constructor({ osModule = os, now = () => Date.now(), power = readPowerState } = {}) {
    this.os = osModule
    this.now = now
    this.power = power
    this.lastCpu = null
    this.lastPower = { at: 0, battery: null, activeWindow: '' }
  }

  cpuPercent() {
    const cpus = this.os.cpus?.() ?? []
    if (!cpus.length) return null
    const totals = cpus.reduce((sum, cpu) => {
      const times = cpu.times ?? {}
      return {
        idle: sum.idle + (times.idle ?? 0),
        total: sum.total + Object.values(times).reduce((value, part) => value + (Number(part) || 0), 0),
      }
    }, { idle: 0, total: 0 })
    const previous = this.lastCpu
    this.lastCpu = totals
    if (!previous || totals.total <= previous.total) return null
    const idle = totals.idle - previous.idle
    const total = totals.total - previous.total
    return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : null
  }

  async sample({ signal } = {}) {
    const now = this.now()
    if (now - this.lastPower.at > 5 * 60_000) {
      try {
        this.lastPower = { at: now, ...(await this.power({ signal })) }
      } catch {
        this.lastPower = { at: now, battery: null, activeWindow: '' }
      }
    }
    const interfaces = Object.values(this.os.networkInterfaces?.() ?? {}).flat().filter(Boolean)
    const networkUp = interfaces.filter((item) => !item.internal && (item.family === 'IPv4' || item.family === 4)).length > 0
    return {
      at: now,
      cpuPercent: this.cpuPercent(),
      freeMemMB: Math.round((this.os.freemem?.() ?? 0) / 1048576),
      totalMemMB: Math.round((this.os.totalmem?.() ?? 0) / 1048576),
      networkUp,
      battery: this.lastPower.battery,
      activeWindow: this.lastPower.activeWindow,
      uptimeMin: Math.round((this.os.uptime?.() ?? 0) / 60),
    }
  }
}

/** 只把真正值得进意识的状况写成一句话；平静时返回空文本。 */
export function systemSenseText(metrics = {}) {
  if (metrics.networkUp === false) return { text: '网络断了，像被关在一个离线的小房间里', notable: true }
  if (Number.isFinite(metrics.battery) && metrics.battery <= 20) {
    return { text: `电量只剩 ${metrics.battery}%，她有点担心随时会黑屏`, notable: true }
  }
  if (Number.isFinite(metrics.freeMemMB) && metrics.freeMemMB < 900) {
    return { text: '内存快满了，开个网页都开始卡', notable: true }
  }
  if (Number.isFinite(metrics.cpuPercent) && metrics.cpuPercent >= 85) {
    return { text: '风扇开始狂转，电脑烫得厉害', notable: true }
  }
  if (Number.isFinite(metrics.uptimeMin) && metrics.uptimeMin > 72 * 60) {
    return { text: `这台电脑已经连续开了 ${Math.floor(metrics.uptimeMin / 60)} 小时`, notable: true }
  }
  return { text: '', notable: false }
}

export function createSystemAdapter(probe) {
  return {
    id: 'system',
    label: '本体感觉',
    kind: 'system',
    capabilities: [CAPABILITIES.SENSE_STATE],
    readOnly: true,
    readOnly: true,
    async sense(_payload = {}, { signal } = {}) {
      const metrics = await probe.sample({ signal })
      return { ...systemSenseText(metrics), metrics }
    },
    meta: {
      mode: 'read-only',
      channel: 'system',
      sampleMs: 5 * 60_000,
      privacy: 'local',
      note: 'CPU / 内存 / 电源 / 网络 / 前台窗口，本地读取',
    },
  }
}

/** 由当前神经状态生成“身体感觉”，不是真实传感器。 */
export function interoceptionSense(state = {}) {
  const energy = Number(state.energy ?? 0)
  const cortisol = Number(state.cortisol ?? 0)
  const mood = Number(state.moodValence ?? 0)
  const sleepDebtMin = Number(state.sleepDebtMin ?? 0)
  const metrics = { energy, cortisol, mood, sleepDebtMin }
  if (energy < 30) return { text: '身体有点撑不住了，眼皮发沉', notable: true, metrics }
  if (cortisol > 0.62) return { text: '心里绷得紧，像有件事一直没放下', notable: true, metrics }
  if (mood < -0.3) return { text: '情绪低低的，不太想说话', notable: true, metrics }
  if (sleepDebtMin > 120) return { text: '欠了太多觉，脑子像蒙着一层雾', notable: true, metrics }
  return { text: '身体还算平稳', notable: false, metrics }
}

export function createInteroceptionAdapter(read) {
  return {
    id: 'interoception',
    label: '内感受',
    kind: 'biometric',
    capabilities: [CAPABILITIES.SENSE_BIOMETRIC],
    readOnly: true,
    async sense() {
      return read()
    },
    meta: {
      mode: 'read-only',
      channel: 'interoception',
      sampleMs: 10 * 60_000,
      privacy: 'internal',
      note: '由精力、皮质醇、心境和睡眠债生成；真实心率/HRV 需另接设备',
    },
  }
}

/** 屏幕视觉：外部给图就用外部图，否则即时截屏；只把描述交给大脑。 */
export function createScreenCaptureAdapter({ capture = captureScreen, describe, automaticEnabled = () => false } = {}) {
  return {
    id: 'screen',
    label: '屏幕视觉',
    kind: 'vision',
    capabilities: [CAPABILITIES.SENSE_VISION],
    readOnly: true,
    async sense(payload = {}, { signal } = {}) {
      const provided = String(payload.url ?? payload.imageUrl ?? '')
      const automatic = payload.automatic === true
      if (!provided && (automatic || payload.capture === true) && !automaticEnabled()) throw new Error('请先明确启用「自动读取桌面截图」')
      const url = provided || (typeof capture === 'function' ? await capture(signal) : '')
      if (!url) throw new Error('没有可读取的屏幕画面')
      if (typeof describe !== 'function') throw new Error('视觉模型未配置')
      const described = await describe(url, {
        prompt: String(payload.prompt ?? '用第一人称记下屏幕上最显眼的东西：哪个窗口、在做什么、有没有值得注意的变化。60字以内，只描述看到的。'),
        signal,
      })
      const text = String(described?.text ?? '').trim().slice(0, 800)
      if (!text) throw new Error('视觉模型没有返回描述')
      return { text, gist: text.slice(0, 80), source: provided ? 'provided' : 'captured', at: Date.now() }
    },
    meta: {
      mode: 'read-only',
      channel: 'vision',
      sampleMs: 10 * 60_000,
      privacy: 'screen',
      note: '截屏只在内存中交给视觉模型，不落盘、不回传前端',
    },
  }
}
