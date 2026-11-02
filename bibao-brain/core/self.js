/**
 * 自我模型 / 元认知（SelfModel）。
 *
 * 这一层不改「她是谁」，只做三件事：
 *  1. 记住每次开口之后发生了什么：对方接住了、变冷了、还是干脆没回；
 *  2. 把这些证据压成少数几条能带进下一轮的经验（lessons）；
 *  3. 微调说话倾向（warmth / playfulness / directness / verbosity / vulnerability / initiative）。
 *
 * 所有调整都有物理上限：单次复盘最多 ±0.06，经验条数有上限、会衰减，
 * 模型只能提建议，不能写核心信念，也不能把自己改成客服。
 */

import { DAY_MS, HOUR_MS, MIN_MS, clamp } from './constants.js'

export const STYLE_KEYS = ['warmth', 'playfulness', 'directness', 'verbosity', 'vulnerability', 'initiative']

export const DEFAULT_STYLE = {
  warmth: 0.55,
  playfulness: 0.55,
  directness: 0.45,
  verbosity: 0.5,
  vulnerability: 0.4,
  initiative: 0.35,
}

const MAX_LESSONS = 10
const MAX_EVIDENCE = 60
const EVIDENCE_TTL = 7 * DAY_MS
const LESSON_TTL = 60 * DAY_MS
const REVIEW_MIN_GAP = 6 * HOUR_MS
const REVIEW_MAX_DELTA = 0.06

const STYLE_LABEL = {
  warmth: '暖意',
  playfulness: '玩心',
  directness: '直率',
  verbosity: '话量',
  vulnerability: '示弱',
  initiative: '主动',
}

function textOf(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeStyle(raw = {}) {
  const style = { ...DEFAULT_STYLE }
  for (const key of STYLE_KEYS) {
    const value = Number(raw?.[key])
    if (Number.isFinite(value)) style[key] = clamp(value, 0, 1)
  }
  return style
}

function bigrams(text) {
  const clean = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let index = 0; index < clean.length - 1; index += 1) out.add(clean.slice(index, index + 2))
  return out
}

function overlap(a, b) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (!left.size || !right.size) return 0
  let hit = 0
  for (const gram of left) if (right.has(gram)) hit += 1
  return hit / Math.min(left.size, right.size)
}

function normalizeLesson(raw, now) {
  if (!raw) return null
  const source = typeof raw === 'string' ? { text: raw } : raw
  const text = textOf(source.text ?? source.lesson ?? '', 48)
  if (text.length < 4) return null
  return {
    id: textOf(source.id ?? '', 32) || `lesson_${Math.abs(hash(text)).toString(16)}`,
    text,
    weight: clamp(Number(source.weight ?? source.confidence ?? 0.6), 0, 1),
    confidence: clamp(Number(source.confidence ?? source.weight ?? 0.6), 0, 1),
    source: textOf(source.source ?? 'review', 16),
    createdAt: Number(source.createdAt ?? now),
    updatedAt: Number(source.updatedAt ?? now),
    hits: Math.max(0, Number(source.hits ?? 0)),
  }
}

