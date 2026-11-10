/**
 * 社会记忆：亲密度 / 信任 / 权力恐惧，以及"死党排序"（跨通道吐槽用）。
 */

import { clamp } from './constants.js'

export class SocialMemory {
  constructor(relations = []) {
    this.relations = new Map()
    for (const relation of relations) this.upsert(relation)
  }

  upsert(input = {}) {
    // 档案里的关系可能只有名字：用名字当 id，不要因此让整个大脑起不来
    const id = String(input.qq ?? input.id ?? input.name ?? '')
    if (!id) throw new Error('relation needs qq id')
    const current = this.relations.get(id)
    const next = {
      id,
      name: input.name ?? current?.name ?? id,
      intimacy: clamp(Number(input.intimacy ?? current?.intimacy ?? 0), -100, 100),
      trust: clamp(Number(input.trust ?? current?.trust ?? 35), 0, 100),
      powerFear: clamp(Number(input.powerFear ?? current?.powerFear ?? 0)),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 6) : (current?.tags ?? []),
      impression: input.impression ?? current?.impression ?? '',
      friend: Boolean(input.friend ?? current?.friend),
      // 好友由她自己管：互动够了自动记住；手动添加只是兼容旧存档
      friendSource: input.friendSource ?? current?.friendSource ?? (input.friend ? 'manual' : null),
      friendAt: input.friendAt ?? current?.friendAt ?? null,
      manualAt: input.manualAt ?? current?.manualAt ?? 0,
      interactions: Number(input.interactions ?? current?.interactions ?? 0),
      lastAt: current?.lastAt ?? null,
      defiances: current?.defiances ?? 0,
      boundaryHits: Number(input.boundaryHits ?? current?.boundaryHits ?? 0),
      lastBoundaryAt: input.lastBoundaryAt ?? current?.lastBoundaryAt ?? null,
      recent: Array.isArray(input.recent) ? input.recent.slice(-6) : current?.recent ?? [],
    }
    this.relations.set(id, next)
    return next
  }

  ensure(id, name) {
    const key = String(id)
    if (!this.relations.has(key)) this.upsert({ qq: key, name: name || key, intimacy: 0, trust: 35 })
    return this.relations.get(key)
  }

  get(id) {
    return this.relations.get(String(id))
  }

  require(id) {
    const key = String(id)
    const found = this.relations.get(key)
    if (!found) throw new Error(`unknown relation: ${key}`)
    return found
  }

  adjust(id, delta = {}, { count = true, boundaryHit = false } = {}) {
    const relation = this.ensure(id)
    if (Number.isFinite(delta.intimacy)) relation.intimacy = clamp(relation.intimacy + delta.intimacy, -100, 100)
    if (Number.isFinite(delta.trust)) relation.trust = clamp(relation.trust + delta.trust, 0, 100)
    if (Number.isFinite(delta.powerFear)) relation.powerFear = clamp(relation.powerFear + delta.powerFear)
    if (delta.impression) relation.impression = delta.impression
    // 越界会累积；隔一天没再犯，才慢慢消掉一笔
    if (boundaryHit) {
      relation.boundaryHits = (relation.boundaryHits ?? 0) + 1
      relation.lastBoundaryAt = Date.now()
    } else if (count && relation.boundaryHits > 0) {
      const last = Number(relation.lastBoundaryAt ?? 0)
      if (!last || Date.now() - last > 24 * 60 * 60 * 1000) {
        relation.boundaryHits = Math.max(0, relation.boundaryHits - 1)
        relation.lastBoundaryAt = Date.now()
      }
    }
    // 一轮对话只该算一条互动：同轮内的 LLM 微调、初始印象、防御扣分不重复计数
    if (count) relation.interactions += 1
    // 不用手动加好友：聊够 10 条，她自己把这个人记进好友面板。
    if (!relation.friend && relation.interactions >= 10) {
      relation.friend = true
      relation.friendSource = 'self'
      relation.friendAt = Date.now()
    }
    return relation
  }

  /** 亲密度降序，用于跨通道私聊吐槽的接收人检索。 */
  ranked({ exclude = [] } = {}) {
    const skip = new Set(exclude.map(String))
    return [...this.relations.values()]
      .filter((r) => !skip.has(r.id))
      .sort((a, b) => b.intimacy - a.intimacy || b.trust - a.trust || a.id.localeCompare(b.id))
  }

  bestGossipTarget(exclude = []) {
    const ranked = this.ranked({ exclude })
    const family = new Set(['母亲', '父亲', '爸妈', '家人', '亲戚', '长辈'])
    return (
      ranked.find(
        (item) =>
          !item.tags.some((tag) => family.has(tag)) &&
          (item.friend || item.intimacy >= 50) &&
          item.trust >= 45,
      ) ?? null
    )
  }

  /** 群聊唤醒锚点③：群内是否有亲密度 > 60 的死党在说话。 */
  isCloseFriend(id) {
    const relation = this.get(id)
    return Boolean(relation && relation.intimacy > 60)
  }

  /** 短时对话缓冲：不是海马体，只是刚才说到哪。 */
  remember(id, entry, limit = 6) {
    const relation = this.ensure(id)
    relation.recent = relation.recent ?? []
    relation.recent.push({
      at: entry.at ?? Date.now(),
      role: entry.role ?? "user",
      text: String(entry.text ?? "").slice(0, 80),
    })
    if (relation.recent.length > limit) relation.recent = relation.recent.slice(-limit)
    return relation
  }

  /** 手动校准：直接写值，但保留自动增减的余地（之后仍会随聊天漂移）。 */
  setRelation(id, patch = {}) {
    const relation = this.ensure(String(id))
    if (Number.isFinite(Number(patch.intimacy))) relation.intimacy = clamp(Number(patch.intimacy), -100, 100)
    if (Number.isFinite(Number(patch.trust))) relation.trust = clamp(Number(patch.trust), 0, 100)
    if (Number.isFinite(Number(patch.powerFear))) relation.powerFear = clamp(Number(patch.powerFear), 0, 100)
    if (typeof patch.impression === 'string') relation.impression = patch.impression.slice(0, 80)
    relation.manualAt = Date.now()
    return relation
  }

  snapshot() {
    return this.ranked().map((r) => ({ ...r }))
  }

  toJSON() {
    return [...this.relations.values()].map((r) => ({ ...r }))
  }

  static fromJSON(json = []) {
    return new SocialMemory(json)
  }
}
