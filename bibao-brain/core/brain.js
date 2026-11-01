/**
 * 比宝的大脑门面（Phase 1 纯认知内核，无任何 QQ 协议依赖）。
 *
 * 外部感知帧进来 → 丘脑显著性 → 工作空间点火 → 情感评估 → 语言区组装 →
 * 运动皮层节奏 → 本体感觉回写 + 预期悬置。中间没有一步可以跳过，
 * 也没有一步会把"机器人客服"的默认人格带进来。
 */

import {
  DAY_MS,
  MIN_MS,
  PARAMS,
  clamp,
  HORMONES,
} from './constants.js'
import { createRng, uid } from './rng.js'
import { NeuroState, moodWord } from './state.js'
import { CoreSchema } from './schema.js'
import { SocialMemory } from './social.js'
import { MemorySystem } from './memory.js'
import { GlobalWorkspace } from './workspace.js'
import {
  DEFAULT_INTERESTS,
  analyzeText,
  coreCues,
  decideRoute,
  estimatePE,
  maskStyle,
  salienceOf,
  schemaHintsFor,
  stimulusDelta,
  tagsFor,
} from './appraisal.js'
import { composeEndogenous, decideBudget } from './broca.js'
import { generateDualTrack, extractJson } from './prefrontal.js'
import { bootstrapLife } from './life.js'
import { SensoryCortex, SENSE_CHANNELS, SENSE_REACTIONS } from './senses.js'
import { clockLabel, dayKey, isNight, isSleeping, localParts, motorPlan, TZ_OFFSET_MS } from './clock.js'

export class BibaoBrain {
  constructor({
    biography,
    seed = 20261101,
    startMs = Date.now(),
    virtual = false,
    llm = null,
    llmProvider = '',
    llmModel = '',
    interests = DEFAULT_INTERESTS,
    userId = 'owner',
    userName = '你',
    onDream = null,
  }) {
    this.seed = seed
    this.rng = createRng(seed)
    this.virtual = virtual
    this.biography = biography
    this.interests = interests
    this.userId = userId
    this.userName = userName
    this.llm = llm
    this.llmProvider = llmProvider
    this.llmModel = llmModel
    // 每个认知逻辑可以各用一套模型：{ appraisal, broca, reflection }
    this.llms = {
      broca: { llm, provider: llmProvider, model: llmModel, source: llm ? 'external' : 'local' },
    }
    this.onDream = onDream

    const boot = bootstrapLife(biography, { rng: this.rng, nowMs: startMs })
    this.schema = boot.schema
    this.social = boot.social
    this.memory = boot.memory
    this.birth = boot.birth
    this.age = boot.age
    this.timeline = boot.timeline
    this.timelineDreams = []

    this.simMs = startMs
    this.lastRealMs = Date.now()
    this.state = new NeuroState({ energy: PARAMS.energyStart, moodBaseline: boot.moodBaseline })
    this.workspace = new GlobalWorkspace({ rng: this.rng })

    this.lastExternalAt = startMs
    this.lastDmnAt = startMs
    this.lastSleepDay = null
    this.pending = []
    this.inner = []
    this.stats = {
      turns: 0,
      ignitions: 0,
      endogenous: 0,
      dreams: 0,
      llmCalls: 0,
      llmFallbacks: 0,
      evictions: 0,
    }
    this.lastPE = 0
    this.lastPipeline = null
    this.lastLlmError = ''
    this.senses = new SensoryCortex()
    this.tuning = { memoryStrength: 1, talkativeness: 1 }
    this.lastSpokeAt = 0
  }

  get name() {
    return this.biography?.name ?? '比宝'
  }

  get silenceMin() {
    return Math.max(0, (this.simMs - this.lastExternalAt) / MIN_MS)
  }

  /** 真机：把真实流逝的时间补进生物钟；沙盒 virtual=true 时不动。 */
  sync(now = Date.now()) {
    if (this.virtual) return 0
    const dt = now - this.lastRealMs
    this.lastRealMs = now
    if (dt > 0) this.advance(dt)
    return dt
  }

  /** 推进生物钟，按分钟步进，保证半衰期积分与睡眠触发都不失真。 */
  advance(dtMs) {
    let remaining = Math.min(Math.max(0, dtMs), 30 * DAY_MS)
    while (remaining > 0) {
      const step = Math.min(MIN_MS, remaining)
      this._step(step)
      remaining -= step
    }
    return this.snapshotLite()
  }

  _step(stepMs) {
    this.simMs += stepMs
    const parts = localParts(this.simMs)
    const sleeping = isSleeping(parts.hour)
    this.state.decay(stepMs / MIN_MS, { hour: parts.hour, sleeping })
    this.workspace.decay(stepMs / MIN_MS)

    if (this.state.hijacked) {
      const evicted = this.workspace.enforceCapacity(this.state, this.simMs)
      this.stats.evictions += evicted.length
    }

    this._checkPending()
    this._maybeDmn(parts)
    this._maybeSleep(parts)
  }

