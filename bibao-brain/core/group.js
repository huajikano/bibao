/**
 * Phase 2 预演：感知防抖 + 鸡尾酒会三层注意力漏斗。
 *
 * 这里刻意不含任何 snowluma / QQ 协议代码——它只接收"已经被协议层剥好的
 * 群消息结构"，因此可以在没有 QQ 的情况下把注意力经济跑通、看清楚。
 * 真机挂载时，协议层只需把 GroupMessage 喂进 ingest()。
 */

import { clamp } from './constants.js'

export const LAYER_LABEL = { foveal: '焦点注视', peripheral: '余光监听', muted: '折叠免打扰' }

export const DEBOUNCE = { slidingMs: 3000, capMs: 8000 }

export class GroupAttentionFunnel {
  constructor({ social, interests = [], userName = '比宝' }) {
    this.social = social
    this.interests = interests
    this.userName = userName
    this.nicknames = ['比宝', userName, '知遥', '遥遥']
    this.groups = new Map()
    this.pending = new Map()
    this.log = []
    this.stats = { received: 0, escalated: 0, mutedIgnored: 0, debounced: 0, transfers: 0 }
    this.fovealId = null
    this.lastFovealAt = 0
  }

  addGroup({ id, name, memberCount = 40, layer = 'muted' }) {
    const group = {
      id: String(id),
      name,
      memberCount,
      layer,
      unread: 0,
      buffer: [],
      lastActivityAt: 0,
      lastEscalatedAt: 0,
    }
    this.groups.set(group.id, group)
    return group
  }

  get(id) {
    return this.groups.get(String(id))
  }

  layerOf(id) {
    return this.groups.get(String(id))?.layer ?? 'muted'
  }

  peripheralCount() {
    return [...this.groups.values()].filter((g) => g.layer === 'peripheral').length
  }

  /** 四大鸡尾酒会唤醒锚点。 */
  anchorsOf(message) {
    const hits = []
    const text = String(message.text ?? '')
    if (message.atMe) hits.push({ key: 'at-me', label: '@我 / 引用回复' })
    if (this.nicknames.some((name) => text.includes(name))) hits.push({ key: 'name', label: '提到我的名字' })
    if (this.social.isCloseFriend(message.senderId)) {
      const who = this.social.get(message.senderId)
      hits.push({ key: 'close-friend', label: `死党 ${who?.name} 发言` })
    }
    const interest = this.interests.find((word) => text.includes(word))
    if (interest) hits.push({ key: 'interest', label: `命中兴趣词「${interest}」` })
    return hits
  }

  /** 防抖：同一会话 3s 滑窗合并，最多拖到 8s。 */
  stage(message, now) {
    const key = `${message.groupId}:${message.senderId}`
    const existing = this.pending.get(key)
    if (!existing) {
      this.pending.set(key, { key, firstAt: now, lastAt: now, texts: [message.text], message })
      return { buffered: true, count: 1, dueAt: now + DEBOUNCE.slidingMs, reason: '防抖滑窗开启' }
    }
    const age = now - existing.firstAt
    if (age >= DEBOUNCE.capMs) {
      return { buffered: false, force: true, count: existing.texts.length, dueAt: now, reason: '已达 8s 上限，强制结算' }
    }
    existing.texts.push(message.text)
    existing.lastAt = now
    existing.message = { ...existing.message, text: existing.texts.join(' ') }
    this.stats.debounced += 1
    return {
      buffered: true,
      count: existing.texts.length,
      dueAt: existing.firstAt + DEBOUNCE.capMs,
      reason: `合并第 ${existing.texts.length} 条碎片`,
    }
  }

  /** 取出已经到期（静默 3s 或触顶 8s）的会话帧。 */
  flushDue(now) {
    const ready = []
    for (const [key, frame] of [...this.pending.entries()]) {
      if (now - frame.lastAt >= DEBOUNCE.slidingMs || now - frame.firstAt >= DEBOUNCE.capMs) {
        this.pending.delete(key)
        ready.push(frame)
      }
    }
    return ready
  }

  flushAll() {
    const ready = [...this.pending.values()]
    this.pending.clear()
    return ready
  }

  /** 无论是否到点，直接取走某个会话的缓冲帧（定时器结算用）。 */
  take(key) {
    const frame = this.pending.get(key)
    if (!frame) return null
    this.pending.delete(key)
    return frame
  }

  focus(id, now) {
    const group = this.get(id)
    if (!group) return null
    const previous = this.fovealId
    if (previous && previous !== group.id) {
      const old = this.get(previous)
      if (old && old.layer === 'foveal') old.layer = 'peripheral'
    }
    group.layer = 'foveal'
    this.fovealId = group.id
    this.lastFovealAt = now
    group.lastEscalatedAt = now
    return { previous, current: group.id }
  }

  demote(id, to = 'peripheral') {
    const group = this.get(id)
    if (!group) return
    group.layer = to
    if (this.fovealId === group.id) this.fovealId = null
  }