function hash(text) {
  let h = 2166136261 >>> 0
  for (let index = 0; index < String(text).length; index += 1) {
    h ^= String(text).charCodeAt(index)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** 把任意文本里的第一个合法 JSON 对象抠出来（模型偶尔会带解释或代码块）。 */
export function parseReviewJson(raw = '') {
  const text = String(raw)
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export class SelfModel {
  constructor(state = {}) {
    this.narrative = textOf(state.narrative ?? '', 320)
    this.style = normalizeStyle(state.style)
    this.lessons = Array.isArray(state.lessons)
      ? state.lessons.map((item) => normalizeLesson(item, Date.now())).filter(Boolean).slice(-MAX_LESSONS)
      : []
    this.evidence = Array.isArray(state.evidence) ? state.evidence.slice(-MAX_EVIDENCE) : []
    this.reviews = Math.max(0, Number(state.reviews ?? 0))
    this.lastReviewAt = Number(state.lastReviewAt ?? 0)
    this.selfEsteem = clamp(Number(state.selfEsteem ?? 0.5), 0, 1)
  }

  /** 上一条自己说的话，对方是怎么接的。返回证据或 null。 */
  observeOutcome({ relation, text, analysis, now = Date.now() } = {}) {
    const recent = Array.isArray(relation?.recent) ? relation.recent : []
    const lastSelf = [...recent].reverse().find((item) => item.role === 'self' && item.text)
    if (!lastSelf) return null
    const gap = now - (lastSelf.at ?? now)
    // 太短是连发，太长是另一段对话；都不算这条回复的反馈
    if (gap < 2 * MIN_MS || gap > 24 * HOUR_MS) return null
    const reply = String(lastSelf.text ?? '')
    if (!reply) return null

    const raw = String(text ?? '').trim()
    const shortNeutral = raw.length <= 3 && !analysis?.question
    const cold = Number(analysis?.hostility ?? 0) > 0.2 || shortNeutral || /^(哦|嗯|行|随便|算了|没事|好|知道了)[。.!！~…]*$/.test(raw)
    const warm =
      Number(analysis?.warmth ?? 0) > 0.2 ||
      Number(analysis?.gossipy ?? 0) > 0.2 ||
      Boolean(analysis?.question) ||
      /哈哈|笑死|hhh|可爱|喜欢|谢谢|抱抱|想你了|挺好|有趣|再来|继续说/i.test(raw)
    const sharp = /配吗|算个屁|闭嘴|滚|你谁|少来|烦不烦|有病|幼稚|丢人|废物|懒得理/.test(reply)
    const long = reply.length > 42

    let signal = 'neutral'
    if (cold && sharp) signal = 'too_sharp'
    else if (cold && long) signal = 'too_long'
    else if (warm && !cold) signal = 'landed'

    const evidence = {
      at: now,
      entityId: relation?.id ?? null,
      intimacy: Math.round(Number(relation?.intimacy ?? 0)),
      signal,
      gapMs: gap,
      replyChars: reply.length,
      sharp,
      text: textOf(raw, 32),
    }
    this.evidence.push(evidence)
    if (this.evidence.length > MAX_EVIDENCE) this.evidence = this.evidence.slice(-MAX_EVIDENCE)
    return evidence
  }

  /** 挂起的预期没人接：这是另一种证据，不是"对方冷"，是"我追得太紧"。 */
  observeIgnored({ relation, now = Date.now() } = {}) {
    this.evidence.push({
      at: now,
      entityId: relation?.id ?? null,
      intimacy: Math.round(Number(relation?.intimacy ?? 0)),
      signal: 'ignored',
      gapMs: 0,
      replyChars: 0,
      sharp: false,
      text: '',
    })
    if (this.evidence.length > MAX_EVIDENCE) this.evidence = this.evidence.slice(-MAX_EVIDENCE)
  }

  /** 不依赖模型的复盘：证据计数 → 少量、可解释的风格微调。 */
  learnFromEvidence({ now = Date.now() } = {}) {
    // 只消费上次复盘之后的新证据：同样的两句话不能被反复计入，
    // 否则每 6 小时复盘一次会把风格一路推到 0 或 1。
    const since = Math.max(now - 3 * DAY_MS, this.lastReviewAt ? this.lastReviewAt + 1 : 0)
    const rows = this.evidence.filter((item) => (item.at ?? 0) >= since)
    const count = { landed: 0, too_sharp: 0, too_long: 0, ignored: 0, neutral: 0 }
    for (const row of rows) if (row.signal in count) count[row.signal] += 1

    const changes = {}
    const add = (key, delta) => {
      if (!Number.isFinite(delta) || delta === 0) return
      const before = this.style[key]
      this.style[key] = clamp(before + delta, 0, 1)
      const applied = Number((this.style[key] - before).toFixed(4))
      if (applied) changes[key] = applied
    }
    const notes = []

    if (count.too_sharp >= 2 && count.too_sharp >= count.landed) {
      add('directness', -0.05)
      add('playfulness', -0.02)
      notes.push(this.addLesson('对还不熟的人，逗一下就够了，别往痛处戳', { confidence: 0.72, source: 'evidence', now }))
    }
    if (count.too_long >= 2 && count.too_long >= count.landed) {
      add('verbosity', -0.06)
      notes.push(this.addLesson('一次说两句就够，第三句留给他', { confidence: 0.66, source: 'evidence', now }))
    }
    if (count.ignored >= 2 && count.ignored >= count.landed) {
      add('initiative', -0.04)
      add('verbosity', -0.02)
      notes.push(this.addLesson('没人接的时候先放下，别追着解释', { confidence: 0.6, source: 'evidence', now }))
    }
    if (count.landed >= 3 && count.landed >= count.too_sharp + count.too_long) {
      this.selfEsteem = clamp(this.selfEsteem + 0.02, 0, 1)
      add('warmth', 0.01)
    }

    // 证据会过期；经验会缓慢失重，但不会因为一天没复盘就消失
    this.evidence = this.evidence.filter((item) => (item.at ?? 0) >= now - EVIDENCE_TTL).slice(-MAX_EVIDENCE)
    for (const lesson of this.lessons) {
      const ageDays = Math.max(0, now - (lesson.updatedAt ?? lesson.createdAt ?? now)) / DAY_MS
      if (ageDays > 1) lesson.weight = clamp(lesson.weight * Math.pow(0.985, ageDays), 0, 1)
    }
    this.lessons = this.lessons
      .filter((lesson) => lesson.weight >= 0.18 && now - (lesson.createdAt ?? now) <= LESSON_TTL)
      .slice(-MAX_LESSONS)

    this.reviews += 1
    this.lastReviewAt = now
    return {
      at: now,
      counts: count,
      changes,
      notes: notes.filter(Boolean).map((item) => item.text),
      lessons: this.lessons.length,
    }
  }

  /** 加一条经验：高度重合就加权，不重复堆同义句。 */
  addLesson(text, { confidence = 0.6, source = 'review', now = Date.now() } = {}) {
    const clean = textOf(text, 48)
    if (clean.length < 4) return null
    const existing = this.lessons.find((lesson) => overlap(lesson.text, clean) >= 0.55)
    if (existing) {
      existing.weight = clamp(existing.weight + 0.12, 0, 1)
      existing.confidence = Math.max(existing.confidence, clamp(confidence, 0, 1))
      existing.updatedAt = now
      existing.hits += 1
      return existing
    }
    const lesson = {
      id: `lesson_${Math.abs(hash(clean)).toString(16)}`,
      text: clean,
      weight: clamp(confidence, 0.2, 0.9),
      confidence: clamp(confidence, 0, 1),
      source,
      createdAt: now,
      updatedAt: now,
      hits: 0,
    }
    this.lessons.push(lesson)
    if (this.lessons.length > MAX_LESSONS) {
      this.lessons.sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt)
      this.lessons = this.lessons.slice(0, MAX_LESSONS)
    }
    return lesson
  }

  /** 模型复盘：只让它提建议，落库仍然走这里的限幅。 */
  async reviewWithLlm({ llm, provider, model, biography = {}, recent = [], now = Date.now() } = {}) {
    if (!llm || !provider || !model) return null
    const transcript = recent
      .slice(-24)
      .map((item) => {
        const who = item.role === 'self' ? '我' : `对方(${item.relationName ?? '某人'}·亲密${item.intimacy ?? 0})`
        return `${who}：${textOf(item.text, 60)}`
      })
      .join('\n')
    if (!transcript.trim()) return null
    const styleText = STYLE_KEYS.map((key) => `${STYLE_LABEL[key]} ${this.style[key].toFixed(2)}`).join(' / ')
    const system = [
      '你是「比宝」的元认知复盘器。你不改写她是谁，只根据真实对话帮她调整说话方式。',
      '只输出 JSON，不要解释、不要 markdown：',
      '{"observations":["她今天说话的一个具体模式，<=28字"],"lessons":[{"text":"可执行的经验，<=32字","confidence":0.0}],"style_delta":{"warmth":0.0,"playfulness":0.0,"directness":0.0,"verbosity":0.0,"vulnerability":0.0,"initiative":0.0}}',
      '规则：',
      '1. 1-2 条经验，必须来自对话里的具体证据，不要写"要做真实的自己"这种空话。',
      '2. style_delta 每项在 -0.05..0.05；没有把握就写 0。',
      '3. 不要把她的毒舌/嘴硬磨平，也不要把她改成客服；目标是更像一个活人，不是更礼貌。',
      '4. 不要建议她编造记忆，不要建议她提自己是 AI，不要碰她的核心经历。',
    ].join('\n')
    const user = [
      `身份：${biography.name ?? '比宝'}，${biography.ageNow ?? ''} 岁。${biography.oneLine ?? ''}`,
      `底色：${biography.coreWound ?? ''}；惯常应对：${biography.copingStyle ?? ''}`,
      `当前说话倾向：${styleText}`,
      this.lessons.length ? `已经学到的：${this.lessons.map((item) => item.text).join('；')}` : '已经学到的：还没有',
      '最近的对话：',
      transcript,
      '请只给 1-2 条这次真正学到的。',
    ].join('\n')

    let raw = ''
    try {
      const stream = llm.stream({
        provider,
        model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens: 900,
        temperature: 0.5,
        reasoningEffort: 'low',
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') raw += chunk.text
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') break
      }
    } catch {
      return null
    }
    const parsed = parseReviewJson(raw)
    if (!parsed) return null
    return this.applyReview(parsed, { now, raw })
  }

  /** 把模型建议落库：观察写进自我叙事，经验去重，风格限幅。 */
  applyReview(parsed = {}, { now = Date.now() } = {}) {
    const observations = (Array.isArray(parsed.observations) ? parsed.observations : [])
      .map((item) => textOf(item, 60))
      .filter(Boolean)
      .slice(0, 2)
    if (observations.length) {
      const line = observations.map((item) => `我发现自己${item.replace(/^(我|她)/, '')}`).join('；')
      this.narrative = textOf(`${this.narrative} ${line}`.trim(), 320)
    }

    const added = []
    const lessons = Array.isArray(parsed.lessons) ? parsed.lessons : []
    for (const raw of lessons.slice(0, 2)) {
      const text = typeof raw === 'string' ? raw : raw?.text
      const confidence = typeof raw === 'string' ? 0.55 : Number(raw?.confidence ?? 0.55)
      const lesson = this.addLesson(text, { confidence, source: 'llm', now })
      if (lesson) added.push(lesson.text)
    }

    const changes = {}
    const delta = parsed.style_delta && typeof parsed.style_delta === 'object' ? parsed.style_delta : {}
    for (const key of STYLE_KEYS) {
      const value = Number(delta[key])
      if (!Number.isFinite(value) || value === 0) continue
      const before = this.style[key]
      this.style[key] = clamp(before + clamp(value, -REVIEW_MAX_DELTA, REVIEW_MAX_DELTA), 0, 1)
      const applied = Number((this.style[key] - before).toFixed(4))
      if (applied) changes[key] = applied
    }
    this.lastReviewAt = now
    return { at: now, observations, lessons: added, changes, mood: 'self-review' }
  }

  /** 给提示词用的 2-4 条经验，不报权重数字。 */
  lessonsForPrompt(limit = 4) {
    return [...this.lessons]
      .filter((lesson) => lesson.weight >= 0.25)
      .sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((lesson) => lesson.text)
  }

  /** 把六维风格说成人话，别让模型照着数字演。 */
  styleLine() {
    const bits = []
    const { warmth, playfulness, directness, verbosity, vulnerability, initiative } = this.style
    if (warmth >= 0.68) bits.push('你现在愿意先给一点暖意，不那么端着')
    else if (warmth <= 0.35) bits.push('你还在收着，不轻易掏心')
    if (playfulness >= 0.68) bits.push('手有点痒，想逗人、想岔开话题')
    else if (playfulness <= 0.3) bits.push('今天没什么玩心，懒得接梗')
    if (directness >= 0.65) bits.push('说话偏直，不爱绕弯子')
    else if (directness <= 0.3) bits.push('就算不爽也先拐个弯，不把话说死')
    if (verbosity <= 0.35) bits.push('话比平时少，能一句说完就不说第二句')
    else if (verbosity >= 0.7) bits.push('话有点多，容易一口气说三句')
    if (vulnerability >= 0.65) bits.push('偶尔会漏一点真实情绪，不再全用刺挡着')
    if (initiative >= 0.65) bits.push('会主动起话头，不那么等着别人问')
    return bits.slice(0, 3).join('；')
  }

  snapshot() {
    return {
      narrative: this.narrative,
      style: Object.fromEntries(STYLE_KEYS.map((key) => [key, Number(this.style[key].toFixed(2))])),
      styleLine: this.styleLine(),
      lessons: this.lessons.map((lesson) => ({
        text: lesson.text,
        weight: Number(lesson.weight.toFixed(2)),
        confidence: Number(lesson.confidence.toFixed(2)),
        source: lesson.source,
        hits: lesson.hits,
      })),
      evidence: this.evidence.slice(-8).map((item) => ({
        at: item.at,
        signal: item.signal,
        intimacy: item.intimacy,
        text: item.text,
      })),
      counts: this.evidence.reduce((acc, item) => {
        acc[item.signal] = (acc[item.signal] ?? 0) + 1
        return acc
      }, {}),
      reviews: this.reviews,
      lastReviewAt: this.lastReviewAt,
      selfEsteem: Number(this.selfEsteem.toFixed(2)),
    }
  }

  toJSON() {
    return {
      narrative: this.narrative,
      style: { ...this.style },
      lessons: this.lessons,
      evidence: this.evidence.slice(-30),
      reviews: this.reviews,
      lastReviewAt: this.lastReviewAt,
      selfEsteem: this.selfEsteem,
    }
  }

  static fromJSON(json = {}) {
    return new SelfModel(json ?? {})
  }
}

export { REVIEW_MIN_GAP, REVIEW_MAX_DELTA, MAX_LESSONS, MAX_EVIDENCE }
