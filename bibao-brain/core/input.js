/**
 * 手：和"手部代理"通信的客户端。
 *
 * 刻意不在插件进程里 spawn 任何子进程——上次那样做直接把 DSH 主进程带崩了。
 * 现在改成：你自己启动一个独立的小服务（bin/start-hands.bat），插件通过
 * 127.0.0.1 的 HTTP 跟它说话。插件没权限、服务没起，都只是"手不可用"。
 */

const DEFAULT_BASE = 'http://127.0.0.1:8788'

export class InputAgent {
  constructor({ baseURL = DEFAULT_BASE, log = () => {} } = {}) {
    this.baseURL = String(baseURL).replace(/\/+$/, '')
    this.log = log
    this.lastError = ''
  }

  async request(pathname, options = {}, timeoutMs = 5000) {
    const res = await fetch(`${this.baseURL}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (!res.ok || !data || data.ok === false) {
      throw new Error(data?.error ?? `手部代理返回 ${res.status}`)
    }
    return data
  }

  async ping() {
    try {
      const data = await this.request('/health', {}, 2000)
      return Boolean(data?.ok)
    } catch (error) {
      this.lastError = String(error?.message ?? error)
      return false
    }
  }

  async focus(match) {
    return this.request('/focus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ match }),
    })
  }

  async pos() {
    const data = await this.request('/pos')
    return { x: data.x, y: data.y }
  }

  async size() {
    const data = await this.request('/size')
    return { width: data.width, height: data.height, x: data.x, y: data.y }
  }

  act(cmd, args = {}, timeoutMs = 12000) {
    return this.request(
      '/act',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd, args }),
      },
      timeoutMs,
    )
  }

  move(x, y) {
    return this.act('move', { x: Math.round(x), y: Math.round(y) })
  }

  click(x, y, button = 'l') {
    return this.act('click', { x: Math.round(x), y: Math.round(y), button })
  }

  drag(x1, y1, x2, y2, ms = 300) {
    return this.act('drag', { x1, y1, x2, y2, ms }, 20000)
  }

  key(combo) {
    return this.act('key', { combo })
  }

  type(text) {
    return this.act('type', { text })
  }

  shot(file, { maxWidth = 0, format = 'png' } = {}) {
    return this.act('shot', { path: file, maxWidth, format }, 20000)
  }
}
