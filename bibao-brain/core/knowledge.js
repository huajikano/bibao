/**
 * 她自己的知识库。
 *
 * 不是 RAG 式的"贴一段资料给模型"，而是把文件切成有标题、有出处的小块，
 * 检索后只把最相关的几块交给她，像"以前确实学过/读过"一样自然带出来。
 * 支持 .md / .txt / .json；默认关闭，由白名单式开关控制。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_CHUNK_CHARS = 720
const MAX_CHUNKS = 3000

function clean(text = '') {
  return String(text).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function bigrams(text) {
  const value = clean(text).toLowerCase()
  const grams = new Set()
  const cjk = value.match(/[\u3400-\u9fff]/g) ?? []
  for (let index = 0; index < cjk.length - 1; index += 1) grams.add(cjk[index] + cjk[index + 1])
  for (const word of value.match(/[a-z0-9_]{2,}/g) ?? []) grams.add(word)
  return grams
}

function chunkText(text, { source, title }) {
  const body = clean(text)
  if (!body) return []
  const paragraphs = body.split(/\n\s*\n+/).map(clean).filter(Boolean)
  const chunks = []
  let current = ''
  let heading = title
  const push = () => {
    if (!current.trim()) return
    chunks.push({
      title: heading || title,
      source,
      text: current.trim().slice(0, MAX_CHUNK_CHARS * 2),
      grams: bigrams(current),
    })
    current = ''
  }
  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)/)
    if (headingMatch) {
      push()
      heading = clean(headingMatch[1]).slice(0, 60)
      continue
    }
    if (current && current.length + paragraph.length > MAX_CHUNK_CHARS) push()
    current += `${current ? '\n' : ''}${paragraph}`
    if (current.length >= MAX_CHUNK_CHARS) push()
  }
  push()
  return chunks
}

function flattenJson(value, depth = 0) {
  if (depth > 4 || value == null) return []
  if (typeof value === 'string') return clean(value) ? [clean(value)] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => flattenJson(item, depth + 1))
  if (typeof value === 'object') {
    const preferred = ['title', 'name', 'question', 'q', 'content', 'text', 'body', 'answer', 'a', 'description']
    const parts = []
    for (const key of preferred) if (typeof value[key] === 'string') parts.push(value[key])
    if (parts.length) return [clean(parts.join('：'))]
    return Object.values(value).flatMap((item) => flattenJson(item, depth + 1))
  }
  return []
}

async function walkFiles(dir, prefix = '', depth = 0) {
  if (depth > 2) return []
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await walkFiles(full, rel, depth + 1)))
    else if (/\.(md|txt|json)$/i.test(entry.name)) out.push({ full, rel })
  }
  return out
}

export class KnowledgeBase {
  constructor({ dir = '', maxSnippets = 3, maxChars = 900 } = {}) {
    this.dir = String(dir || '')
    this.maxSnippets = Math.max(1, Math.min(5, Number(maxSnippets) || 3))
    this.maxChars = Math.max(200, Math.min(3000, Number(maxChars) || 900))
    this.files = []
    this.chunks = []
    this.loadedAt = 0
    this.error = ''
    this.enabled = false
  }

  async load() {
    this.files = []
    this.chunks = []
    this.error = ''
    if (!this.dir) {
      this.loadedAt = Date.now()
      return this
    }
    try {
      await mkdir(this.dir, { recursive: true })
      for (const file of await walkFiles(this.dir)) {
        try {
          const info = await stat(file.full)
          if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
          const raw = await readFile(file.full, 'utf8')
          let pieces = []
          if (file.rel.endsWith('.json')) pieces = flattenJson(JSON.parse(raw))
          else pieces = [raw]
          const title = path.basename(file.rel, path.extname(file.rel))
          for (const piece of pieces) {
            for (const chunk of chunkText(piece, { source: file.rel, title })) {
              if (this.chunks.length >= MAX_CHUNKS) break
              this.chunks.push({ ...chunk, id: createHash('sha1').update(`${file.rel}:${this.chunks.length}`).digest('hex').slice(0, 12) })
            }
          }
          this.files.push({ source: file.rel, bytes: info.size })
        } catch {
          /* 单个坏文件不拖垮整个知识库 */
        }
      }
      this.loadedAt = Date.now()
    } catch (error) {
      this.error = String(error?.message ?? error).slice(0, 120)
    }
    return this
  }

  status() {
    return {
      dir: this.dir,
      files: this.files.length,
      chunks: this.chunks.length,
      loadedAt: this.loadedAt,
      error: this.error,
      enabled: this.enabled !== false,
    }
  }

  search(query, { limit = this.maxSnippets } = {}) {
    const terms = bigrams(query)
    if (!terms.size || !this.chunks.length) return []
    const scored = this.chunks.map((chunk) => {
      let overlap = 0
      for (const term of terms) if (chunk.grams.has(term)) overlap += 1
      const text = chunk.text.toLowerCase()
      const phrase = String(query).trim().toLowerCase()
      const phraseScore = phrase.length >= 2 && text.includes(phrase) ? 0.6 : 0
      const titleScore = [...terms].filter((term) => chunk.title.toLowerCase().includes(term)).length * 0.08
      const score = overlap / terms.size + phraseScore + titleScore
      return { ...chunk, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored
      .filter((item) => item.score > 0.08)
      .slice(0, Math.max(1, Math.min(5, Number(limit) || this.maxSnippets)))
      .map(({ grams, ...item }) => ({ ...item, score: Number(item.score.toFixed(3)) }))
  }

  /** 给提示词的形态：像回忆，不像资料粘贴。 */
  format(items = [], { maxChars = this.maxChars } = {}) {
    const picked = items.slice(0, 5)
    if (!picked.length) return ''
    let used = 0
    const lines = []
    for (const item of picked) {
      const snippet = item.text.replace(/\s+/g, ' ').slice(0, Math.max(80, Math.min(360, Math.floor(maxChars / picked.length))))
      if (used + snippet.length > maxChars && lines.length) break
      lines.push(`- ${item.title}${item.source ? `（${item.source}）` : ''}：${snippet}`)
      used += snippet.length
    }
    return lines.length
      ? `你确实知道这些，不是刚查的资料，是你以前读过/学过的：\n${lines.join('\n')}\n用的时候像自己的知识一样自然带出来；不要逐字背，也不要假装比资料知道得更多。`
      : ''
  }

  async importText({ name = '', text = '' } = {}) {
    const body = String(text ?? '')
    if (!body.trim()) throw new Error('知识内容为空')
    if (body.length > MAX_FILE_BYTES) throw new Error('知识文件太大')
    await mkdir(this.dir, { recursive: true })
    const base = path.basename(String(name || 'knowledge.txt')).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 80)
    const filename = /\.(md|txt|json)$/i.test(base) ? base : `${base}.md`
    const target = path.join(this.dir, filename)
    await writeFile(target, body, 'utf8')
    await this.load()
    return { file: filename, ...this.status() }
  }
}
