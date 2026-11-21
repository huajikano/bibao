/**
 * snowluma 传输层（Phase 2 的感官与嘴）。
 *
 * 这里只做协议转换：OneBot 11 事件 → 大脑能吃的帧；大脑的运动指令 → OneBot 动作。
 * 它不认识"比宝"，也不做任何注意力判断——那些属于 core/group.js 与 core/brain.js。
 *
 * 收：ws://127.0.0.1:3001（事件推送）
 * 发：http://127.0.0.1:3000/<action>（send_private_msg / send_group_msg / delete_msg）
 */

/**
 * WebSocket 鉴权兜底：Node 自带的 WebSocket 对自定义 header 支持并不统一，
 * 而 OneBot / snowluma 通常也认 `?access_token=`。两边都带上，避免
 * "HTTP 能发、WS 收不到事件"的半连接状态。
 */
export function wsUrlWithToken(url, token) {
  const raw = String(url ?? '')
  if (!raw || !token) return raw
  try {
    const parsed = new URL(raw)
    if (!parsed.searchParams.has('access_token')) parsed.searchParams.set('access_token', token)
    return parsed.toString()
  } catch {
    return raw
  }
}

function unescapeCq(value) {
  return value.replace(/&#91;|&#93;|&#44;|&amp;/g, entity => ({ '&#91;': '[', '&#93;': ']', '&#44;': ',', '&amp;': '&' })[entity])
}

function messageSegments(message) {
  if (Array.isArray(message)) return message
  if (typeof message !== 'string') return []
  const segments = []
  let offset = 0
  const addText = (text) => {
    if (text) segments.push({ type: 'text', data: { text: unescapeCq(text) } })
  }
  for (const code of message.matchAll(/\[CQ:([a-z_]+)(?:,([^\[\]]{0,8192}))?\]/g)) {
    addText(message.slice(offset, code.index))
    offset = code.index + code[0].length
    const data = Object.create(null)
    for (const pair of (code[2] ?? '').split(',')) {
      const equals = pair.indexOf('=')
      if (equals > 0) data[pair.slice(0, equals)] = unescapeCq(pair.slice(equals + 1))
    }
    segments.push({ type: code[1], data })
  }
  addText(message.slice(offset))
  return segments
}

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

  async call(action, params = {}, timeoutMs) {
    const response = await fetch(`${this.httpBase}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.httpToken ? { authorization: `Bearer ${this.httpToken}` } : {}),
      },
      body: JSON.stringify(params),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`snowluma ${action}: 非 JSON 响应（HTTP ${response.status}）`)
    }
    if (!response.ok || data?.status === 'failed' || (data?.retcode != null && Number(data.retcode) !== 0)) {
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
      this.socket = new WebSocket(wsUrlWithToken(this.wsUrl, this.wsToken), {
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

  /** Preserve the OneBot fields that distinguish custom emoji from photos. */
  static imagesOf(message) {
    if (!Array.isArray(message)) return []
    const images = []
    for (const segment of message) {
      if (!['image', 'mface'].includes(segment?.type)) continue
      const data = segment.data ?? {}
      if (data.type === 'flash') continue
      const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 64) : ''
      const emojiId = typeof data.emoji_id === 'string' && /^[a-f0-9]{32}$/i.test(data.emoji_id) ? data.emoji_id : ''
      const marketUrl = emojiId ? `https://gxh.vip.qq.com/club/item/parcel/item/${emojiId.slice(0, 2)}/${emojiId}/raw300.gif` : ''
      const url = [data.url, data.file, marketUrl].find((value) => typeof value === 'string' && value.length <= 4096 && /^https?:\/\//i.test(value)) ?? ''
      const fileId = [data.file_id, data.file].find((value) => typeof value === 'string' && /^[\w.+=-]{1,200}$/.test(value) && !value.includes('..')) ?? ''
      const marked = segment.type === 'mface' || Boolean(emojiId) || String(data.sub_type ?? data.subType) === '1' || /^\[(?:动画表情|自定义表情|表情包)\]$/.test(summary)
      images.push({ url, fileId, marked, summary })
      if (images.length >= 3) break
    }
    return images
  }

  static textOf(message) {
    if (typeof message === 'string') return message
    if (!Array.isArray(message)) return ''
    return message
      .map((segment) => {
        if (!segment || typeof segment !== 'object') return ''
        if (segment.type === 'text') return segment.data?.text ?? ''
        if (segment.type === 'at') return `@${segment.data?.qq ?? ''}`
        if (segment.type === 'face' || segment.type === 'mface') return '[表情]'
        if (segment.type === 'image') return '[图片]'
        if (segment.type === 'reply') return ''
        return ''
      })
      .join('')
  }

  /** 统一事件形状，供 Host 判断。 */
  static normalize(event, selfId) {
    if (!event || event.post_type !== 'message' || !['group', 'private'].includes(event.message_type)) return null
    const senderId = String(event.user_id ?? '')
    if (!senderId || senderId === String(selfId)) return null
    const senderName =
      event.sender?.card || event.sender?.nickname || event.sender?.name || senderId
    const message = messageSegments(event.message)
    const images = SnowlumaBridge.imagesOf(message)
    const text = SnowlumaBridge.textOf(message).trim()
    if (!text && images.length === 0) return null
    const group = event.message_type === 'group'
    if (group && !event.group_id) return null
    return {
      kind: group ? 'group' : 'private',
      groupId: group ? String(event.group_id ?? '') : '',
      groupName: '',
      senderId,
      senderName,
      text: text || (images.length ? '[图片]' : ''),
      images,
      atMe: group && message.some((segment) => segment?.type === 'at' && String(segment?.data?.qq ?? '') === String(selfId)),
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
