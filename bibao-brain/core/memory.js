/**
 * 互补学习系统（CLS）+ 艾宾浩斯遗忘 + 预测误差门控再巩固。
 *
 * 快系统（海马体）：白天只在 Arousal > 0.35 或 PE > 0.4 时写入情景快照。
 * 慢系统（新皮层）：只在凌晨睡眠交叉回放时，对重复出现的模式做极慢更新。
 * 三态分层：显意识可完整召回；潜意识永久保留但不交出叙事，只外溢情绪偏置；
 * 修剪层才允许归档销毁。
 */

import { PARAMS, DAY_MS, clamp, eta } from './constants.js'
import { embed, encodeVector, decodeVector, cosine } from './embed.js'
import { uid } from './rng.js'

const PRIMARY_TAGS = ['背叛', '孤立', '羞耻', '被否定', '被比较', '离别', '依靠', '成就', '温柔', '共谋']

export class MemorySystem {
  constructor({ rng, episodes = [], semantics = [], dreams = [], archived = 0, stabilityScale = 1, store = null } = {}) {
    this.rng = rng
    this.stabilityScale = stabilityScale
    this.store = store
    this.episodes = episodes
    this.semantics = semantics
    this.dreams = dreams
    this.archivedCount = archived
  }

  /** R(Δt) = exp(-Δt_days / S)，从上次提取/写入锚点起算。 */
  stabilityOf(node) {
    // 调低「记忆力」时整体压缩稳定性：拉满 = 原样
    const scale = Number.isFinite(this.stabilityScale) ? this.stabilityScale : 1
    return Math.max(0.0004, node.sDays * scale)
  }

  extractability(node, now) {
    const days = Math.max(0, now - (node.rUpdatedAt ?? node.at)) / DAY_MS
    const r = Math.exp(-days / this.stabilityOf(node))
    // 婴儿期遗忘症：β_age=0.04 让这些记忆永远回不到显意识层，
    // 但也不允许被彻底抹掉——它们只能以"莫名烦躁"的方式外溢。
    if (node.infantile) return Math.max(r, PARAMS.subconsciousTier + 0.006)
    return r
  }

  tier(node, now) {
    const r = this.extractability(node, now)
    if (r >= PARAMS.consciousTier) return 'conscious'
    if (r >= PARAMS.subconsciousTier) return 'subconscious'
    return 'pruning'
  }

