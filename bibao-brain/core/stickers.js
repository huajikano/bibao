/**
 * 表情包收藏夹：她看见有趣的表情包就收起来，聊天时按情绪挑一张发出去。
 *
 * 只存文件和一句"梗概"，不存上下文；上限 120 张，超了淘汰用得最少的。
 */

import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_STICKER_BYTES, stickerImageType, stickerData } from './sticker-media.js'

const MAX = 120

export const STICKER_CATEGORIES = ['common', 'default', 'dusty']
export const STICKER_CATEGORY_LABELS = { common: '常用', default: '默认', dusty: '吃灰' }
const CATEGORY_BIAS = { common: 0.45, default: 0, dusty: -0.6 }

const REACTION_CUES = [
  ['安慰', /抱抱|心疼|辛苦了|别难过|摸摸头|加油|别自责|抱一下|安慰/],
  ['笑', /哈哈|笑死|笑出|好笑|搞笑|爆笑|笑到|笑哭|捂脸|乐死|憋不住笑|[😂🤣]/u],
  ['无语', /无语|离谱|尴尬|懵了|好累|叹气|翻白眼/],
  ['可爱', /可爱|卖萌|好乖|好萌|撒娇|比心|贴贴/],
]

export function reactionMood(text) {
  return REACTION_CUES.find(([, pattern]) => pattern.test(text))?.[0] ?? ''
}

export function stickerSummary(summary) {
  const name = String(summary ?? '').trim().replace(/^\[|\]$/g, '').trim()
  return /^(?:图片|表情|表情包|动画表情|自定义表情|商城表情|QQ 表情包|手动导入表情包)$/i.test(name) ? '' : name
}

function normalizeCategory(value) {
  const raw = String(value ?? '')
  return STICKER_CATEGORIES.includes(raw) ? raw : 'default'
}

function bigrams(text) {
  const clean = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const set = new Set()
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2))
  if (clean.length === 1) set.add(clean)
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const gram of a) if (b.has(gram)) hit += 1
  return hit / Math.min(a.size, b.size)
}
export class StickerBook {
  constructor(dir) {
    this.dir = dir
    this.indexFile = path.join(dir, 'index.json')
    this.items = []
    this.loaded = false
    this.writes = Promise.resolve()
  }

  load() {
    if (!this.loading) this.loading = this._load()
    return this.loading.then(() => this.items)
  }

  async _load() {
    if (this.loaded) return this.items
    try {
      await mkdir(this.dir, { recursive: true })
      const raw = await readFile(this.indexFile, 'utf8')
      const parsed = JSON.parse(raw)
      this.items = Array.isArray(parsed) ? parsed : []
    } catch {
      this.items = []
    }
    // 老存档没有分类：默认归"默认"；超过 30 天没用过自动进"吃灰"
    const now = Date.now()
    for (const item of this.items) {
      item.category = normalizeCategory(item.category)
      item.categoryManual = Boolean(item.categoryManual)
      if (!item.categoryManual) {
        if ((item.uses ?? 0) >= 3) item.category = 'common'
        else if ((item.uses ?? 0) === 0 && item.addedAt && now - item.addedAt > 30 * 24 * 60 * 60 * 1000) item.category = 'dusty'
      }
    }
    this.loaded = true
    return this.items
  }

