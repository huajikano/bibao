/**
 * 反向 WebSocket（OneBot 11 / snowluma wsClient）服务端。
 *
 * 有些部署里 snowluma 不是开 3000/3001，而是让它的 `wsClients` 主动连出来；
 * 这时插件需要在本机监听一个 WS 端点（例如 ws://127.0.0.1:8080/ws），
 * 接收事件，并在同一条连接上发动作请求。
 *
 * 这里不依赖 `ws` 包：手写 WebSocket 握手与帧解析，只支持 OneBot 需要的
 * 文本帧、ping/pong、close；够用且不增加安装依赖。
 */

import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_FRAME = 8 * 1024 * 1024

function acceptKey(key) {
  return createHash('sha1').update(String(key) + GUID).digest('base64')
}

function masked(payload, mask) {
  const out = Buffer.allocUnsafe(payload.length)
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i % 4]
  return out
}

class WsPeer {
  constructor(socket, { onMessage, onClose, logger = () => {} }) {
    this.socket = socket
    this.onMessage = onMessage
    this.onClose = onClose
    this.logger = logger
    this.buffer = Buffer.alloc(0)
    this.closed = false
    socket.on('data', (chunk) => this._feed(chunk))
    socket.on('close', () => this._closed())
    socket.on('error', (error) => {
      this.logger(`reverse ws peer error: ${error?.message ?? error}`)
      this._closed()
    })
  }

  _closed() {
    if (this.closed) return
    this.closed = true
    this.onClose?.()
  }

  _feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]
      const b1 = this.buffer[1]
      const opcode = b0 & 0x0f
      const isMasked = Boolean(b1 & 0x80)
      let length = b1 & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) return
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        const big = this.buffer.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME)) {
          this.close(1009)
          return
        }
        length = Number(big)
        offset = 10
      }
      if (length > MAX_FRAME) {
        this.close(1009)
        return
      }
      let mask = null
      if (isMasked) {
        if (this.buffer.length < offset + 4) return
        mask = this.buffer.slice(offset, offset + 4)
        offset += 4
      }
      if (this.buffer.length < offset + length) return
      let payload = this.buffer.slice(offset, offset + length)
      if (mask) payload = masked(payload, mask)
      this.buffer = this.buffer.slice(offset + length)
      this._frame(opcode, payload)
    }
  }

  _frame(opcode, payload) {
    if (opcode === 0x1) {
      this.onMessage?.(payload.toString('utf8'))
      return
    }
    if (opcode === 0x8) {
      this.close(1000)
      return
    }
    if (opcode === 0x9) {
      this._sendFrame(0xa, payload)
      return
    }
    // 0x0 continuation / 0xa pong：OneBot 文本消息够用，忽略
  }

  _sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))
    let header
    if (body.length < 126) {
      header = Buffer.from([0x80 | opcode, body.length])
    } else if (body.length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(body.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(body.length), 2)
    }
    try {
      this.socket.write(Buffer.concat([header, body]))
    } catch (error) {
      this.logger(`reverse ws write failed: ${error?.message ?? error}`)
    }
  }

  send(text) {
    this._sendFrame(0x1, text)
  }

  close(code = 1000) {
    if (this.closed) return
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code, 0)
    this._sendFrame(0x8, payload)
    this.closed = true
    try {
      this.socket.end()
    } catch {
      /* 已经断开 */
    }
    this.onClose?.()
  }
}