  /**
   * 快系统写入。返回 null 表示这次刺激没有达到海马体写入阈值
   * （也就是"被打断后忘词"的物理基础：从未落库）。
   */
  write(input) {
    const { now, age, arousal, pe } = input
    if (!(input.force || input.relational || arousal > PARAMS.writeArousal || pe > PARAMS.writePE)) return null
    const valence = clamp(Number(input.valence ?? 0), -1, 1)
    const node = {
      id: input.id ?? uid('ep', this.rng),
      at: now,
      createdAt: now,
      rUpdatedAt: now,
      entityId: input.entityId ?? null,
      entityName: input.entityName ?? null,
      title: input.title ?? '一次交互',
      narrative: input.narrative ?? '',
      valence,
      arousal: clamp(Number(arousal)),
      salience: clamp(Number(input.salience ?? 0.5)),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 5) : [],
      schemaHints: input.schemaHints ?? {},
      pe: Number(pe ?? 0),
      source: input.source ?? 'chat',
      infantile: Boolean(input.infantile),
      recalled: false,
      recalls: 0,
      distortions: 0,
      lastRecallAt: null,
      // S0 = S_base · (1 + 8·|Valence|·Arousal) · β_age
      sDays:
        PARAMS.stabilityBaseDays *
        (1 + PARAMS.valenceStabilityGain * Math.abs(valence) * clamp(Number(arousal))) *
        (input.betaAge ?? 1),
    }
    // 倒摄干扰：同一个人、同一次标签的旧记忆会被新记忆压下去一点
    for (const other of this.episodes) {
      if (other.entityId && other.entityId === node.entityId && other.tags.some((tag) => node.tags.includes(tag))) {
        other.sDays = Math.max(0.05, other.sDays * 0.9)
        this.store?.upsertEpisode(other)
      }
    }
    node.vec = encodeVector(embed(`${node.title} ${node.narrative} ${(node.tags ?? []).join(' ')}`))
    this.episodes.push(node)
    this.store?.upsertEpisode(node)
    // 有持久层就不再按 900 条硬截断：归档交给 SQLite，热层只按需裁剪
    if (!this.store) this.trim()
    return node
  }

  trim(limit = 900) {
    if (this.episodes.length <= limit) return
    // 只按"最不容易再被想起"的顺序淘汰，绝不删除潜意识层（由修剪层规则决定）
    this.episodes.sort((a, b) => a.at - b.at)
    this.episodes = this.episodes.slice(this.episodes.length - limit)
  }

  /** 潜意识外溢：忘了具体哪天，但看到这个人/话题就莫名烦躁或亲切。 */
  biasFor({ entityId = null, tags = [] } = {}, now) {
    let bias = 0
    for (const node of this.episodes) {
      const r = this.extractability(node, now)
      if (r >= PARAMS.consciousTier || r < PARAMS.subconsciousTier) continue
      const sameEntity = entityId && node.entityId === entityId
      const overlap = tags.some((tag) => node.tags.includes(tag))
      if (!sameEntity && !overlap) continue
      bias += node.valence * r * (sameEntity ? 1.4 : 0.6)
    }
    return clamp(bias * 0.8, -0.65, 0.65)
  }

  /** 显式回忆：三态分层 + 蛋白质重塑门控。 */
  recall(nodeId, { now, pe = 0, moodNow = 0, force = false } = {}) {
    const node = this.episodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, reason: 'not-found' }
    const rBefore = this.extractability(node, now)
    const tier = this.tier(node, now)
    if (tier !== 'conscious' && !force) {
      return {
        ok: false,
        reason: 'submerged',
        tier,
        r: Number(rBefore.toFixed(3)),
        bias: Number((node.valence * rBefore).toFixed(3)),
        message: '具体的情节已经沉下去了，只剩下一点说不清的情绪。',
      }
    }

    const valenceBefore = node.valence
    const narrativeBefore = node.narrative
    // 再巩固：S ← S·(1 + 0.6·R)，R ← 1.0
    node.sDays = node.sDays * (1 + PARAMS.reconsolidationGain * rBefore)
    node.rUpdatedAt = now
    node.recalled = true
    node.recalls += 1
    node.lastRecallAt = now
    this.store?.upsertEpisode(node)

    const gated = pe > PARAMS.reconsolidationGatePE || Math.abs(moodNow) > PARAMS.reconsolidationGateMood
    if (gated) {
      node.valence = clamp(0.8 * node.valence + 0.2 * moodNow, -1, 1)
      node.narrative = distort(node.narrative, moodNow, node.title)
      node.distortions += 1
    }

    return {
      ok: true,
      id: node.id,
      tier,
      rBefore: Number(rBefore.toFixed(3)),
      stabilityDays: Number(node.sDays.toFixed(2)),
      gated,
      valenceBefore: Number(valenceBefore.toFixed(3)),
      valenceAfter: Number(node.valence.toFixed(3)),
      narrativeBefore,
      narrativeAfter: node.narrative,
      distorted: gated,
    }
  }

  /** 按话题/对象检索显意识层；潜意识层只贡献偏置，不交出文本。 */
  retrieve({ now, entityId = null, query = '', tags = [], limit = 4, exclude = null, mood = 0 }) {
    const queryVector = query ? embed(query) : null
    const tokens = tokenize(query)
    const scored = []
    for (const node of this.episodes) {
      if (exclude && node.id === exclude) continue
      const r = this.extractability(node, now)
      if (r < PARAMS.consciousTier) continue
      let score = r * 0.5 + node.salience * 0.25
      if (query) {
        if (!node.vec) node.vec = encodeVector(embed(`${node.title} ${node.narrative}`))
        const sim = cosine(queryVector, decodeVector(node.vec))
        if (sim > 0) score += sim * 0.55
      }
      // 情绪一致回忆：心情差时更容易想起糟心事，反之亦然
      score += 0.18 * mood * node.valence
      if (entityId && node.entityId === entityId) score += 0.35
      if (tokens.length) {
        const haystack = `${node.title} ${node.narrative} ${node.tags.join(' ')}`
        const hits = tokens.filter((token) => haystack.includes(token)).length
        if (hits) score += hits * 0.12
      }
      for (const tag of tags) if (node.tags.includes(tag)) score += 0.08
      scored.push({ node, r, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(({ node, r }) => ({
      id: node.id,
      entityId: node.entityId ?? null,
      title: node.title,
      narrative: node.narrative,
      valence: Number(node.valence.toFixed(3)),
      arousal: Number(node.arousal.toFixed(3)),
      sDays: Number(node.sDays.toFixed(2)),
      r: Number(r.toFixed(3)),
      at: node.at,
      tags: node.tags,
    }))
  }

  /** 睡眠交叉回放：修剪、语义化、极慢的新皮层更新、造梦。 */
  consolidate({ now, age = 22, mood = 0 } = {}) {
    const pruned = []
    const kept = []
    // 记忆力被调低时不真删：只是沉到看不见的地方，调回去还能捞出来
    const allowPrune = (this.stabilityScale ?? 1) >= 0.5
    for (const node of this.episodes) {
      const tier = this.tier(node, now)
      if (allowPrune && tier === 'pruning' && Math.abs(node.valence) < PARAMS.pruneValence) {
        // 软删除：热层移除，SQLite 里只打 archived_at，随时可复盘
        this.store?.archiveEpisode(node.id, now)
        pruned.push({ id: node.id, title: node.title, r: Number(this.extractability(node, now).toFixed(3)) })
      } else {
        kept.push(node)
      }
    }
    this.episodes = kept
    this.archivedCount += pruned.length

    const today = kept.filter((node) => now - node.at <= 1.1 * DAY_MS && now - node.at >= -60_000)
    const groups = new Map()
    for (const node of today) {
      for (const tag of node.tags) {
        if (!groups.has(tag)) groups.set(tag, [])
        groups.get(tag).push(node)
      }
    }

    const added = []
    const schemaDeltas = {}
    for (const [tag, nodes] of groups) {
      if (nodes.length < 3) continue
      const strength = clamp(nodes.reduce((sum, n) => sum + n.salience, 0) / nodes.length)
      const meanValence = nodes.reduce((sum, n) => sum + n.valence, 0) / nodes.length
      const semantic = {
        id: uid('sem', this.rng),
        kind: 'semantic',
        tag,
        text: `${tag}这件事，${nodes.length} 次都指向同一个结论：${meanValence < -0.15 ? '别太当真' : meanValence > 0.2 ? '还值得再信一次' : '说不清'}`,
        strength: Number(strength.toFixed(2)),
        count: nodes.length,
        formedAt: now,
      }
      this.semantics.push(semantic)
      added.push(semantic)

      // 慢系统：η(Age) 极低可塑性，且每次最多 0.06
      const hintMap = {}
      for (const node of nodes) {
        for (const [key, value] of Object.entries(node.schemaHints ?? {})) {
          hintMap[key] = (hintMap[key] ?? 0) + Number(value)
        }
      }
      for (const [key, sum] of Object.entries(hintMap)) {
        const delta = eta(age) * (sum / nodes.length) * 0.45
        schemaDeltas[key] = (schemaDeltas[key] ?? 0) + delta
      }
    }
    if (this.semantics.length > 120) this.semantics = this.semantics.slice(-120)

    let dream = null
    const stress = today
      .filter((node) => node.valence < -0.25)
      .sort((a, b) => b.arousal * Math.abs(b.valence) - a.arousal * Math.abs(a.valence))[0]
    const fragments = kept.filter((node) => {
      const r = this.extractability(node, now)
      return r >= PARAMS.subconsciousTier && r < PARAMS.consciousTier
    })
    const fragment = this.rng.pick(fragments)
    if (stress || fragment) {
      const lead = stress ? stress.title : '一件没结尾的事'
      const tail = fragment ? fragment.title : '走廊尽头没关的灯'
      const tone = mood < -0.3 ? '醒过来的时候心口发闷' : mood > 0.3 ? '醒来居然有点想笑' : '醒来只记得一点点'
      dream = {
        id: uid('dream', this.rng),
        at: now,
        narrative: `梦见${lead}，场景却换成了${tail}。${tone}。`,
        sources: {
          stress: stress ? { id: stress.id, title: stress.title } : null,
          fragment: fragment ? { id: fragment.id, title: fragment.title } : null,
        },
        mood: Number(mood.toFixed(3)),
        semanticTags: added.map((item) => item.tag).slice(0, 4),
      }
      this.dreams.push(dream)
      if (this.dreams.length > 60) this.dreams = this.dreams.slice(-60)
    }

    return {
      pruned,
      archivedCount: this.archivedCount,
      semanticsAdded: added,
      schemaDeltas,
      dream,
      remaining: this.episodes.length,
    }
  }

  stats(now) {
    let conscious = 0
    let subconscious = 0
    let pruning = 0
    for (const node of this.episodes) {
      const tier = this.tier(node, now)
      if (tier === 'conscious') conscious += 1
      else if (tier === 'subconscious') subconscious += 1
      else pruning += 1
    }
    return {
      total: this.episodes.length,
      conscious,
      subconscious,
      pruning,
      archived: this.archivedCount,
      semantics: this.semantics.length,
      dreams: this.dreams.length,
    }
  }

  list(now, { tier = 'all', limit = 40 } = {}) {
    const rows = this.episodes
      .map((node) => ({ node, r: this.extractability(node, now), tier: this.tier(node, now) }))
      .filter((row) => tier === 'all' || row.tier === tier)
      .sort((a, b) => b.r - a.r)
      .slice(0, limit)
      .map(({ node, r, tier: t }) => ({
        id: node.id,
        title: node.title,
        // 潜意识层不交出叙事文本，只留标题与情绪
        narrative: t === 'conscious' ? node.narrative : null,
        tier: t,
        r: Number(r.toFixed(3)),
        sDays: Number(node.sDays.toFixed(2)),
        valence: Number(node.valence.toFixed(3)),
        arousal: Number(node.arousal.toFixed(3)),
        at: node.at,
        entityId: node.entityId,
        entityName: node.entityName,
        tags: node.tags,
        recalls: node.recalls,
        distortions: node.distortions,
        source: node.source,
      }))
    return rows
  }

  toJSON() {
    return {
      episodes: this.episodes,
      semantics: this.semantics,
      dreams: this.dreams,
      archived: this.archivedCount,
    }
  }

  static fromJSON(json, rng, store = null) {
    return new MemorySystem({
      rng,
      store,
      episodes: json?.episodes ?? [],
      semantics: json?.semantics ?? [],
      dreams: json?.dreams ?? [],
      archived: json?.archived ?? 0,
    })
  }
}

/** 记忆被当前心境永久涂抹：不是改写事实，而是改写事实的颜色。 */
function distort(narrative, mood, title) {
  if (!narrative) return narrative
  if (mood < -0.25) {
    return `${narrative.replace(/[。！？]$/, '')}——可现在再想，那天的笑是不是也有点假。`
  }
  if (mood > 0.25) {
    return `${narrative.replace(/[。！？]$/, '')}——现在想起来，好像也没那么糟。`
  }
  return `${narrative.replace(/[。！？]$/, '')}——细节已经有点糊了。`
}

function tokenize(text = '') {
  return String(text)
    .split(/[\s，。！？、,.!?~…:：;；"'“”‘’()（）\[\]【】]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8)
}