  _checkPending() {
    for (const item of this.pending) {
      if (item.fired || this.simMs < item.expireAt) continue
      item.fired = true
      item.firedAt = this.simMs
      const relation = this.social.get(item.entityId)
      const lines = composeEndogenous({
        kind: 'pending-timeout',
        state: this.state,
        pending: item,
        relation,
        rng: this.rng,
        clockLabel: clockLabel(this.simMs),
      })
      this.state.applyStimulus(lines.neuro, {
        valenceTarget: lines.valenceTarget,
        stressor: { name: relation?.name ?? item.entityName, text: `说好会回的，都${clockLabel(this.simMs)}了` },
        at: this.simMs,
      })
      const ignition = this.workspace.ignite(
        {
          kind: 'endogenous',
          source: 'pending',
          title: '他没回',
          content: lines.thought,
          salience: Math.max(lines.salience, this.workspace.threshold(this.state, this.silenceMin) + 0.08),
          arousal: this.state.arousal,
          pe: 0.55,
          tags: lines.tags,
        },
        { state: this.state, silenceMin: this.silenceMin, now: this.simMs },
      )
      this.stats.endogenous += 1
      const entry = {
        at: this.simMs,
        kind: 'endogenous',
        source: 'pending-timeout',
        thought: lines.thought,
        ignited: ignition.ignited,
        salience: Number((ignition.salience ?? 0).toFixed(2)),
      }
      this.inner.push(entry)
      this._trimInner()
      const feedback = this.llms?.feedback
      if (feedback?.llm && feedback.provider && feedback.model) {
        void this._rewriteRumination(entry, relation, item).then((text) => {
          if (text) entry.thought = text
        })
      }
    }
  }

  /** 超时内耗的那句独白，可以交给 feedback 这一路模型重写。 */
  async _rewriteRumination(entry, relation, pending) {
    const feedback = this.llms?.feedback
    if (!feedback?.llm) return ''
    const system = '你在写一个人的深夜内心独白。20-45 字，第一人称，具体、难堪、不解释、不总结。'
    const user = `对方：${relation?.name ?? pending?.entityName ?? '他'}\n我发的最后一句：${pending?.preview ?? ''}\n现在：${clockLabel(this.simMs)}，等了很久没有回复，我还在盯着对话框`
    try {
      let text = ''
      const stream = feedback.llm.stream({
        provider: feedback.provider,
        model: feedback.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens: 120,
        temperature: 0.95,
      })
      for await (const chunk of stream) if (chunk.type === 'text-delta') text += chunk.text
      return text.trim().replace(/^["“]|["”]$/g, '').slice(0, 120)
    } catch {
      return ''
    }
  }

  _maybeDmn(parts) {
    if (this.silenceMin < PARAMS.dmnSilenceMin) return
    if (this.simMs - this.lastDmnAt < PARAMS.dmnCooldownMin * MIN_MS) return
    if (!this.rng.chance(0.22)) return
    this.lastDmnAt = this.simMs
    if (this.workspace.slots.length >= this.workspace.capacity(this.state)) return

    const subconscious = this.memory.episodes.filter((node) => {
      const r = this.memory.extractability(node, this.simMs)
      return r >= PARAMS.subconsciousTier && r < PARAMS.consciousTier
    })
    const memory = this.rng.pick(subconscious)
    const night = parts.hour < 5 || parts.hour >= 23
    const lines = composeEndogenous({
      kind: night ? 'night-rumination' : 'dmn',
      state: this.state,
      memory,
      rng: this.rng,
      clockLabel: clockLabel(this.simMs),
    })
    this.state.applyStimulus(lines.neuro, { valenceTarget: lines.valenceTarget, at: this.simMs })
    const ignition = this.workspace.ignite(
      {
        kind: 'endogenous',
        source: 'dmn',
        title: night ? '深夜反刍' : '走神',
        content: lines.thought,
        salience: lines.salience,
        arousal: this.state.arousal,
        pe: 0.2,
        tags: lines.tags,
      },
      { state: this.state, silenceMin: this.silenceMin, now: this.simMs },
    )
    if (!ignition.ignited) return
    this.stats.endogenous += 1
    this.inner.push({
      at: this.simMs,
      kind: 'endogenous',
      source: night ? 'night-rumination' : 'dmn',
      thought: lines.thought,
      ignited: true,
      salience: ignition.salience,
    })
    this._trimInner()
  }

  _maybeSleep(parts) {
    if (parts.hour !== 3 || parts.minute !== 0) return
    const key = dayKey(this.simMs)
    if (this.lastSleepDay === key) return
    this.sleep({ dayKey: key })
  }

