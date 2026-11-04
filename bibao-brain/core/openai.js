/**
 * 直连 OpenAI 兼容端点（DeepSeek / 任意中转站）。
 *
 * 只在用户自己填了 baseURL + apiKey 时启用；否则用 DSH 当前默认模型的 llm 服务。
 * 这一层只负责"把 prompt 变成文本"，所有钳制仍在 prefrontal.normalizeDualTrack。
 */

import { estimateTokens } from './usage.js'

export async function chatCompletion({
  baseURL,
  apiKey,
  model,
  system,
  user,
  maxTokens = 500,
  temperature = 0.9,
  reasoningEffort = '',
  signal,
  timeoutMs = 90_000,
  onUsage = null,
}) {
  if (!baseURL || !apiKey || !model) throw new Error('缺少 baseURL / apiKey / model')
  const startedAt = Date.now()
  const endpoint = String(baseURL).trim().replace(/\/+$/, '')
  // 既接受 baseURL（自动补 /chat/completions），也接受用户直接粘贴完整 URL
  const url = /\/chat\/completions$/i.test(endpoint) ? endpoint : `${endpoint}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  signal?.addEventListener?.('abort', () => controller.abort(), { once: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        stream: false,
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 160)}`)
    }
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`LLM 返回非 JSON：${text.slice(0, 120)}`)
    }
    const message = data?.choices?.[0]?.message ?? {}
    const content = message.content
    let reply = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part?.text ?? '').join('') : ''
    // 推理型模型有时把正文放在 reasoning_content 里，content 为 null
    if (!reply.trim()) reply = String(message.reasoning_content ?? message.reasoning ?? '')
    if (!reply.trim()) throw new Error('LLM 返回里既没有 content 也没有 reasoning')
    const usage = data?.usage ?? data?.choices?.[0]?.usage ?? null
    const cacheRead =
      Number(
        usage?.cache_read_input_tokens ??
          usage?.cache_read_tokens ??
          usage?.prompt_tokens_details?.cached_tokens ??
          usage?.input_tokens_details?.cached_tokens,
      ) || 0
    const cacheCreation = Number(usage?.cache_creation_input_tokens ?? usage?.cache_creation_tokens) || 0
    let input = Number(usage?.prompt_tokens ?? usage?.input_tokens) || estimateTokens(`${system ?? ''}\n${user ?? ''}`)
    if (usage?.prompt_tokens != null && cacheRead) input = Math.max(0, input - cacheRead)
    const output = Number(usage?.completion_tokens ?? usage?.output_tokens) || estimateTokens(reply)
    try {
      onUsage?.({
        model,
        input,
        output,
        cacheRead,
        cacheCreation,
        latencyMs: Date.now() - startedAt,
        total: input + output + cacheRead + cacheCreation,
        estimated: !usage,
        raw: usage,
      })
    } catch {
      /* 统计失败不影响回复 */
    }
    return reply
  } finally {
    clearTimeout(timer)
  }
}

/** 把直连端点包装成 llm 服务的形状，复用同一条双轨生成路径。 */
export function createDirectLlm(config) {
  return {
    direct: true,
    async *stream(options) {
      const user = (options.messages ?? [])
        .map((message) =>
          Array.isArray(message.content)
            ? message.content.map((block) => block?.text ?? '').join('')
            : String(message.content ?? ''),
        )
        .join('\n')
      const text = await chatCompletion({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
        system: options.system ?? '',
        user,
        maxTokens: options.maxTokens ?? 500,
        reasoningEffort: options.reasoningEffort,
        temperature: options.temperature ?? 0.9,
        signal: options.signal,
        onUsage: config.onUsage,
      })
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}
