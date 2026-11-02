/**
 * 对话线程：人不是每句都从零开始，也不是每句都记得。
 *
 * 这里只维护很少的"还没聊完的事"：
 *  - 对方问过但还没被回答的问题；
 *  - 答应过、约好、提到"下次/明天/回头"的事；
 *  - 最近还热着的话题。
 *
 * 线程会过期（默认 2 天），每个对象最多保留 3 条，避免把聊天变成查账。
 * 它不替代记忆：线程是"刚才说到哪"，不是"发生过什么"。
 */

import { DAY_MS } from './constants.js'

const MAX_OPEN_PER_ENTITY = 3
const MAX_TOTAL = 40
const OPEN_TTL = 2 * DAY_MS
const STOP = new Set(['的', '了', '是', '我', '你', '他', '她', '在', '有', '和', '就', '也', '都', '不', '很', '这', '那', '啊', '吧', '呢', '吗'])

function hash(text) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function grams(text) {
  const clean = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const set = new Set()
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2))
  return set
}

function overlap(a, b) {
  const left = grams(a)
  const right = grams(b)
  if (!left.size || !right.size) return 0
  let hit = 0
  for (const gram of left) if (right.has(gram)) hit += 1
  return hit / Math.min(left.size, right.size)
}

function cleanText(text, max = 60) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function topicOf(text) {
  const clean = String(text ?? '')
    .replace(/@\S+/g, '')
    .replace(/[，。！？!?、,.~…：:；;“”"'（）()\[\]【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  const parts = clean.split(' ').filter((part) => part.length >= 2 && !STOP.has(part))
  return (parts.slice(0, 3).join(' ') || clean).slice(0, 18)
}

function looksUnresolved(text) {
  const raw = String(text ?? '')
  return /[?？]|吗|呢|怎么|为什么|啥|什么|答应|说好|下次|明天|回头|记得|别忘了|等你|几点|多久/.test(raw)
}

function isSynthetic(text) {
  return /^[（(]/.test(String(text ?? '').trim())
}

export class ThreadMemory {
  constructor(state = {}) {
    this.threads = Array.isArray(state.threads)
      ? state.threads
          .filter((item) => item && item.entityId && item.topic)
          .map((item) => ({
            id: String(item.id ?? `thread_${hash(`${item.entityId}:${item.topic}:${item.openedAt ?? 0}`).toString(16)}`),
            entityId: String(item.entityId),
            topic: cleanText(item.topic, 24),
            status: item.status === 'closed' ? 'closed' : 'open',
            openedAt: Number(item.openedAt ?? 0),
            lastAt: Number(item.lastAt ?? item.openedAt ?? 0),
            turns: Math.max(1, Number(item.turns ?? 1)),
            lastText: cleanText(item.lastText ?? '', 60),
            unresolved: item.unresolved ? cleanText(item.unresolved, 60) : null,
            unresolvedAt: Number(item.unresolvedAt ?? 0) || null,
            awaitingReply: Boolean(item.awaitingReply),
            askedAt: Number(item.askedAt ?? 0) || null,
          }))
          .slice(-MAX_TOTAL)
      : []
  }

  /** 对方说了一句：接上已有线程，或开一条新的。 */
  observe({ entityId, text, at = Date.now() } = {}) {
    const clean = cleanText(text, 80)
    if (!entityId || !clean || isSynthetic(clean)) return null
    const topic = topicOf(clean)
    if (!topic) return null
    const open = this.threads.filter((item) => item.entityId === String(entityId) && item.status === 'open')
    let hit = open
      .map((item) => ({ item, score: overlap(item.topic, topic) + overlap(item.lastText, clean) * 0.5 }))
      .sort((a, b) => b.score - a.score)[0]
    if (hit && hit.score < 0.25) hit = null
    if (hit) {
      const item = hit.item
      item.lastAt = at
      item.turns += 1
      item.lastText = clean
      if (looksUnresolved(clean)) {
        item.unresolved = clean
        item.unresolvedAt = at
      }
      item.awaitingReply = false
      return item
    }
    const thread = {
      id: `thread_${hash(`${entityId}:${topic}:${at}`).toString(16)}`,
      entityId: String(entityId),
      topic,
      status: 'open',
      openedAt: at,
      lastAt: at,
      turns: 1,
      lastText: clean,
      unresolved: looksUnresolved(clean) ? clean : null,
      unresolvedAt: looksUnresolved(clean) ? at : null,
      awaitingReply: false,
      askedAt: null,
    }
    this.threads.push(thread)
    this._trimEntity(entityId)
    this._trimTotal()
    return thread
  }

  /** 她回了一句：如果里面有问句，线程进入"等他回答"。 */
  observeSelf({ entityId, text, at = Date.now() } = {}) {
    const clean = cleanText(text, 120)
    if (!entityId || !clean) return null
    const open = this.threads
      .filter((item) => item.entityId === String(entityId) && item.status === 'open')
      .sort((a, b) => b.lastAt - a.lastAt)[0]
    if (!open) return null
    open.lastAt = Math.max(open.lastAt, at)
    if (/[?？]|吗|呢|怎么|为什么|啥|什么/.test(clean)) {
      open.awaitingReply = true
      open.askedAt = at
      if (!open.unresolved) {
        open.unresolved = clean
        open.unresolvedAt = at
      }
    }
    return open
  }

  /** 对方说"算了/没事了"时，主动放下这条线。 */
  close(entityId, topic = '') {
    let closed = 0
    for (const item of this.threads) {
      if (item.entityId !== String(entityId) || item.status !== 'open') continue
      if (topic && overlap(item.topic, topic) < 0.2) continue
      item.status = 'closed'
      closed += 1
    }
    return closed
  }

  openFor(entityId, now = Date.now()) {
    this._expire(now)
    return this.threads
      .filter((item) => item.entityId === String(entityId) && item.status === 'open' && now - item.lastAt < OPEN_TTL)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 2)
  }

  /** 给提示词的 1-2 行；不含"你上次说过"这种审讯式复述。 */
  promptLines(entityId, now = Date.now()) {
    return this.openFor(entityId, now).map((item) => ({
      topic: item.topic,
      text: item.unresolved ?? item.lastText,
      unresolved: Boolean(item.unresolved),
      awaitingReply: item.awaitingReply,
      turns: item.turns,
      lastAt: item.lastAt,
    }))
  }

  snapshot(now = Date.now()) {
    this._expire(now)
    return this.threads
      .filter((item) => item.status === 'open')
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 8)
      .map((item) => ({
        entityId: item.entityId,
        topic: item.topic,
        turns: item.turns,
        unresolved: Boolean(item.unresolved),
        awaitingReply: item.awaitingReply,
        lastAt: item.lastAt,
      }))
  }

  _expire(now) {
    for (const item of this.threads) {
      if (item.status !== 'open') continue
      if (now - item.lastAt > OPEN_TTL) item.status = 'closed'
    }
    this.threads = this.threads.filter((item) => item.status === 'open' || now - item.lastAt < 7 * DAY_MS)
  }

  _trimEntity(entityId) {
    const open = this.threads
      .filter((item) => item.entityId === String(entityId) && item.status === 'open')
      .sort((a, b) => b.lastAt - a.lastAt)
    for (const item of open.slice(MAX_OPEN_PER_ENTITY)) item.status = 'closed'
  }

  _trimTotal() {
    if (this.threads.length <= MAX_TOTAL) return
    this.threads.sort((a, b) => b.lastAt - a.lastAt)
    this.threads = this.threads.slice(0, MAX_TOTAL)
  }

  toJSON() {
    return { threads: this.threads.slice(-MAX_TOTAL) }
  }

  static fromJSON(json = {}) {
    return new ThreadMemory(json ?? {})
  }
}

export { MAX_OPEN_PER_ENTITY, OPEN_TTL }