  /** 睡眠交叉回放：唯一允许修改 CoreSchema 的时刻。 */
  sleep({ dayKey: key = dayKey(this.simMs) } = {}) {
    const report = this.memory.consolidate({ now: this.simMs, age: this.age, mood: this.state.moodValence })
    const applied = this.schema.updateFromConsolidation(report.schemaDeltas)
    this.state.energy = clamp(this.state.energy + 16, 0, 100)
    this.state.moodBaseline = clamp(
      0.05 +
        0.45 * this.schema.get('self_worth') +
        0.25 * this.schema.get('world_trust') -
        0.18 * this.schema.get('attachment_anxiety'),
      -0.5,
      0.5,
    )
    this.lastSleepDay = key
    this.stats.dreams += report.dream ? 1 : 0
    if (report.dream) {
      const entry = {
        at: this.simMs,
        kind: 'dream',
        source: 'sleep',
        thought: report.dream.narrative,
        ignited: false,
        salience: 0.3,
      }
      this.inner.push(entry)
      this._trimInner()
      // 造梦用的是 reflection 这一路模型；失败就保留模板版本
      const reflection = this.llms?.memory ?? this.llms?.reflection
      if (reflection?.llm && reflection.provider && reflection.model) {
        entry.thought = report.dream.narrative
        void this._rewriteDream(report.dream).then((text) => {
          if (!text) return
          report.dream.narrative = text
          entry.thought = text
        })
      }
    }
    return {
      ...report,
      schemaApplied: applied,
      at: this.simMs,
      label: `${key} 03:00 睡眠归纳`,
    }
  }


  /**
   * 脑机接口：一条外部感知（看到的画面 / 听到的声音 / 闻到的气味…）。
   * 它不进社交账本，也不会生成回话，只影响工作空间、记忆和情绪。
   */
  perceiveSense({ channel = 'vision', text = '', intensity = 0.6 } = {}) {
    this.sync()
    const now = this.simMs
    const meta = SENSE_CHANNELS.find((item) => item.key === channel)
    if (!meta) return { ok: false, reason: 'unknown-channel' }
    const content = String(text ?? '').trim()
    if (!content) return { ok: false, reason: 'empty' }
    this.senses.record(channel, content, now)

    const level = clamp(Number(intensity) || 0.6)
    const hitsInterest = this.interests.some((word) => content.includes(word))
    const salience = clamp(0.22 + level * 0.55 + (meta.key === 'interoception' ? 0.05 : 0) + (hitsInterest ? 0.12 : 0))
    const ignition = this.workspace.ignite(
      {
        kind: 'sensor',
        source: `sense:${channel}`,
        title: `${meta.label}：${content.slice(0, 18)}`,
        content,
        salience,
        arousal: clamp(this.state.arousal + level * 0.2),
        pe: 0.3,
        tags: [meta.label, meta.modality],
      },
      { state: this.state, silenceMin: this.silenceMin, now },
    )

    // 感官直接改情绪：听到的比看到的更揪心，闻到的更容易勾起旧事
    const delta = { dopamine: 0.02, cortisol: 0, oxytocin: 0 }
    if (channel === 'hearing') delta.cortisol = 0.04 * level
    if (channel === 'smell') delta.oxytocin = 0.05 * level
    if (channel === 'browser') delta.dopamine = 0.05 * level
    if (channel === 'interoception') delta.cortisol = 0.03 * level
    this.state.applyStimulus(delta, { valenceTarget: (level - 0.5) * 0.4, at: now })

    if (!ignition.ignited) {
      return { ok: true, ignited: false, salience: Number(salience.toFixed(3)), channel, text: content }
    }

    const pool = SENSE_REACTIONS[channel] ?? SENSE_REACTIONS.vision
    const thought = `${meta.label}里：${content.slice(0, 40)}。${pool[Math.floor(this.rng.next() * pool.length)]}`
    const episode = this.memory.write({
      now,
      age: this.age,
      arousal: this.state.arousal,
      pe: 0.32,
      valence: (level - 0.5) * 0.3,
      salience,
      title: `${meta.label}：${content.slice(0, 14)}`,
      narrative: `我${meta.modality}到：${content}`,
      tags: [meta.label, meta.modality, '感官'],
      entityId: null,
      entityName: null,
      source: 'sense',
    })
    if (episode) this.workspace.markWritten(ignition.slot.id, episode.id)

    this.inner.push({
      at: now,
      kind: 'sensor',
      source: `sense:${channel}`,
      thought,
      ignited: true,
      salience,
    })
    this._trimInner()
    return {
      ok: true,
      ignited: true,
      channel,
      label: meta.label,
      thought,
      salience: Number(salience.toFixed(3)),
      episodeId: episode?.id ?? null,
    }
  }


  /** 两个旋钮：记忆力（稳定性缩放）与说话频率（阈值罚 + 冷却）。拉满 = 原样。 */
  applyTuning(tuning = {}) {
    if (Number.isFinite(Number(tuning.memoryStrength))) {
      this.tuning.memoryStrength = clamp(Number(tuning.memoryStrength), 0, 1)
    }
    if (Number.isFinite(Number(tuning.talkativeness))) {
      this.tuning.talkativeness = clamp(Number(tuning.talkativeness), 0, 1)
    }
    const exponent = (this.tuning.memoryStrength - 1) * 4
    this.memory.stabilityScale = Math.pow(10, exponent)
    return this.tuning
  }