  async _flush() {
    const temporary = `${this.indexFile}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(this.items.slice(-MAX)), 'utf8')
      await rename(temporary, this.indexFile)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  _mutate(operation) {
    const task = this.writes.then(async () => {
      await this.load()
      return operation()
    })
    this.writes = task.catch(() => {})
    return task
  }

  add(input) {
    return this._mutate(() => this._add(input))
  }

  async _add({ buffer, gist = '', mood = '日常', text = '', source = 'manual', privateTo = '' }) {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_STICKER_BYTES) return null
    const type = stickerImageType(buffer)
    if (!type) return null
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    const existing = this.items.find((item) => item.id === hash)
    if (existing) return { ...existing, dup: true }
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]
    const file = path.join(this.dir, `${hash}.${ext}`)
    await writeFile(file, buffer)
    const item = {
      id: hash,
      file,
      ext,
      gist: String(gist).slice(0, 30),
      mood,
      text: String(text).slice(0, 20),
      addedAt: Date.now(),
      uses: 0,
      category: 'default',
      categoryManual: false,
      source,
      ...(privateTo ? { privateTo } : {}),
    }
    const previous = this.items
    const next = [...previous, item]
    const victims = previous.length >= MAX ? [...previous].sort((a, b) => a.uses - b.uses || a.addedAt - b.addedAt).slice(0, next.length - MAX) : []
    this.items = next.filter((row) => !victims.includes(row))
    try {
      await this._flush()
    } catch (error) {
      this.items = previous
      await unlink(file).catch(() => {})
      throw error
    }
    for (const victim of victims) await this._removeFile(victim)
    return item
  }

  _file(item) {
    if (!/^[a-f0-9]{12}$/.test(item?.id) || !['png', 'jpg', 'gif', 'webp'].includes(item.ext)) return null
    return path.join(this.dir, `${item.id}.${item.ext}`)
  }

  async _removeFile(item) {
    const file = this._file(item)
    if (file) await unlink(file).catch(() => {})
  }

  async readImage(id) {
    const item = (await this.load()).find((row) => row.id === id)
    const file = this._file(item)
    if (!file) return null
    try {
      return stickerData({ buffer: await readFile(file) })
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  /**
   * 挑一张：情绪标签是底分，和当前对话的字面重合才是主要依据。
   * 用过很多次的会被压一点，避免翻来覆去就那几张。
   */
  async choose(mood, context = '', { privateTo = '', excludeId = '' } = {}) {
    await this.load()
    const pool = this.items.filter(item => item.category !== 'dusty' && item.id !== excludeId && (!item.privateTo || item.privateTo === privateTo))
    const contextGrams = bigrams(context)
    const scored = pool.map((item) => {
      const grams = bigrams(`${item.gist} ${item.text}`)
      const contextScore = jaccard(contextGrams, grams)
      const moodMatch = item.mood === mood
      let score = contextScore * 3.2
      if (moodMatch) score += 1.1
      score += CATEGORY_BIAS[item.category] ?? 0
      score -= Math.min(0.9, (item.uses ?? 0) * 0.09)
      // 只留极小的平局扰动；表情包合不合适由 mood + 上下文决定，不靠抽签
      score += Math.random() * 0.04
      return { item, score, contextScore, moodMatch }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0]
  }

  /**
   * 挑一张。minScore 是"恰到好处"的闸门：低于它就不发，宁可换个反应。
   */
  async pick(mood, context = '', { minScore = 0 } = {}) {
    const choice = await this.choose(mood, context)
    if (!choice || choice.score < minScore) return null
    return this.touch(choice.item.id)
  }

  /** Auto-reactions need a cue in this exchange. A general mood alone is not a match. */
  async chooseReaction({ incoming = '', reply = '', privateTo = '', excludeId = '' } = {}) {
    await this.load()
    const context = `${incoming}\n${reply}`.slice(0, 1200)
    if (/别发(?:了|图|表情)|不要发(?:图|表情)|急救|去世|葬礼|报警|受伤|自杀|骚扰|病危/.test(context)) return null
    const mood = reactionMood(reply) || reactionMood(incoming)
    const contextGrams = bigrams(context)
    let best = null
    for (const item of this.items) {
      if ((item.category === 'dusty' && item.categoryManual) || item.id === excludeId || (item.privateTo && item.privateTo !== privateTo)) continue
      const tags = bigrams([stickerSummary(item.gist), item.text].filter(Boolean).join(' '))
      const similar = jaccard(contextGrams, tags)
      const moodMatch = Boolean(mood && item.mood === mood)
      const topical = tags.size >= 2 && similar >= 0.32 && similar * Math.min(tags.size, contextGrams.size) >= 2
      if (!moodMatch && (!topical || (mood && item.mood !== '日常'))) continue
      const score = similar * 3.2 + (moodMatch ? 1.3 : 0) + (CATEGORY_BIAS[item.category] ?? 0) - Math.min(0.65, (item.uses ?? 0) * 0.07)
      if (!best || score > best.score) best = { item, score }
    }
    return best?.item ?? null
  }

  /** 记一次已确认的发送；非手动分类的图会随使用自动升到「常用」。 */
  touch(id) {
    return this._mutate(() => this._touch(id))
  }

  async _touch(id) {
    const item = this.items.find((row) => row.id === String(id))
    if (!item) return null
    item.uses = (item.uses ?? 0) + 1
    item.lastUsedAt = Date.now()
    if (!item.categoryManual) {
      if (item.uses >= 3) item.category = 'common'
      else if (item.category === 'dusty') item.category = 'default'
    }
    await this._flush()
    return { ...item }
  }

  /** 手动改描述/情绪/图上的字：自动识别只是草稿，最终解释权归用户。 */
  update(id, patch = {}) {
    return this._mutate(() => this._update(id, patch))
  }

  async _update(id, patch) {
    const item = this.items.find((row) => row.id === String(id))
    if (!item) return null
    if (typeof patch.gist === 'string') item.gist = patch.gist.trim().slice(0, 30)
    if (typeof patch.mood === 'string' && patch.mood.trim()) item.mood = patch.mood.trim().slice(0, 4)
    if (typeof patch.text === 'string') item.text = patch.text.trim().slice(0, 20)
    if (STICKER_CATEGORIES.includes(String(patch.category ?? ''))) {
      item.category = String(patch.category)
      item.categoryManual = true
    }
    item.updatedAt = Date.now()
    await this._flush()
    return { ...item }
  }

  remove(id) {
    return this._mutate(async () => {
      const item = this.items.find((row) => row.id === id)
      if (!item) return false
      const previous = this.items
      this.items = this.items.filter((row) => row.id !== id)
      try {
        await this._flush()
      } catch (error) {
        this.items = previous
        throw error
      }
      await this._removeFile(item)
      return true
    })
  }

  async stats() {
    await this.load()
    const byCategory = { common: 0, default: 0, dusty: 0 }
    for (const item of this.items) byCategory[normalizeCategory(item.category)] += 1
    return {
      count: this.items.length,
      used: this.items.filter((item) => item.uses > 0).length,
      byCategory,
    }
  }
}
