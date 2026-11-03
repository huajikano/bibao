/**
 * Token 用量计量。
 *
 * 两个来源：
 *  - 直连 OpenAI 兼容端点：优先读响应里的 usage；
 *  - DSH 当前默认模型：流式 chunk 里若有 usage 就记精确值，否则按文本估算。
 *
 * 估算是显式的：estimated=true，面板会标"含估算"，不把估算伪装成精确账单。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dayKey } from './clock.js'

const MAX_RECENT = 40
const MAX_DAYS = 30

export function estimateTokens(text = '') {
  const source = String(text ?? '')
  if (!source) return 0
  const cjk = (source.match(/[\u3400-\u9fff]/g) ?? []).length
  const words = (source.match(/[A-Za-z0-9_]+/g) ?? []).length
  const rest = Math.max(0, source.length - cjk - words)
  // 中文约 1 字 1 token，英文大约 1.3 token/词，符号/空白折半
  return Math.max(1, Math.ceil(cjk * 1.0 + words * 1.3 + rest * 0.3))
}

export function estimateMessages({ system = '', messages = [] } = {}) {
  const parts = [system]
  for (const message of messages ?? []) {
    const content = message?.content
    if (Array.isArray(content)) {
      for (const block of content) parts.push(block?.text ?? block?.content ?? '')
    } else {
      parts.push(content ?? message?.text ?? '')
    }
  }
  return estimateTokens(parts.join('\n'))
}

function zeroBucket() {
  return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, estimatedCalls: 0, latencyMs: 0 }
}

function emptyState() {
  return {
    version: 2,
    createdAt: Date.now(),
    total: zeroBucket(),
    today: { day: dayKey(Date.now()), ...zeroBucket() },
    byLogic: {},
    byModel: {},
    days: [],
    recent: [],
  }
}

function addInto(bucket, input, output, cacheRead, cacheCreation, latencyMs) {
  bucket.calls = (bucket.calls ?? 0) + 1
  bucket.input = (bucket.input ?? 0) + input
  bucket.output = (bucket.output ?? 0) + output
  bucket.cacheRead = (bucket.cacheRead ?? 0) + cacheRead
  bucket.cacheCreation = (bucket.cacheCreation ?? 0) + cacheCreation
  bucket.latencyMs = (bucket.latencyMs ?? 0) + latencyMs
}

export class TokenMeter {
  constructor({ file = null, state = null } = {}) {
    this.file = file
    this.data = state ? this._normalize(state) : emptyState()
    // 本次进程会话：不持久化，重启即重新开始
    this.session = { startedAt: Date.now(), ...zeroBucket() }
    this.loaded = false
    this.saveTimer = null
    this.saving = null
  }

  _normalize(raw) {
    const base = emptyState()
    const data = { ...base, ...(raw ?? {}) }
    data.total = { ...base.total, ...(raw?.total ?? {}) }
    data.today = { ...base.today, ...(raw?.today ?? {}) }
    data.byLogic = { ...(raw?.byLogic ?? {}) }
    data.byModel = { ...(raw?.byModel ?? {}) }
    data.days = Array.isArray(raw?.days) ? raw.days.slice(-MAX_DAYS) : []
    data.recent = Array.isArray(raw?.recent) ? raw.recent.slice(-MAX_RECENT) : []
    return data
  }

  async load() {
    if (this.loaded) return this
    this.loaded = true
    if (!this.file) return this
    try {
      this.data = this._normalize(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.data = emptyState()
    }
    this._ensureDay()
    return this
  }

  _ensureDay(at = Date.now()) {
    const key = dayKey(at)
    if (!this.data.today || this.data.today.day !== key) {
      if (this.data.today?.calls) this.data.days.push({ ...this.data.today })
      this.data.days = this.data.days.slice(-MAX_DAYS)
      this.data.today = { day: key, ...zeroBucket() }
    }
  }

  record({
    at = Date.now(),
    logic = 'unknown',
    provider = '',
    model = '',
    source = '',
    input = 0,
    output = 0,
    cacheRead = 0,
    cacheCreation = 0,
    latencyMs = 0,
    estimated = false,
  } = {}) {
    this._ensureDay(at)
    const inTokens = Math.max(0, Math.round(Number(input) || 0))
    const outTokens = Math.max(0, Math.round(Number(output) || 0))
    const readTokens = Math.max(0, Math.round(Number(cacheRead) || 0))
    const createdTokens = Math.max(0, Math.round(Number(cacheCreation) || 0))
    const latency = Math.max(0, Math.round(Number(latencyMs) || 0))
    const row = {
      at,
      logic: String(logic || 'unknown'),
      provider: String(provider || ''),
      model: String(model || ''),
      source: String(source || ''),
      input: inTokens,
      output: outTokens,
      cacheRead: readTokens,
      cacheCreation: createdTokens,
      latencyMs: latency,
      total: inTokens + outTokens + readTokens + createdTokens,
      estimated: Boolean(estimated),
    }
    this.data.total.calls += 1
    this.data.total.input += inTokens
    this.data.total.output += outTokens
    this.data.total.cacheRead += readTokens
    this.data.total.cacheCreation += createdTokens
    this.data.total.latencyMs += latency
    if (row.estimated) this.data.total.estimatedCalls += 1
    addInto(this.data.today, inTokens, outTokens, readTokens, createdTokens, latency)
    const logicKey = row.logic
    if (!this.data.byLogic[logicKey]) this.data.byLogic[logicKey] = zeroBucket()
    addInto(this.data.byLogic[logicKey], inTokens, outTokens, readTokens, createdTokens, latency)
    if (row.estimated) this.data.byLogic[logicKey].estimatedCalls += 1
    const modelKey = `${row.provider || 'unknown'}/${row.model || 'unknown'}`
    if (!this.data.byModel[modelKey]) this.data.byModel[modelKey] = zeroBucket()
    addInto(this.data.byModel[modelKey], inTokens, outTokens, readTokens, createdTokens, latency)
    if (row.estimated) this.data.byModel[modelKey].estimatedCalls += 1
    addInto(this.session, inTokens, outTokens, readTokens, createdTokens, latency)
    this.data.recent.push(row)
    this.data.recent = this.data.recent.slice(-MAX_RECENT)
    this.data.updatedAt = at
    this.scheduleSave()
    return row
  }

  snapshot(at = Date.now()) {
    this._ensureDay(at)
    const total = { ...this.data.total }
    const days = [...this.data.days]
    if (this.data.today.calls) days.push({ ...this.data.today })
    const tokensOf = (row) =>
      (row?.input ?? 0) + (row?.output ?? 0) + (row?.cacheRead ?? 0) + (row?.cacheCreation ?? 0)
    const totalTokens = tokensOf(total)
    const cacheBase = (total.input ?? 0) + (total.cacheRead ?? 0)
    return {
      total: { ...total, tokens: totalTokens },
      today: { ...this.data.today, tokens: tokensOf(this.data.today) },
      session: { ...this.session, tokens: tokensOf(this.session), uptimeSec: Math.max(0, Math.round((at - this.session.startedAt) / 1000)) },
      byLogic: Object.fromEntries(
        Object.entries(this.data.byLogic).map(([key, row]) => [key, { ...row, tokens: tokensOf(row) }]),
      ),
      byModel: Object.fromEntries(
        Object.entries(this.data.byModel).map(([key, row]) => [key, { ...row, tokens: tokensOf(row) }]),
      ),
      days: days.slice(-14),
      recent: this.data.recent.slice(-20).reverse(),
      estimated: total.estimatedCalls > 0,
      cacheHitRate: cacheBase ? Number(((total.cacheRead ?? 0) / cacheBase).toFixed(3)) : 0,
      avgLatencyMs: total.calls ? Math.round((total.latencyMs ?? 0) / total.calls) : 0,
      updatedAt: this.data.updatedAt ?? null,
      range: { days: days.length, since: days[0]?.day ?? null },
    }
  }

  reset() {
    this.data = emptyState()
    this.session = { startedAt: Date.now(), ...zeroBucket() }
    this.scheduleSave()
    return this.snapshot()
  }

  scheduleSave(delay = 600) {
    if (!this.file) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, delay)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  async save() {
    if (!this.file) return
    if (this.saving) return this.saving
    this.saving = (async () => {
      try {
        await mkdir(path.dirname(this.file), { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, JSON.stringify(this.data), 'utf8')
        await rename(tmp, this.file)
      } catch {
        /* 用量统计失败不影响大脑 */
      } finally {
        this.saving = null
      }
    })()
    return this.saving
  }

  toJSON() {
    return this.data
  }

  static fromJSON(json, file = null) {
    return new TokenMeter({ file, state: json })
  }
}

