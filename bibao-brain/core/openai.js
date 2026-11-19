/**
 * 直连 OpenAI 兼容端点（DeepSeek / 任意中转站）。
 *
 * 只在用户自己填了 baseURL + apiKey 时启用；否则用 DSH 当前默认模型的 llm 服务。
 * 这一层只负责"把 prompt 变成文本"，所有钳制仍在 prefrontal.normalizeDualTrack。
 */

import { estimateTokens } from './usage.js'
import { parseDirectReply } from './distill-direct-response.js'
import { directReasoningProtocol, directGenerationOptions } from './distill-direct-options.js'
import { DEFAULT_MODEL_TIMEOUT_MS, modelTimeout, normalizeModelAbort } from './llm-control.js'

export async function chatCompletion({
  baseURL,
  apiKey,
  model,
  system,
  user,
  maxTokens = 500,
  temperature = 0.9,
  reasoningEffort = '',
  stream = false,
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
  onUsage = null,
}) {
  if (!baseURL || !apiKey || !model) throw new Error('缺少 baseURL / apiKey / model')
  const startedAt = Date.now()
  const endpoint = String(baseURL).trim().replace(/\/+$/, '')
  // 既接受 baseURL（自动补 /chat/completions），也接受用户直接粘贴完整 URL
  const url = /\/chat\/completions$/i.test(endpoint) ? endpoint : `${endpoint}/chat/completions`
  const controller = new AbortController()
  const limit = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_MODEL_TIMEOUT_MS
  if (signal?.aborted) throw normalizeModelAbort(signal.reason, { signal, timeoutMs: limit })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort(modelTimeout(limit)) }, limit)
  if (typeof timer.unref === 'function') timer.unref()
  const cancel = () => controller.abort(signal.reason)
  signal?.addEventListener?.('abort', cancel, { once: true })
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
        ...directGenerationOptions({baseURL,model,reasoningEffort,temperature,maxTokens,nativeOptions:Boolean(stream)}),
        stream: Boolean(stream),
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      const error = new Error(`LLM HTTP ${response.status}: ${text.split(String(apiKey)).join('[密钥已隐藏]').slice(0, 160)}`)
      if ([400,422].includes(response.status)) error.code='LLM_REQUEST_REJECTED'
      if ([400,422].includes(response.status) && /reasoning[_ -]?effort|unsupported.*reasoning/i.test(text)) { error.code='LLM_REASONING_UNSUPPORTED';error.message='当前端点不接受所选思考强度，请选择模型默认或该端点支持的强度' }
      throw error
    }
    const {reply,data} = parseDirectReply(text,{strictFinal:Boolean(stream)})
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
  } catch (error) {
    throw normalizeModelAbort(error, { signal, timedOut, timeoutMs: limit })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', cancel)
  }
}

/** 把直连端点包装成 llm 服务的形状，复用同一条双轨生成路径。 */
export function createDirectLlm(config) {
  return {
    direct: true,
    reasoningProtocol: directReasoningProtocol(config),
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
        stream: options.streaming === true,
        temperature: options.temperature ?? 0.9,
        signal: options.signal,
        // 此字段只属于本地直连适配器；蒸馏调用把自己的阶段时限传到底层。
        timeoutMs: options.timeoutMs ?? config.timeoutMs,
        onUsage: config.onUsage,
      })
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}
