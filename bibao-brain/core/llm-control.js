/** 模型调用的时限与取消原因。不给不同层的 AbortError 混用同一句提示。 */
export const DEFAULT_MODEL_TIMEOUT_MS = 90_000
export const DISTILL_STAGE_TIMEOUT_MS = 10 * 60_000
const duration = (ms) => ms < 1000 ? `${ms} 毫秒` : `${Math.round(ms / 1000)} 秒`

export function modelTimeout(timeoutMs, scope = '模型') {
  const error = new Error(`${scope}调用超过时限（${duration(timeoutMs)}）`)
  error.name = 'TimeoutError'
  error.code = 'LLM_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}
export function modelCancelled() {
  const error = new Error('模型请求已取消')
  error.name = 'AbortError'
  error.code = 'LLM_CANCELLED'
  return error
}
export function upstreamAborted() {
  const error = new Error('上游模型连接被中止；本地未触发超时或用户暂停')
  error.name = 'AbortError'
  error.code = 'LLM_UPSTREAM_ABORT'
  return error
}
export function normalizeModelAbort(error, { signal, timedOut = false, timeoutMs = DEFAULT_MODEL_TIMEOUT_MS, scope = '模型' } = {}) {
  if (signal?.aborted) {
    const reason = signal.reason
    if (['LLM_TIMEOUT','LLM_CANCELLED'].includes(reason?.code)) return reason
    if (reason?.name === 'TimeoutError') return modelTimeout(timeoutMs, scope)
    return modelCancelled()
  }
  if (timedOut) return modelTimeout(timeoutMs, scope)
  if (['LLM_TIMEOUT','LLM_CANCELLED','LLM_UPSTREAM_ABORT'].includes(error?.code)) return error
  let cause = error
  for (let depth = 0; cause && depth < 5; depth++, cause = cause.cause) {
    if (['AbortError','TimeoutError'].includes(cause?.name) || ['ABORT_ERR','UND_ERR_ABORTED','ERR_CANCELED'].includes(cause?.code) || /\b(?:this |the )?operation was aborted\b|\brequest (?:was )?(?:aborted|cancelled|canceled)\b/i.test(String(cause?.message ?? cause))) return upstreamAborted()
  }
  return error
}
