/**
 * 视觉：把一张图交给"看得见"的模型，拿回一句话。
 *
 * 刻意不内置任何本地模型——只用你在 DSH 里已经配好的 OpenAI 兼容端点。
 * 图片只在本次调用里存在，不落盘；同一张图按内容哈希缓存，不重复花钱。
 */

import { createHash } from 'node:crypto'
import { estimateTokens, safeReasoningOptions } from './usage.js'
const MAX_BYTES = 8 * 1024 * 1024

export function createVision({ baseURL, apiKey, model, timeoutMs = 60000, onUsage = null } = {}) {  const cache = new Map()
  const stats = { calls: 0, cached: 0, failed: 0, last: null }

  const endpoint = () => {
    const value = String(baseURL ?? '').trim().replace(/\/+$/, '')
    return /\/chat\/completions$/i.test(value) ? value : `${value}/chat/completions`
  }

  function parseModelResponse(raw) {
    const text = String(raw ?? '').trim()
    try {
      return JSON.parse(text)
    } catch {
      /* 继续尝试宽松解析 */
    }
    // 有的中转站会返回 SSE 行，或者 JSON 后面又跟了一段文本
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]')
    if (dataLines.length) {
      const pieces = []
      for (const line of dataLines) {
        try {
          const chunk = JSON.parse(line)
          const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content
          if (delta) pieces.push(String(delta))
        } catch {
          /* 跳过坏的 SSE 行 */
        }
      }
      if (pieces.length) return { choices: [{ message: { content: pieces.join('') } }] }
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fenced?.[1] ?? text
    // 有的中转站会把两个 JSON 对象直接拼在一起；逐个用大括号扫描，取第一个能用的
    const objects = []
    for (let start = candidate.indexOf('{'); start >= 0; start = candidate.indexOf('{', start + 1)) {
      let depth = 0
      let quoted = false
      let escaped = false
      for (let index = start; index < candidate.length; index += 1) {
        const char = candidate[index]
        if (quoted) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') quoted = false
          continue
        }
        if (char === '"') quoted = true
        else if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) {
            try {
              const parsed = JSON.parse(candidate.slice(start, index + 1))
              if (parsed && typeof parsed === 'object') objects.push(parsed)
            } catch {
              /* 跳过坏对象 */
            }
            break
          }
        }
      }
      if (objects.length) break
    }
    if (objects.length) return objects[0]
    // 视觉端点偶尔直接回一段描述文字，不强行要求 JSON
    if (text && !text.startsWith('{') && !text.startsWith('[')) {
      return { choices: [{ message: { content: text } }] }
    }
    throw new Error(`视觉返回不是合法 JSON：${text.slice(0, 120)}`)
  }

  async function fetchImage(url) {
    if (String(url).startsWith('data:')) {
      const [head, body] = String(url).split(',')
      return { dataUrl: String(url), buffer: Buffer.from(body, 'base64'), type: (head.match(/data:([^;]+)/) ?? [])[1] ?? 'image/png' }
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`图片下载失败 ${res.status}`)
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_BYTES) throw new Error('图片太大')
    if (!/^image\//.test(type)) throw new Error(`不是图片：${type}`)
    return { dataUrl: `data:${type};base64,${buffer.toString('base64')}`, buffer, type }
  }

  return {
    stats,
    get enabled() {
      return Boolean(baseURL && apiKey && model)
    },
    async describe(url, { prompt = '用第一人称记下你看到的画面：谁、在哪、在做什么、有什么显眼的东西。60 字以内，只描述看到的，不要评价。', maxTokens = 200, reasoningEffort = 'low', signal } = {}) {
      if (!this.enabled) throw new Error('视觉模型没配置')
      const fetched = await fetchImage(url)
      const dataUrl = fetched.dataUrl
      // 同一张图、不同问题要分别缓存，否则会拿上次的答案
      const hash = createHash('sha1').update(prompt + '|' + dataUrl).digest('hex').slice(0, 16)
      if (cache.has(hash)) {
        stats.cached += 1
        return { text: cache.get(hash), cached: true, buffer: fetched.buffer, type: fetched.type }
      }
      stats.calls += 1
      const startedAt = Date.now()
      try {
        const res = await fetch(endpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            stream: false,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        })
        const raw = await res.text()
        if (!res.ok) throw new Error(`视觉 HTTP ${res.status}: ${raw.slice(0, 160)}`)
        const data = parseModelResponse(raw)
        const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text
        const text = (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part?.text ?? '').join('') : '').trim()
        if (!text) throw new Error(data?.error?.message ?? '模型没有返回内容')
        const clean = text.replace(/\s+/g, ' ').slice(0, 1600)
        const usage = data?.usage ?? null
        const cacheRead =
          Number(
            usage?.cache_read_input_tokens ??
              usage?.cache_read_tokens ??
              usage?.prompt_tokens_details?.cached_tokens ??
              usage?.input_tokens_details?.cached_tokens,
          ) || 0
        const cacheCreation = Number(usage?.cache_creation_input_tokens ?? usage?.cache_creation_tokens) || 0
        let input = Number(usage?.prompt_tokens ?? usage?.input_tokens) || estimateTokens(prompt)
        if (usage?.prompt_tokens != null && cacheRead) input = Math.max(0, input - cacheRead)
        try {
          onUsage?.({
            model,
            input,
            output: Number(usage?.completion_tokens ?? usage?.output_tokens) || estimateTokens(clean),
            cacheRead,
            cacheCreation,
            latencyMs: Date.now() - startedAt,
            estimated: !usage,
            raw: usage,
          })
        } catch {
          /* 统计失败不影响视觉 */
        }
        cache.set(hash, clean)
        if (cache.size > 200) cache.delete(cache.keys().next().value)
        stats.last = { text: clean, at: Date.now(), hash }
        return { text: clean, cached: false, buffer: fetched.buffer, type: fetched.type }
      } catch (error) {
        stats.failed += 1
        throw error
      }
    },
  }
}

