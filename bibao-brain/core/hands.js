import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(HERE, '..', 'bin', 'hands-server.ps1')
const PORT = 8788

function powershellPath() {
  // Windows PowerShell 一定在；PowerShell 7（pwsh）不一定装，所以优先 pwsh、找不到就退回 powershell
  const candidates = [
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ]
  return candidates[0]
}

export async function handsAlive(timeoutMs = 1200) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const data = await res.json()
    return Boolean(data?.ok)
  } catch {
    return false
  }
}

/**
 * 启动"手"。之前这里用 spawn('pwsh') 直接把 DSH 带崩过一次：
 * 这台机器没有 pwsh，子进程 error 事件没人接，异常冒到主进程。
 * 现在：用绝对路径的 powershell.exe、detached + ignore stdio、error 事件全接住，
 * 并且绝不 await 它的 stdout —— 它只需要自己活着。
 */
export function startHands({ log = () => {} } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      // 经 cmd 的 start 起：父进程只是 cmd，powershell 由系统 shell 拉起，
      // 这样不会继承宿主进程那套受限的作业/控制台环境。
      child = spawn(
        'cmd.exe',
        ['/c', 'start', '', powershellPath(), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SERVER],
        { detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      )
    } catch (error) {
      log(`spawn failed: ${error.message}`)
      resolve(false)
      return
    }
    let settled = false
    // 把子进程的报错留下来，否则只会看到"没反应"
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim().slice(0, 200)
      if (line) log(`stderr ${line}`)
    })
    child.on('error', (error) => {
      log(`spawn error: ${error.message}`)
      if (!settled) {
        settled = true
        resolve(false)
      }
    })
    child.unref()
    // 给它一点时间绑定端口，然后探活
    setTimeout(async () => {
      const ok = await handsAlive(3000)
      log(ok ? 'hands started' : 'hands did not answer')
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }, 6000)
  })
}

/** 没起就起，起过就什么都不做。 */
export async function ensureHands({ log = () => {} } = {}) {
  if (await handsAlive()) return true
  return startHands({ log })
}

export { PORT }
