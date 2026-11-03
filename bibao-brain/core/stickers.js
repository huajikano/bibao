/**
 * 表情包收藏夹：她看见有趣的表情包就收起来，聊天时按情绪挑一张发出去。
 *
 * 只存文件和一句"梗概"，不存上下文；上限 120 张，超了淘汰用得最少的。
 */

import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const MAX = 120

export const STICKER_CATEGORIES = ['common', 'default', 'dusty']
export const STICKER_CATEGORY_LABELS = { common: '常用', default: '默认', dusty: '吃灰' }
const CATEGORY_BIAS = { common: 0.45, default: 0, dusty: -0.6 }

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
const MAX_BYTES = 3 * 1024 * 1024

export class StickerBook {
  constructor(dir) {
    this.dir = dir
    this.indexFile = path.join(dir, 'index.json')
    this.items = []
    this.loaded = false
  }

  async load() {
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
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.indexFile, JSON.stringify(this.items.slice(-MAX), null, 0), 'utf8')
  }

  async add({ buffer, type = 'image/png', gist = '', mood = '日常', text = '' }) {
    await this.load()
    if (!buffer || buffer.length > MAX_BYTES) return null
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    if (this.items.some((item) => item.id === hash)) return { ...this.items.find((item) => item.id === hash), dup: true }
    const ext = type.includes('gif') ? 'gif' : type.includes('jpeg') ? 'jpg' : 'png'
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
    }
    this.items.push(item)
    if (this.items.length > MAX) {
      const victims = [...this.items].sort((a, b) => a.uses - b.uses).slice(0, this.items.length - MAX)
      for (const victim of victims) {
        this.items = this.items.filter((row) => row.id !== victim.id)
        await unlink(victim.file).catch(() => {})
      }
    }
    await this._flush()
    return item
  }

  /**
   * 挑一张：情绪标签是底分，和当前对话的字面重合才是主要依据。
   * 用过很多次的会被压一点，避免翻来覆去就那几张。
   */
  async choose(mood, context = '') {
    await this.load()
    if (!this.items.length) return null
    const contextGrams = bigrams(context)
    // 吃灰图默认不参与自动挑图；只有所有图都吃灰时才兜底
    const active = this.items.filter((item) => (item.category ?? 'default') !== 'dusty')
    const pool = active.length ? active : this.items
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

  /** 记一次使用；非手动分类的图会随使用自动升到"常用"。 */
  async touch(id) {
    await this.load()
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
  async update(id, patch = {}) {
    await this.load()
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

  async remove(id) {
    await this.load()
    const item = this.items.find((row) => row.id === id)
    if (!item) return false
    this.items = this.items.filter((row) => row.id !== id)
    await unlink(item.file).catch(() => {})
    await this._flush()
    return true
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