/**
 * 视觉走 DSH：把图片存成附件，再用 llm.stream 让 DSH 里已登录的模型看图。
 * 不需要另填 baseURL / apiKey。
 */
export function createDshVision({ llm, attachments, provider, model, timeoutMs = 60000, onUsage = null } = {}) {
  const cache = new Map()
  const stats = { calls: 0, cached: 0, failed: 0, last: null }

  async function toAttachment(mediaType, buffer, name = 'screenshot') {
    if (!attachments?.saveImage) throw new Error('当前 DSH 没有提供附件服务，无法把图片交给视觉模型')
    return attachments.saveImage({ data: new Uint8Array(buffer), mediaType, name })
  }

  return {
    stats,
    get enabled() {
      return Boolean(llm && provider && model && attachments)
    },
    async describe(url, { prompt = '用第一人称记下你看到的画面：谁、在哪、在做什么、有什么显眼的东西。60 字以内，只描述看到的，不要评价。', maxTokens = 200, signal } = {}) {
      if (!this.enabled) throw new Error('视觉模型没配置')
      let buffer
      let type
      if (String(url).startsWith('data:')) {
        const [head, body] = String(url).split(',')
        type = (head.match(/data:([^;]+)/) ?? [])[1] ?? 'image/png'
        buffer = Buffer.from(body, 'base64')
      } else {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!res.ok) throw new Error(`图片下载失败 ${res.status}`)
        type = res.headers.get('content-type') ?? 'image/jpeg'
        buffer = Buffer.from(await res.arrayBuffer())
      }
      if (!/^image\//.test(type)) throw new Error(`不是图片：${type}`)
      if (buffer.length > MAX_BYTES) throw new Error('图片太大')
      const hash = createHash('sha1').update(prompt + '|' + provider + '|' + model + '|').update(buffer).digest('hex').slice(0, 16)
      if (cache.has(hash)) {
        stats.cached += 1
        return { text: cache.get(hash), cached: true, buffer, type }
      }
      stats.calls += 1
      const startedAt = Date.now()
      try {
        const attachment = await toAttachment(type, buffer)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
        const abort = () => controller.abort()
        signal?.addEventListener?.('abort', abort, { once: true })
        const pieces = []
        const blockPieces = []
        try {
          const reasoning = await safeReasoningOptions(llm, { provider, model }, 'low')
          for await (const chunk of llm.stream({
            provider,
            model,
            stream: true,
            maxTokens,
            ...reasoning,
            signal: controller.signal,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', attachment }] }],
          })) {
            if (chunk?.type === 'text-delta' && chunk.text) pieces.push(String(chunk.text))
            if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && chunk.block.text) blockPieces.push(String(chunk.block.text))
            if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
              const reason = chunk.reason.failure
              throw new Error(`${reason?.code ?? 'llm-error'}: ${String(reason?.message ?? '').slice(0, 160)}`)
            }
          }
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener?.('abort', abort)
        }
        // 有增量就只用增量，避免和整块文本重复
        const streamed = pieces.join('')
        const text = (streamed.trim() ? streamed : blockPieces.join('')).replace(/\s+/g, ' ').trim().slice(0, 1600)
        if (!text) throw new Error('模型没有返回内容')
        cache.set(hash, text)
        if (cache.size > 200) cache.delete(cache.keys().next().value)
        stats.last = { text, at: Date.now(), hash }
        try {
          onUsage?.({ model, input: Math.max(1, Math.round(buffer.length / 4)), output: text.length, latencyMs: Date.now() - startedAt, estimated: true })
        } catch {
          /* 统计失败不影响视觉 */
        }
        return { text, cached: false, buffer, type }
      } catch (error) {
        stats.failed += 1
        throw error
      }
    },
  }
}
