/** 大材料分片暂存；只使用服务端生成的临时路径。JSON 分片低于常见 2MB 请求上限。 */
import { mkdtemp, writeFile, appendFile, readFile, rm, stat } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'

export const DISTILL_LIMITS = Object.freeze({ files: 32, fileBytes: 100 * 1024 * 1024, bytes: 200 * 1024 * 1024, chars: 200 * 1024 * 1024, chunk: 18000, uploadChunk: 384 * 1024, ttlMs: 2 * 60 * 60 * 1000 })
const formats = /\.(txt|md|markdown|json|jsonl|csv|html?|epub)$/i
export function stripMaterialHtml(html) {
  return html.replace(/<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(?:p|div|section|h[1-6]|li|tr)\s*>|<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      const known = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
      if (entity[0] !== '#') return known[entity.toLowerCase()] ?? ''
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }).replace(/\n[ \t]+/g, '\n').replace(/\n{4,}/g, '\n\n').trim()
}

function epubText(buffer) {
  // 读取 ZIP 中央目录，不解压至文件系统；限制解压大小，拒绝加密/ZIP64 材料。
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('EPUB 的 ZIP 目录损坏')
  const count = buffer.readUInt16LE(end + 10), directory = buffer.readUInt32LE(end + 16)
  if (count === 65535 || count > 20000 || directory >= buffer.length) throw new Error('EPUB 目录过大或使用了暂不支持的 ZIP64')
  const entries = new Map(); let cursor = directory, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('EPUB 文件目录不完整')
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24)
    const nameSize = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32), offset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8').replace(/\\/g, '/')
    cursor += 46 + nameSize + extra + comment
    if (!/\.(?:x?html?|xml|opf)$/i.test(name)) continue
    total += size
    if ((flags & 1) || ![0, 8].includes(method) || total > DISTILL_LIMITS.bytes || size > 20 * 1024 * 1024) throw new Error('EPUB 已加密、压缩方式不支持或解压文本过大')
    entries.set(path.posix.normalize(name), { offset, compressed, size, method })
  }
  const get = (name) => {
    const row = entries.get(path.posix.normalize(name)); if (!row) return ''
    if (row.offset + 30 > buffer.length || buffer.readUInt32LE(row.offset) !== 0x04034b50) throw new Error('EPUB 条目损坏')
    const start = row.offset + 30 + buffer.readUInt16LE(row.offset + 26) + buffer.readUInt16LE(row.offset + 28)
    if (start + row.compressed > buffer.length) throw new Error('EPUB 条目被截断')
    const raw = buffer.subarray(start, start + row.compressed)
    const data = row.method === 8 ? inflateRawSync(raw, { maxOutputLength: row.size + 1 }) : raw
    if (data.length !== row.size) throw new Error('EPUB 解压长度不一致')
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  }
  const attr = (tag, key) => tag.match(new RegExp(`\\b${key}=["']([^"']+)["']`, 'i'))?.[1] ?? ''
  const container = get('META-INF/container.xml')
  const root = attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '', 'full-path') || [...entries.keys()].find((name) => /\.opf$/i.test(name))
  const manifest = new Map(), ordered = []
  if (root) {
    const opf = get(root)
    for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
      const id = attr(match[0], 'id'), href = attr(match[0], 'href')
      if (id && href) manifest.set(id, path.posix.join(path.posix.dirname(root), decodeURIComponent(href.split('#')[0])))
    }
    for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) { const name = manifest.get(attr(match[0], 'idref')); if (name) ordered.push(name) }
  }
  const chapters = (ordered.length ? ordered : [...entries.keys()].filter((name) => /\.(?:x?html?)$/i.test(name)).sort()).map((name) => stripMaterialHtml(get(name))).filter(Boolean)
  if (!chapters.length) throw new Error('EPUB 中没有可读取的正文')
  return chapters.join('\n\n')
}

export function decodeMaterial(buffer, name, encoding = 'auto') {
  if (/\.epub$/i.test(name)) return epubText(buffer)
  let text
  const choices = encoding === 'auto' ? (buffer[0] === 0xff && buffer[1] === 0xfe ? ['utf-16le'] : buffer[0] === 0xfe && buffer[1] === 0xff ? ['utf-16be'] : ['utf-8', 'gb18030']) : [encoding]
  for (const choice of choices) { try { text = new TextDecoder(choice, { fatal: true }).decode(buffer); break } catch { /* 尝试下一编码 */ } }
  if (text === undefined || /\x00/.test(text)) throw new Error('无法识别文本编码，请手动选择 UTF-8、GB18030 或 UTF-16 LE')
  return /\.html?$/i.test(name) ? stripMaterialHtml(text) : text.replace(/^\uFEFF/, '')
}

