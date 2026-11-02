/**
 * snowluma 传输层（Phase 2 的感官与嘴）。
 *
 * 这里只做协议转换：OneBot 11 事件 → 大脑能吃的帧；大脑的运动指令 → OneBot 动作。
 * 它不认识"比宝"，也不做任何注意力判断——那些属于 core/group.js 与 core/brain.js。
 *
 * 收：ws://127.0.0.1:3001（事件推送）
 * 发：http://127.0.0.1:3000/<action>（send_private_msg / send_group_msg / delete_msg）
 */

export class SnowlumaBridge {
  constructor({
    httpBase = 'http://127.0.0.1:3000',
    httpToken = '',
    wsUrl = 'ws://127.0.0.1:3001/',
    wsToken = '',
    selfId = '',
    onEvent = () => {},
    onStatus = () => {},
    logger = () => {},
  } = {}) {
    this.httpBase = httpBase.replace(/\/$/, '')
    this.httpToken = httpToken
    this.wsUrl = wsUrl
    this.wsToken = wsToken
    this.selfId = String(selfId)
    this.onEvent = onEvent
    this.onStatus = onStatus
    this.logger = logger
    this.socket = null
    this.retry = 0
    this.closed = false
    this.timer = null
    this.stats = { events: 0, messages: 0, sent: 0, deleted: 0, errors: 0, lastEventAt: 0 }
  }

  async call(action, params = {}) {
    const response = await fetch(`${this.httpBase}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.httpToken ? { authorization: `Bearer ${this.httpToken}` } : {}),
      },
      body: JSON.stringify(params),
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`snowluma ${action}: 非 JSON 响应（HTTP ${response.status}）`)
    }
    if (!response.ok || (data && data.status === 'failed')) {
      throw new Error(`snowluma ${action} 失败：${data?.message ?? data?.wording ?? response.status}`)
    }
    return data
  }

  async loginInfo() {
    const data = await this.call('get_login_info')
    return data?.data ?? null
  }

  async groupList() {
    const data = await this.call('get_group_list')
    return Array.isArray(data?.data) ? data.data : []
  }

  connect() {
    this.closed = false
    this._open()
  }

  _open() {
    if (this.closed) return
    try {
      this.socket = new WebSocket(this.wsUrl, {
        headers: this.wsToken ? { Authorization: `Bearer ${this.wsToken}` } : {},
      })
    } catch (error) {
      this._scheduleReconnect(error)
      return
    }

    this.socket.addEventListener('open', () => {
      this.retry = 0
      this.onStatus({ connected: true, at: Date.now() })
      this.logger('snowluma ws connected')
    })

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      this.stats.events += 1
      this.stats.lastEventAt = Date.now()
      let payload = null
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      try {
        this.onEvent(payload)
      } catch (error) {
        this.stats.errors += 1
        this.logger(`event handler failed: ${error?.message ?? error}`)
      }
    })

    this.socket.addEventListener('close', (event) => {
      this.onStatus({ connected: false, at: Date.now(), code: event.code })
      this._scheduleReconnect(new Error(`ws closed ${event.code}`))
    })

    this.socket.addEventListener('error', () => {
      // close 事件随后到达，重连在那里统一处理
    })
  }

  _scheduleReconnect(error) {
    if (this.closed) return
    this.retry += 1
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, this.retry))
    this.logger(`snowluma reconnect in ${delay}ms (${error?.message ?? ''})`)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this._open()
    }, delay)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.socket?.close()
    } catch {
      /* 已经关了 */
    }
    this.socket = null
  }

  /** OneBot 消息段（array 格式）→ 纯文本。 */
  /** 取出所有图片段的 url（OneBot 里可能是 http、file:// 或本地路径）。 */
  static imagesOf(message) {
    if (!Array.isArray(message)) return []
    return message
      .filter((segment) => segment?.type === 'image')
      .map((segment) => String(segment?.data?.url ?? segment?.data?.file ?? ''))
      .filter((url) => url && (url.startsWith('http') || url.startsWith('file')))
      .slice(0, 3)
  }

  static textOf(message) {
    if (typeof message === 'string') return message
    if (!Array.isArray(message)) return ''
    return message
      .map((segment) => {
        if (!segment || typeof segment !== 'object') return ''
        if (segment.type === 'text') return segment.data?.text ?? ''
        if (segment.type === 'at') return `@${segment.data?.qq ?? ''}`
        if (segment.type === 'face') return '[表情]'
        if (segment.type === 'image') return '[图片]'
        if (segment.type === 'reply') return ''
        return ''
      })
      .join('')
  }

  /** 统一事件形状，供 Host 判断。 */
  static normalize(event, selfId) {
    if (!event || event.post_type !== 'message') return null
    const senderId = String(event.user_id ?? '')
    if (!senderId || senderId === String(selfId)) return null
    const senderName =
      event.sender?.card || event.sender?.nickname || event.sender?.name || senderId
    const images = SnowlumaBridge.imagesOf(event.message)
    const text = SnowlumaBridge.textOf(event.message).trim()
    // 只有图片、没有文字的消息也要进来：她要能看见
    if (!text && images.length === 0) return null
    const group = event.message_type === 'group'
    return {
      kind: group ? 'group' : 'private',
      groupId: group ? String(event.group_id ?? '') : '',
      groupName: '',
      senderId,
      senderName,
      text: text || (images.length ? '[图片]' : ''),
      images,
      atMe: group && Array.isArray(event.message)
        ? event.message.some((segment) => segment?.type === 'at' && String(segment?.data?.qq ?? '') === String(selfId))
        : false,
      messageId: event.message_id,
      at: Number(event.time ?? 0) * 1000 || Date.now(),
    }
  }

  async sendPrivate(userId, text, imageFile = '') {
    const message = []
    if (text) message.push({ type: 'text', data: { text } })
    if (imageFile) message.push({ type: 'image', data: { file: imageFile } })
    const data = await this.call('send_private_msg', {
      user_id: Number(userId) || userId,
      message,
    })
    this.stats.sent += 1
    return data?.data?.message_id ?? data?.message_id ?? null
  }

  async sendGroup(groupId, text, imageFile = '') {
    const message = []
    if (text) message.push({ type: 'text', data: { text } })
    if (imageFile) message.push({ type: 'image', data: { file: imageFile } })
    const data = await this.call('send_group_msg', {
      group_id: Number(groupId) || groupId,
      message,
    })
    this.stats.sent += 1
    return data?.data?.message_id ?? data?.message_id ?? null
  }

  async deleteMessage(messageId) {
    await this.call('delete_msg', { message_id: messageId })
    this.stats.deleted += 1
    return true
  }
}