  _trimInner() {
    if (this.inner.length > 80) this.inner = this.inner.slice(-80)
  }

  /** 潜台词揣测（appraisal 模型）：只影响"怎么理解这句话"，不改路由与激素。 */
  async _appraisalHint({ text, relation, analysis }) {
    const appraisal = this.llms?.appraisal
    if (!appraisal?.llm || !appraisal.provider || !appraisal.model) return null
    const system =
      '你只做潜台词判断。只输出一个 JSON：{"subtext":"20字内的潜台词","hostility":0.0,"warmth":0.0}。hostility/warmth 取 0-1。不要解释，不要寒暄。'
    const user = `对方：${relation?.name ?? '陌生人'}（亲密度 ${Math.round(relation?.intimacy ?? 0)}，信任 ${Math.round(relation?.trust ?? 35)}）\n原话：「${text}」\n我现在的皮质醇：${this.state.cortisol.toFixed(2)}，精力：${Math.round(this.state.energy)}%`
    try {
      let raw = ''
      const stream = appraisal.llm.stream({
        provider: appraisal.provider,
        model: appraisal.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens: 260,
        temperature: 0.4,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') raw += chunk.text
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') break
      }
      const parsed = extractJson(raw)
      if (!parsed) return null
      return {
        subtext: String(parsed.subtext ?? '').slice(0, 60),
        hostility: clamp(Number(parsed.hostility) || analysis.hostility),
        warmth: clamp(Number(parsed.warmth) || analysis.warmth),
      }
    } catch {
      return null
    }
  }

  /** 睡眠造梦（reflection 模型）：把白天的压力与潜意识碎片写成一段梦。 */
  async _rewriteDream(dream) {
    const reflection = this.llms?.reflection
    if (!reflection?.llm || !reflection.provider || !reflection.model) return ''
    const system =
      '你只做一件事：把潜意识的碎片写成一段中文梦境。40-80 字，第一人称，具体、有感官细节，不解释、不加引号、不提"梦"这个字的定义。'
    const user = `白天的压力：${dream.sources?.stress?.title ?? '一件没结尾的事'}\n潜意识碎片：${dream.sources?.fragment?.title ?? '走廊尽头没关的灯'}\n当前心境：${this.state.moodValence.toFixed(2)}\n醒来时的感觉：${this.state.moodValence < -0.3 ? '心口发闷' : this.state.moodValence > 0.3 ? '居然有点想笑' : '只记得一点点'}`
    try {
      let text = ''
      const stream = reflection.llm.stream({
        provider: reflection.provider,
        model: reflection.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens: 220,
        temperature: 0.95,
      })
      for await (const chunk of stream) if (chunk.type === 'text-delta') text += chunk.text
      return text.trim().replace(/^["“]|["”]$/g, '').slice(0, 220)
    } catch {
      return ''
    }
  }

  _novelty(text, relation) {
    const familiarity = clamp(relation.interactions * 0.08, 0, 0.55)
    const memoryHit = this.memory
      .retrieve({ now: this.simMs, entityId: relation.id, query: text, limit: 1 })
      .length
    return clamp(0.55 - familiarity + (memoryHit ? -0.1 : 0.12))
  }

  /**
   * 一次完整知觉：所有认知环节都在这里留下可审计的痕迹。
   * frame: { entityId, entityName, text, channel, atMe, priority, groupId, groupName }
   */
  async perceive(frame = {}) {
    this.sync()
    const now = this.simMs
    const text = String(frame.text ?? '').trim()
    const entityId = String(frame.entityId ?? this.userId)
    const relation = this.social.ensure(entityId, frame.entityName || this.userName)
    const channel = frame.channel === 'group' ? 'group' : 'private'
    const atMe = Boolean(frame.atMe)

    // 对方一开口，原来的"等回复"钩子立即销毁
    const beforePending = this.pending.filter((item) => item.entityId === entityId && !item.fired)
    this.pending = this.pending.filter((item) => item.entityId !== entityId)

    const analysis = analyzeText(text)
    const cues = coreCues(text)
    const schemaHits = this.schema.touchedBy(cues)
    const tags = tagsFor(analysis, schemaHits)
    const novelty = this._novelty(text, relation)
    const pe = estimatePE({
      analysis,
      relation,
      schemaHits,
      expectation: beforePending[0] ? { kind: beforePending[0].kind } : null,
      topicNovelty: novelty,
    })
    const salienceInfo = salienceOf({
      analysis,
      relation,
      channel,
      atMe,
      nameMention: Boolean(frame.nameMention),
      priority: Number(frame.priority ?? 0),
      interests: this.interests,
    })
    const bias = this.memory.biasFor({ entityId, tags }, now)
    const theta = this.workspace.threshold(this.state, this.silenceMin)

    this.lastExternalAt = now
    this.stats.turns += 1

    const talk = this.tuning.talkativeness
    const cooldownMs = (1 - talk) * 240000
    if (talk < 1 && !atMe && this.lastSpokeAt && now - this.lastSpokeAt < cooldownMs) {
      this.lastPipeline = {
        at: now,
        frame: { ...frame, text },
        stages: [
          { key: 'funnel', label: '丘脑门控', status: 'blocked', detail: '刚说过话，还没缓过来' },
          { key: 'workspace', label: '全局工作空间', status: 'idle', detail: '不进意识' },
        ],
        pe,
        salience: 0.2,
        theta: this.workspace.threshold(this.state, this.silenceMin),
        ignited: false,
      }
      return {
        ignited: false,
        route: 'SILENT_SKIP',
        reason: '说话频率调低了：刚回过，这次先不接',
        pe,
        salience: 0.2,
        theta: this.workspace.threshold(this.state, this.silenceMin),
        stages: this.lastPipeline.stages,
        state: this.state.snapshot({ mood: moodWord(this.state.moodValence) }),
      }
    }
    const thetaBoost = (1 - talk) * 0.5

    const ignition = this.workspace.ignite(
      {
        kind: 'external',
        source: channel === 'group' ? `group:${frame.groupName ?? frame.groupId ?? '群'}` : 'private',
        title: `${relation.name}: ${text.slice(0, 18)}`,
        content: text,
        entityId,
        entityName: relation.name,
        salience: salienceInfo.salience,
        arousal: this.state.arousal,
        pe,
        tags,
      },
      { state: this.state, silenceMin: this.silenceMin, now, thetaBoost },
    )
    this.stats.evictions += ignition.evicted?.length ?? 0

    const stages = [
      {
        key: 'funnel',
        label: '丘脑门控',
        status: ignition.ignited ? 'pass' : 'blocked',
        detail: `salience ${salienceInfo.salience.toFixed(2)} ${ignition.ignited ? '≥' : '<'} Θ ${theta.toFixed(2)}`,
      },
      {
        key: 'workspace',
        label: '全局工作空间',
        status: ignition.ignited ? 'ignited' : 'idle',
        detail: `占用 ${this.workspace.slots.length}/${this.workspace.capacity(this.state)}${ignition.evicted?.length ? ` · 挤出 ${ignition.evicted.length}` : ''}`,
      },
    ]

    if (!ignition.ignited) {
      this.lastPipeline = { at: now, frame, stages, pe, salience: salienceInfo.salience, theta, ignited: false }
      this.stats.ignitions += 0
      return {
        ignited: false,
        route: 'SILENT_SKIP',
        reason: '显著性低于点火阈值：这条信号没有进入意识',
        pe,
        salience: salienceInfo.salience,
        theta,
        stages,
        state: this.state.snapshot({ mood: moodWord(this.state.moodValence) }),
      }
    }
    this.stats.ignitions += 1

    const interactionsBefore = relation.interactions
    const stim = stimulusDelta({ analysis, relation, schemaHits, channel })
    this.state.applyStimulus(stim.delta, {
      valenceTarget: stim.valenceTarget,
      stressor:
        analysis.hostility > 0.25 || analysis.preaching > 0.25
          ? { name: relation.name, text, at: now }
          : undefined,
      at: now,
    })
    this.social.remember(entityId, { at: now, role: 'user', text })
    this.social.adjust(entityId, {
      intimacy: stim.intimacyDelta,
      trust: stim.trustDelta,
      impression: analysis.hostility > 0.3 ? '说话冲，记着' : analysis.warmth > 0.3 ? '会照顾人' : relation.impression,
    })
    if (this.state.hijacked) {
      const extra = this.workspace.enforceCapacity(this.state, now)
      this.stats.evictions += extra.length
    }

    const episode = this.memory.write({
      now,
      age: this.age,
      arousal: this.state.arousal,
      pe,
      relational: channel === 'private' && interactionsBefore > 0,
      valence: stim.valenceTarget,
      salience: salienceInfo.salience,
      title: text.slice(0, 16) || '一句话',
      narrative: `${relation.name}说：「${text}」`,
      tags,
      schemaHints: schemaHintsFor(analysis, schemaHits),
      entityId,
      entityName: relation.name,
      source: channel === 'group' ? 'group' : 'chat',
    })
    if (episode) this.workspace.markWritten(ignition.slot.id, episode.id)

    const decision = decideRoute({
      analysis,
      relation,
      state: this.state,
      schemaHits,
      pe,
      channel,
      atMe,
      salience: salienceInfo.salience,
      silenceMin: this.silenceMin,
    })
    if (decision.defensive) {
      relation.defiances += 1
      // 抗洗脑的代价：不改信念，但关系账本要掉
      this.social.adjust(entityId, { trust: -4.5, intimacy: -2.5 })
    }

    const style = maskStyle(relation, this.state)
    const budget = decideBudget({ state: this.state, salience: salienceInfo.salience, style })
    const appraisalHint = await this._appraisalHint({ text, relation, analysis })
    const memories = this.memory.retrieve({
      now,
      entityId,
      query: text,
      tags,
      limit: 3,
      exclude: episode?.id ?? null,
    })
    const transferTarget =
      decision.route === 'TRANSFER_PRIVATE_GOSSIP'
        ? this.social.bestGossipTarget([entityId, this.userId])
        : null

    // "你最开始说啥来着"——这类考记性的探针，如果话题确实被挤掉了，
    // 就必须真的答不上来，而不是检索到一条似是而非的记忆硬圆。
    const RECALL_PROBES = ['最开始', '刚才说', '之前说', '说了啥', '说啥来着', '记不记得', '我刚说']
    const recallProbe = RECALL_PROBES.some((word) => text.includes(word))
    const recentlyLost = this.workspace.lost.filter((item) => now - item.at < 90 * MIN_MS)
    const forgot = recallProbe && recentlyLost.length
      ? { lost: recentlyLost.map((item) => item.title).reverse(), probe: text }
      : null

    stages.push({
      key: 'appraisal',
      label: '情感评估',
      status: decision.defensive ? 'defense' : 'appraise',
      detail: `PE ${pe.toFixed(2)} · ${schemaHits.length ? `踩到${schemaHits[0].cue}` : '未触核心'} · ${style}`,
    })
    stages.push({
      key: 'memory',
      label: '双系统记忆',
      status: episode ? 'write' : 'skip',
      detail: episode ? '海马体快写一条情景' : `未达写入阈值（唤醒 ${this.state.arousal.toFixed(2)} / PE ${pe.toFixed(2)}）`,
    })
    stages.push(
      {
        key: 'prefrontal',
        label: '语言区',
        status: 'think',
        detail: `预算 ${budget.maxChars} 字 / ${budget.maxBubbles} 气泡`,
      },
    )

    const dual = await generateDualTrack(
      {
        analysis,
        frame: {
          text,
          entityId,
          entityName: relation.name,
          channel,
          groupName: frame.groupName,
          atMe,
        },
        relation,
        state: this.state,
        schema: this.schema,
        route: decision.route,
        routeReasons: decision.reasons,
        style,
        pe,
        schemaHits,
        bias,
        memories,
        budget,
        rng: this.rng,
        lastStressor: this.state.lastStressor,
        transferTarget,
        forgot,
        appraisalHint,
        recent: relation.recent ?? [],
        clockLabel: clockLabel(now),
      },
      this.llms?.broca ?? { llm: this.llm, provider: this.llmProvider, model: this.llmModel },
    )

    if (appraisalHint?.subtext && dual.meta?.source !== 'llm') {
      dual.perceived_subtext = appraisalHint.subtext
    }
    if (appraisalHint?.subtext) {
      stages.push({
        key: 'appraisalModel',
        label: '潜台词模型',
        status: 'think',
        detail: appraisalHint.subtext,
      })
    }

    this.lastLlmError = dual.meta?.llmError ?? ''
    if (dual.meta?.source === 'llm') this.stats.llmCalls += 1
    if (dual.meta?.llmError) this.stats.llmFallbacks += 1

    // LLM 的神经增量只能微调，且被 allowlist + 限幅过（见 prefrontal.normalizeDualTrack）
    this.state.applyStimulus(dual.neuro_delta ?? {}, { at: now })
    if (Number.isFinite(dual.neuro_delta?.intimacy_delta)) {
      this.social.adjust(entityId, { intimacy: dual.neuro_delta.intimacy_delta })
    }

    if ((dual.bubbles ?? []).length) {
      this.social.remember(entityId, { at: now, role: 'self', text: (dual.bubbles ?? []).join(' ') })
    }
    const motor = motorPlan(dual.bubbles ?? [], this.state.energy, dual.action_route === 'SILENT_READ' ? 0.5 : 0)
    stages.push({
      key: 'motor',
      label: '运动皮层',
      status: (dual.bubbles ?? []).length ? 'send' : 'hold',
      detail: (dual.bubbles ?? []).length ? `${dual.bubbles.length} 气泡 · ${motor.at(-1)?.delaySec ?? 0}s` : '压住不发',
    })

    // 预期悬置：只有真的发出去了才挂钩子
    if (dual.expect_reply_within_sec > 0 && (dual.bubbles ?? []).length) {
      this.pending.push({
        id: uid('expect', this.rng),
        entityId,
        entityName: relation.name,
        kind: analysis.hostility > 0.3 ? 'hostile' : 'warm',
        sentAt: now,
        expireAt: now + dual.expect_reply_within_sec * 1000,
        expectationSec: dual.expect_reply_within_sec,
        preview: (dual.bubbles ?? []).join(' / ').slice(0, 40),
        fired: false,
      })
      stages.push({
        key: 'feedback',
        label: '预期悬置',
        status: 'waiting',
        detail: `等待 ${dual.expect_reply_within_sec}s 内的回复`,
      })
    } else {
      stages.push({ key: 'feedback', label: '预期悬置', status: 'idle', detail: '没有挂起预期' })
    }

    // 本体感觉回写：自己说过的话也要被自己听见
    const selfEpisode =
      this.state.arousal > 0.45 && (dual.bubbles ?? []).length
        ? this.memory.write({
            now,
            age: this.age,
            arousal: this.state.arousal + 0.05,
            pe: 0.1,
            valence: stim.valenceTarget * 0.6,
            salience: salienceInfo.salience,
            title: `我说：${(dual.bubbles ?? []).join(' ').slice(0, 14)}`,
            narrative: `我对${relation.name}说：「${(dual.bubbles ?? []).join(' ')}」。当时心里想的是：${dual.inner_monologue}`,
            tags: ['自我行为', ...tags.slice(0, 2)],
            entityId: null,
            entityName: relation.name,
            source: 'self',
          })
        : null

    if ((dual.bubbles ?? []).length) this.lastSpokeAt = now
    this.inner.push({
      at: now,
      kind: 'external',
      source: dual.meta?.source ?? 'local',
      thought: dual.inner_monologue,
      route: dual.action_route,
      bubbles: dual.bubbles,
      entityName: relation.name,
      salience: salienceInfo.salience,
      ignited: true,
    })
    this._trimInner()

    this.lastPE = pe
    const result = {
      ignited: true,
      at: now,
      clockLabel: clockLabel(now),
      frame: { ...frame, text, entityName: relation.name },
      dual,
      motor,
      stages,
      pe: Number(pe.toFixed(3)),
      salience: Number(salienceInfo.salience.toFixed(3)),
      theta: Number(theta.toFixed(3)),
      bias: Number(bias.toFixed(3)),
      style,
      budget,
      relation: { ...relation },
      schemaHits: schemaHits.map((hit) => ({ belief: hit.belief, label: hit.label, cue: hit.cue })),
      episodeId: episode?.id ?? null,
      selfEpisodeId: selfEpisode?.id ?? null,
      evicted: ignition.evicted ?? [],
      pendingId: this.pending.at(-1)?.id ?? null,
      memories: memories.map((item) => ({ id: item.id, title: item.title, r: item.r, valence: item.valence })),
      state: this.state.snapshot({ mood: moodWord(this.state.moodValence) }),
    }
    this.lastPipeline = { at: now, frame: result.frame, stages, pe: result.pe, salience: result.salience, theta: result.theta, ignited: true, dual, motor }
    return result
  }

  /** 场景注入：直接写入一条指定效价/唤醒度的情景记忆（沙盒与"回忆"测试用）。 */
  imprint({ entityId = null, entityName = null, title, narrative, valence, arousal, tags = [], at = null }) {
    const node = this.memory.write({
      now: at ?? this.simMs,
      age: this.age,
      arousal: Number(arousal ?? 0.5),
      pe: 0.1,
      force: true,
      valence,
      salience: 0.6,
      title,
      narrative,
      tags,
      entityId,
      entityName,
      source: 'manual',
    })
    return node
  }

  /** 显式回忆：门控再巩固会把当前心境烙回去。 */
  recall(memoryId, { pe = this.lastPE } = {}) {
    this.sync()
    const result = this.memory.recall(memoryId, {
      now: this.simMs,
      pe,
      moodNow: this.state.moodValence,
    })
    if (result.ok) {
      this.workspace.ignite(
        {
          kind: 'endogenous',
          source: 'recall',
          title: `想起：${result.id}`,
          content: result.narrativeAfter,
          salience: 0.72,
          arousal: this.state.arousal,
          pe,
          tags: ['回忆'],
          force: true,
        },
        { state: this.state, silenceMin: this.silenceMin, now: this.simMs },
      )
      this.inner.push({
        at: this.simMs,
        kind: 'recall',
        source: 'explicit',
        thought: `又想起那件事：${result.narrativeAfter.slice(0, 48)}`,
        ignited: true,
        salience: 0.72,
      })
      this._trimInner()
    }
    return { ...result, at: this.simMs, clockLabel: clockLabel(this.simMs) }
  }

  /** 轻量快照：给 tick 轮询用。 */
  snapshotLite() {
    return {
      simMs: this.simMs,
      clock: clockLabel(this.simMs),
      silenceMin: Math.round(this.silenceMin),
      theta: Number(this.workspace.threshold(this.state, this.silenceMin).toFixed(3)),
      neuro: this.state.snapshot({ mood: moodWord(this.state.moodValence) }),
      workspaces: this.workspace.snapshot(),
      capacity: this.workspace.capacity(this.state),
    }
  }

  snapshot() {
    this.sync()
    const now = this.simMs
    const theta = this.workspace.threshold(this.state, this.silenceMin)
    return {
      identity: {
        name: this.name,
        fullName: this.biography?.fullName ?? this.name,
        age: this.age,
        oneLine: this.biography?.oneLine ?? '',
        coreWound: this.biography?.coreWound ?? '',
        copingStyle: this.biography?.copingStyle ?? '',
        phase: 'phase1',
      },
      clock: {
        simMs: now,
        label: clockLabel(now),
        day: dayKey(now),
        hour: localParts(now).hour,
        silenceMin: Math.round(this.silenceMin),
        sleeping: isSleeping(localParts(now).hour),
        night: isNight(now),
        virtual: this.virtual,
        ageDays: Math.round((now - this.birth) / DAY_MS),
      },
      neuro: this.state.snapshot({ mood: moodWord(this.state.moodValence) }),
      threshold: {
        value: Number(theta.toFixed(3)),
        base: PARAMS.ignitionBase,
        cortisolTerm: Number((0.25 * this.state.cortisol).toFixed(3)),
        silenceTerm: Number((0.5 * Math.tanh(this.silenceMin / PARAMS.ignitionTauMin)).toFixed(3)),
      },
      schema: this.schema.snapshot(),
      social: this.social.snapshot(),
      workspace: {
        capacity: this.workspace.capacity(this.state),
        hijacked: this.state.hijacked,
        slots: this.workspace.snapshot(),
        lost: this.workspace.lost.slice(-8),
      },
      memory: {
        stats: this.memory.stats(now),
        recent: this.memory.list(now, { limit: 24 }),
        dreams: this.memory.dreams.slice(-6),
        semantics: this.memory.semantics.slice(-8),
      },
      pending: this.pending.filter((item) => !item.fired).map((item) => ({
        ...item,
        remainingSec: Math.max(0, Math.round((item.expireAt - now) / 1000)),
      })),
      inner: this.inner.slice(-14),
      pipeline: this.lastPipeline,
      senses: this.senses.snapshot(),
      tuning: { ...this.tuning },
      stats: { ...this.stats },
      timeline: this.timeline.map((item) => ({
        index: item.index,
        age: Number(item.age.toFixed(1)),
        title: item.title,
        stage: item.stage,
        betaAge: item.betaAge,
        stabilityDays: item.stabilityDays,
        tier: item.tier,
      })),
      llm: {
        enabled: Boolean(this.llm && this.llmProvider && this.llmModel),
        provider: this.llmProvider,
        model: this.llmModel,
        lastError: this.lastLlmError ?? '',
      },
      biographyMissing: !this.biography,
    }
  }

  toJSON() {
    return {
      version: 3,
      seed: this.seed,
      savedAt: this.simMs,
      simMs: this.simMs,
      age: this.age,
      birth: this.birth,
      state: this.state.toJSON(),
      schema: this.schema.toJSON(),
      social: this.social.toJSON(),
      memory: this.memory.toJSON(),
      workspace: this.workspace.toJSON(),
      lastExternalAt: this.lastExternalAt,
      lastDmnAt: this.lastDmnAt,
      lastSleepDay: this.lastSleepDay,
      pending: this.pending,
      inner: this.inner.slice(-40),
      stats: this.stats,
      lastPE: this.lastPE,
      lastPipeline: this.lastPipeline,
      lastLlmError: this.lastLlmError,
      senses: this.senses.toJSON(),
      tuning: this.tuning,
      timeline: this.timeline,
    }
  }

  static fromJSON(json, { biography, llm, llmProvider, llmModel, interests, userName, userId }) {
    const brain = new BibaoBrain({
      biography,
      seed: json.seed ?? 20261101,
      startMs: json.simMs ?? Date.now(),
      virtual: true,
      llm,
      llmProvider,
      llmModel,
      interests,
      userName,
      userId,
    })
    brain.state = NeuroState.fromJSON(json.state)
    brain.schema = CoreSchema.fromJSON(json.schema)
    brain.social = SocialMemory.fromJSON(json.social)
    brain.memory = MemorySystem.fromJSON(json.memory, brain.rng)
    brain.workspace = GlobalWorkspace.fromJSON(json.workspace, brain.rng)
    brain.simMs = json.simMs ?? Date.now()
    brain.birth = json.birth ?? brain.birth
    brain.age = json.age ?? brain.age
    brain.lastExternalAt = json.lastExternalAt ?? brain.simMs
    brain.lastDmnAt = json.lastDmnAt ?? brain.simMs
    brain.lastSleepDay = json.lastSleepDay ?? null
    brain.pending = json.pending ?? []
    brain.inner = json.inner ?? []
    brain.stats = { ...brain.stats, ...(json.stats ?? {}) }
    brain.lastPE = json.lastPE ?? 0
    brain.lastPipeline = json.lastPipeline ?? null
    brain.lastLlmError = json.lastLlmError ?? ''
    brain.senses = SensoryCortex.fromJSON(json.senses)
    brain.applyTuning(json.tuning ?? {})
    // v1 → v2：情景记忆的稳定性基准从 3 天提到 30 天，老存档按比例放大
    const fromVersion = json.version ?? 1
    if (fromVersion < 2) {
      for (const node of brain.memory.episodes) {
        if (node.source === 'life') node.sDays = (node.sDays ?? 1) * 10
      }
    }
    if (fromVersion < 3) {
      for (const node of brain.memory.episodes) {
        if (node.source === 'life') node.sDays = (node.sDays ?? 1) * 2
      }
    }
    brain.timeline = json.timeline ?? brain.timeline
    // 持久化后按真实时间继续衰老
    brain.virtual = false
    brain.lastRealMs = Date.now()
    return brain
  }
}

export { PARAMS, HORMONES, TZ_OFFSET_MS }