export class MaterialUploads {
  constructor() { this.sessions = new Map(); this.pending = new Set(); this.root = null }
  async init(files, encoding = 'auto') {
    if (!Array.isArray(files) || !files.length || files.length > DISTILL_LIMITS.files) throw new Error('一次支持 1–32 份素材')
    if (this.sessions.size >= 2) throw new Error('已有两批待解析的上传，请先清理旧素材')
    let total = 0
    for (const file of files) {
      if (!formats.test(String(file?.name))) throw new Error('支持 TXT、MD、EPUB、HTML、JSON、JSONL、CSV；聊天数据库需先导出')
      if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > DISTILL_LIMITS.fileBytes) throw new Error('单份素材须在 1B–100MB 之间')
      total += file.size
    }
    if (total > DISTILL_LIMITS.bytes) throw new Error('一批素材总大小不能超过 200MB')
    if (!this.root) this.root = mkdtemp(path.join(os.tmpdir(), 'bibao-materials-'))
    const root = await this.root, id = randomUUID()
    const rows = files.map((file, index) => ({ id: index, name: String(file.name).slice(0, 160), size: file.size, received: 0, encoding: file.encoding || encoding, file: path.join(root, `${id}-${index}.part`), busy: false, previous: null }))
    await Promise.all(rows.map((row) => writeFile(row.file, Buffer.alloc(0), { flag: 'wx' })))
    this.sessions.set(id, { id, at: Date.now(), rows, busy: false })
    return { uploadId: id, chunkBytes: DISTILL_LIMITS.uploadChunk, files: rows.map(({ file, previous, ...row }) => row) }
  }
  async chunk({ uploadId, fileId, offset, data }) {
    const session = this.sessions.get(uploadId), row = session?.rows.find((item) => item.id === fileId)
    if (!row || session.busy) throw new Error('上传不存在、正在解析或已过期')
    if (row.busy) throw new Error('同一文件上一分片尚未完成')
    if (typeof data !== 'string' || !data || data.length > Math.ceil(DISTILL_LIMITS.uploadChunk / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('上传分片无效或过大')
    const bytes = Buffer.from(data, 'base64'), hash = createHash('sha256').update(bytes).digest('hex')
    if (!bytes.length || bytes.length > DISTILL_LIMITS.uploadChunk || !Number.isSafeInteger(offset)) throw new Error('分片位置或长度不合法')
    if (row.previous?.offset === offset && row.previous.hash === hash) return { received: row.received }
    if (offset !== row.received || offset + bytes.length > row.size) throw new Error(`上传位置不匹配，当前应为 ${row.received}`)
    row.busy = true
    try {
      await appendFile(row.file, bytes)
      row.received += bytes.length; row.previous = { offset, hash }; session.at = Date.now()
      return { received: row.received }
    } finally { row.busy = false }
  }
  async complete(id, consume) {
    const session = this.sessions.get(id)
    if (!session || session.busy || session.rows.some((row) => row.busy || row.received !== row.size)) throw new Error('素材尚未全部上传，或正在解析')
    session.busy = true
    try {
      const sources = []
      for (const row of session.rows) {
        const info = await stat(row.file)
        if (info.size !== row.size) throw new Error('上传文件长度不一致')
        sources.push({ name: row.name, text: decodeMaterial(await readFile(row.file), row.name, row.encoding), decoded: true })
      }
      return await consume(sources)
    } finally { session.busy = false; await this.remove(id) }
  }
  async remove(id) {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.busy || session.rows.some((row) => row.busy)) throw new Error('正在处理这批素材，请稍后清理')
    this.sessions.delete(id)
    // 路径只来自本实例 mkdtemp + UUID，从不接受客户端提供的磁盘路径。
    await Promise.all(session.rows.map((row) => rm(row.file, { force: true })))
  }
  sweep() {
    for (const [id, session] of this.sessions) if (!session.busy && !session.rows.some((row) => row.busy) && session.at < Date.now() - DISTILL_LIMITS.ttlMs) {
      const task = this.remove(id).catch(() => {}).finally(() => this.pending.delete(task)); this.pending.add(task)
    }
  }
  async dispose() {
    await Promise.allSettled([...this.pending])
    if (this.root) { const root = await this.root; await rm(root, { recursive: true, force: true }) }
    this.sessions.clear()
  }
}
