/**
 * 表情包收藏夹：她看见有趣的表情包就收起来，聊天时按情绪挑一张发出去。
 *
 * 只存文件和一句"梗概"，不存上下文；上限 120 张，超了淘汰用得最少的。
 */

import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const MAX = 120

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
    const item = { id: hash, file, ext, gist: String(gist).slice(0, 30), mood, text: String(text).slice(0, 20), addedAt: Date.now(), uses: 0 }
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
  async pick(mood, context = '') {
    await this.load()
    if (!this.items.length) return null
    const contextGrams = bigrams(context)
    const scored = this.items.map((item) => {
      const grams = bigrams(`${item.gist} ${item.text}`)
      let score = jaccard(contextGrams, grams) * 3.2
      if (item.mood === mood) score += 1.1
      score -= Math.min(0.9, (item.uses ?? 0) * 0.09)
      score += Math.random() * 0.5
      return { item, score }
    })
    scored.sort((a, b) => b.score - a.score)
    const chosen = scored[0].item
    chosen.uses = (chosen.uses ?? 0) + 1
    await this._flush()
    return chosen
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
    return { count: this.items.length, used: this.items.filter((item) => item.uses > 0).length }
  }
}