function tokenOf(req, url) {
  const fromQuery = url.searchParams.get('access_token') ?? url.searchParams.get('token')
  if (fromQuery) return fromQuery
  const header = String(req.headers.authorization ?? '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return String(req.headers['x-access-token'] ?? req.headers['x-self-token'] ?? '')
}

export class OneBotWsServer {
  constructor({ host = '127.0.0.1', port = 8080, path = '/ws', token = '', onEvent = () => {}, onStatus = () => {}, logger = () => {} } = {}) {
    this.host = host
    this.port = Number.isFinite(Number(port)) ? Number(port) : 8080
    this.path = path || '/ws'
    this.token = String(token ?? '')
    this.onEvent = onEvent
    this.onStatus = onStatus
    this.logger = logger
    this.server = null
    this.peer = null
    this.pending = new Map()
    this.waiters = new Set()
    this.selfId = ''
    this._seq = 0
    this.closed = false
    this.stats = { events: 0, messages: 0, sent: 0, deleted: 0, errors: 0, lastEventAt: 0 }
  }

  async listen() {
    if (this.server) return this
    this.server = createServer((req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', upgrade: 'websocket' })
      res.end('WebSocket upgrade required')
    })
    this.server.on('upgrade', (req, socket, head) => this._upgrade(req, socket, head))
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off('error', onError)
        reject(error)
      }
      this.server.once('error', onError)
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onError)
        const address = this.server.address()
        if (address && typeof address === 'object' && address.port) this.port = address.port
        this.logger(`reverse ws listening ws://${this.host}:${this.port}${this.path}`)
        resolve()
      })
    })
    return this
  }

  _upgrade(req, socket, head) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (this.token && tokenOf(req, url) !== this.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        '\r\n',
      ].join('\r\n'),
    )
    if (this.peer) this.peer.close(1000)
    const peer = new WsPeer(socket, {
      onMessage: (text) => this._message(text),
      onClose: () => this._peerClosed(peer),
      logger: this.logger,
    })
    this.peer = peer
    if (head?.length) peer._feed(head)
    this.onStatus({ connected: true, at: Date.now() })
    for (const waiter of this.waiters) waiter(peer)
    this.waiters.clear()
  }

  _peerClosed(peer) {
    if (this.peer !== peer) return
    this.peer = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('reverse ws disconnected'))
    }
    this.pending.clear()
    this.onStatus({ connected: false, at: Date.now(), code: 1006 })
  }

  _message(text) {
    this.stats.events += 1
    this.stats.lastEventAt = Date.now()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (payload?.echo && this.pending.has(String(payload.echo))) {
      const pending = this.pending.get(String(payload.echo))
      this.pending.delete(String(payload.echo))
      clearTimeout(pending.timer)
      if (payload.status === 'failed' || (payload.retcode != null && Number(payload.retcode) !== 0)) {
        pending.reject(new Error(payload.message ?? payload.wording ?? `action failed ${payload.retcode}`))
      } else {
        pending.resolve(payload)
      }
      return
    }
    if (payload?.self_id) this.selfId = String(payload.self_id)
    if (payload?.post_type) {
      this.stats.messages += 1
      this.onEvent(payload)
    }
  }

  waitForPeer(timeoutMs = 12000) {
    if (this.peer) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(done)
        reject(new Error('reverse ws client not connected'))
      }, Math.max(1000, Number(timeoutMs) || 12000))
      const done = (peer) => {
        clearTimeout(timer)
        resolve(peer)
      }
      this.waiters.add(done)
    })
  }

  call(action, params = {}, timeoutMs = 15000) {
    if (!this.peer) return Promise.reject(new Error('reverse ws client not connected'))
    this._seq += 1
    const echo = `bibao_${this._seq}_${randomUUID().slice(0, 8)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`reverse ws action timeout: ${action}`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(echo, { resolve, reject, timer })
      try {
        this.peer.send(JSON.stringify({ action, params, echo }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(echo)
        reject(error)
      }
    })
  }

  async loginInfo() {
    const payload = await this.call('get_login_info')
    const data = payload?.data ?? payload
    if (data?.user_id) {
      this.selfId = String(data.user_id)
      this.stats.selfId = this.selfId
    }
    return data
  }

  async groupList() {
    const payload = await this.call('get_group_list')
    return Array.isArray(payload?.data) ? payload.data : []
  }

  async sendPrivate(userId, text, imageFile = '') {
    const message = []
    if (text) message.push({ type: 'text', data: { text } })
    if (imageFile) message.push({ type: 'image', data: { file: imageFile } })
    const payload = await this.call('send_private_msg', { user_id: Number(userId) || userId, message })
    this.stats.sent += 1
    return payload?.data?.message_id ?? payload?.message_id ?? null
  }

  async sendGroup(groupId, text, imageFile = '') {
    const message = []
    if (text) message.push({ type: 'text', data: { text } })
    if (imageFile) message.push({ type: 'image', data: { file: imageFile } })
    const payload = await this.call('send_group_msg', { group_id: Number(groupId) || groupId, message })
    this.stats.sent += 1
    return payload?.data?.message_id ?? payload?.message_id ?? null
  }

  async deleteMessage(messageId) {
    await this.call('delete_msg', { message_id: messageId })
    this.stats.deleted += 1
    return true
  }

  connect() {
    // 与服务端模式兼容：监听已由 listen() 完成，client 连上来时自动可用
    return this.listen().catch(() => {})
  }

  close() {
    this.closed = true
    this.peer?.close(1000)
    this.peer = null
    try {
      this.server?.close()
    } catch {
      /* 已经关闭 */
    }
    this.server = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('reverse ws closed'))
    }
    this.pending.clear()
    for (const waiter of this.waiters) waiter(null)
    this.waiters.clear()
    this.onStatus({ connected: false, at: Date.now(), code: 1000 })
  }
}