/**
 * 给 DSH 的 llm 服务套一层 stream 计量。
 * 有些 provider 不返回 usage，就按 system/messages 与输出文本估算。
 */
export function meterLlm(llm, { meter, logic, provider, model, source = 'dsh' } = {}) {
  if (!llm || typeof llm.stream !== 'function' || !meter) return llm
  return {
    ...llm,
    stream(options = {}) {
      const inputEstimate = estimateMessages(options)
      const startedAt = Date.now()
      return (async function* measured() {
        let text = ''
        let usage = null
        try {
          for await (const chunk of llm.stream(options)) {
            if (chunk?.type === 'text-delta' && chunk.text) text += chunk.text
            if (chunk?.usage) usage = chunk.usage
            if (chunk?.type === 'usage' && chunk.usage) usage = chunk.usage
            if (chunk?.type === 'finish' && chunk.usage) usage = chunk.usage
            yield chunk
          }
        } finally {
          const usageInput = usage?.prompt_tokens ?? usage?.input_tokens
          const cacheRead =
            Number(
              usage?.cache_read_input_tokens ??
                usage?.cache_read_tokens ??
                usage?.prompt_tokens_details?.cached_tokens ??
                usage?.input_tokens_details?.cached_tokens,
            ) || 0
          const cacheCreation = Number(usage?.cache_creation_input_tokens ?? usage?.cache_creation_tokens) || 0
          let input = Number(usageInput ?? inputEstimate) || 0
          // OpenAI 的 prompt_tokens 含缓存命中；Anthropic 的 input_tokens 不含
          if (usage?.prompt_tokens != null && cacheRead) input = Math.max(0, input - cacheRead)
          const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? estimateTokens(text)) || 0
          meter.record({
            logic,
            provider,
            model,
            source,
            input,
            output,
            cacheRead,
            cacheCreation,
            latencyMs: Date.now() - startedAt,
            estimated: !usage,
          })
        }
      })()
    },
  }
}
