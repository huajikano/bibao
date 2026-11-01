/**
 * 直连 OpenAI 兼容端点（DeepSeek / 任意中转站）。
 *
 * 只在用户自己填了 baseURL + apiKey 时启用；否则用 DSH 当前默认模型的 llm 服务。
 * 这一层只负责"把 prompt 变成文本"，所有钳制仍在 prefrontal.normalizeDualTrack。
 */

export async function chatCompletion({
  baseURL,
  apiKey,
  model,
  system,
  user,
  maxTokens = 500,
  temperature = 0.9,
  signal,
  timeoutMs = 45_000,
}) {
  if (!baseURL || !apiKey || !model) throw new Error('缺少 baseURL / apiKey / model')
  const url = `${String(baseURL).replace(/\/+$/, '')}/chat/completions`
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
    const content = data?.choices?.[0]?.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('')
    throw new Error('LLM 返回里没有 choices[0].message.content')
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
        temperature: options.temperature ?? 0.9,
        signal: options.signal,
      })
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}