  /** 吞进一条群消息，返回它是否值得占用大脑。 */
  ingest(message, { now = Date.now(), energy = 60 } = {}) {
    this.stats.received += 1
    const group = this.get(message.groupId)
    if (!group) return { decision: 'dropped', reason: '未知群', layer: 'muted', anchors: [] }

    group.unread += 1
    group.lastActivityAt = now
    group.buffer.push({
      at: now,
      senderId: String(message.senderId ?? ''),
      senderName: message.senderName ?? message.senderId ?? '',
      text: message.text,
      atMe: Boolean(message.atMe),
    })
    if (group.buffer.length > 8) group.buffer = group.buffer.slice(-8)

    const anchors = this.anchorsOf(message)
    const layer = group.layer

    if (layer === 'foveal') {
      // 焦点群：全量送丘脑（仍然要防抖，不能每条都调 LLM）
      this.lastFovealAt = now
      const staged = this.stage(message, now)
      return {
        decision: 'foveal-buffer',
        layer,
        anchors,
        debounce: staged,
        toThalamus: false,
        reason: '焦点群消息进入防抖缓冲，合并后再送丘脑',
      }
    }

    if (layer === 'peripheral') {
      if (!anchors.length) {
        this.stats.mutedIgnored += 1
        return {
          decision: 'peripheral-scan',
          layer,
          anchors,
          toThalamus: false,
          reason: '余光群无唤醒锚点，本地规则扫过即丢弃（不调用 LLM）',
        }
      }
      this.focus(group.id, now)
      const staged = this.stage(message, now)
      return {
        decision: 'escalate-foveal',
        layer: 'foveal',
        previousLayer: layer,
        anchors,
        debounce: staged,
        toThalamus: true,
        reason: `命中 ${anchors.map((a) => a.label).join('、')}，提拔为焦点群并拉取最近 ${group.buffer.length} 条背景帧`,
        context: group.buffer.slice(-8),
      }
    }

    // 免打扰群：只有被 @ 且还活着才延迟查看
    const onlyMention = anchors.some((a) => a.key === 'at-me')
    if (!onlyMention) {
      this.stats.mutedIgnored += 1
      return {
        decision: 'muted-ignore',
        layer,
        anchors,
        toThalamus: false,
        reason: '折叠免打扰群，普通消息直接忽略',
      }
    }
    if (energy <= 50) {
      this.stats.mutedIgnored += 1
      return {
        decision: 'muted-tired',
        layer,
        anchors,
        toThalamus: false,
        reason: `被 @ 了但精力只有 ${Math.round(energy)}%，装作没看见`,
      }
    }
    const delaySec = 30 + Math.round((1 - clamp(energy / 100)) * 150)
    this.stage(message, now)
    return {
      decision: 'muted-delayed',
      layer,
      anchors,
      toThalamus: false,
      delayedSec: delaySec,
      reason: `被 @ 且精力尚可，${delaySec}s 后才懒洋洋地点开`,
    }
  }

  /** 焦点群 5 分钟无交互 → 自动退化为余光。 */
  tick(now) {
    if (this.fovealId) {
      const group = this.get(this.fovealId)
      if (group && now - this.lastFovealAt > 5 * 60_000) {
        this.demote(group.id, 'peripheral')
        return { demoted: group.id, reason: '焦点群 5 分钟无交互，退回余光' }
      }
    }
    if (this.peripheralCount() > 3) {
      const extras = [...this.groups.values()]
        .filter((g) => g.layer === 'peripheral')
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
      for (const extra of extras.slice(0, extras.length - 3)) {
        extra.layer = 'muted'
      }
      return { trimmed: extras.slice(0, extras.length - 3).map((g) => g.id) }
    }
    return null
  }

  record(entry) {
    this.log.push({ at: Date.now(), ...entry })
    if (this.log.length > 60) this.log = this.log.slice(-60)
  }

  snapshot() {
    return {
      fovealId: this.fovealId,
      groups: [...this.groups.values()]
        .sort((a, b) => Number(b.layer === 'foveal') - Number(a.layer === 'foveal') || b.lastActivityAt - a.lastActivityAt)
        .map((group) => ({
          id: group.id,
          name: group.name,
          layer: group.layer,
          layerLabel: LAYER_LABEL[group.layer],
          memberCount: group.memberCount,
          unread: group.unread,
          buffer: group.buffer.slice(-8),
          lastActivityAt: group.lastActivityAt,
        })),
      pending: [...this.pending.values()].map((frame) => ({
        key: frame.key,
        count: frame.texts.length,
        text: frame.message.text,
        firstAt: frame.firstAt,
      })),
      log: this.log.slice(-20),
      stats: { ...this.stats },
      limits: { foveal: 1, peripheral: 3, debounceMs: DEBOUNCE },
    }
  }
}

export function defaultGroups() {
  return [
    { id: 'g_family', name: '相亲相爱一家人', memberCount: 12, layer: 'muted' },
    { id: 'g_class', name: '22届毕业摸鱼群', memberCount: 186, layer: 'peripheral' },
    { id: 'g_guild', name: '深夜游戏搭子', memberCount: 34, layer: 'peripheral' },
    { id: 'g_work', name: '新媒体部（正经工作）', memberCount: 9, layer: 'muted' },
    { id: 'g_cat', name: '猫咪领养互助', memberCount: 421, layer: 'peripheral' },
  ]
}
