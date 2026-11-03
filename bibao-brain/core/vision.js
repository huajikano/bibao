/**
 * 视觉：把一张图交给"看得见"的模型，拿回一句话。
 *
 * 刻意不内置任何本地模型——只用你在 DSH 里已经配好的 OpenAI 兼容端点。
 * 图片只在本次调用里存在，不落盘；同一张图按内容哈希缓存，不重复花钱。
 */

import { createHash } from 'node:crypto'
import { estimateTokens } from './usage.js'

const MAX_BYTES = 8 * 1024 * 1024

export function createVision({ baseURL, apiKey, model, timeoutMs = 60000, onUsage = null } = {}) {
  const cache = new Map()
  const stats = { calls: 0, cached: 0, failed: 0, last: null }

  const endpoint = () => `${String(baseURL ?? '').replace(/\/+$/, '')}/chat/completions`

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
    async describe(url, { prompt = '用第一人称记下你看到的画面：谁、在哪、在做什么、有什么显眼的东西。60 字以内，只描述看到的，不要评价。', maxTokens = 200 } = {}) {
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
            reasoning_effort: 'low',
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
          signal: AbortSignal.timeout(timeoutMs),
        })
        const data = await res.json()
        const text = String(data?.choices?.[0]?.message?.content ?? '').trim()
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
