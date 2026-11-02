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
      interactions: Number(input.interactions ?? current?.interactions ?? 0),
      lastAt: current?.lastAt ?? null,
      defiances: current?.defiances ?? 0,
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

  adjust(id, delta = {}) {
    const relation = this.ensure(id)
    if (Number.isFinite(delta.intimacy)) relation.intimacy = clamp(relation.intimacy + delta.intimacy, -100, 100)
    if (Number.isFinite(delta.trust)) relation.trust = clamp(relation.trust + delta.trust, 0, 100)
    if (Number.isFinite(delta.powerFear)) relation.powerFear = clamp(relation.powerFear + delta.powerFear)
    if (delta.impression) relation.impression = delta.impression
    relation.interactions += 1
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
    const friendly = ranked.filter((item) => !item.tags.some((tag) => family.has(tag)))
    const pool = friendly.length ? friendly : ranked
    return pool.find((item) => item.intimacy >= 40) ?? pool[0]
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
