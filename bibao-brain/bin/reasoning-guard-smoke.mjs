#!/usr/bin/env node
/**
 * 思考强度安全发送：模型没声明支持时绝不带 reasoningEffort，不会再触发
 * UNSUPPORTED_REASONING_EFFORT 降级。
 * node bin/reasoning-guard-smoke.mjs
 */
import assert from 'node:assert/strict'
import { safeReasoningOptions } from '../core/usage.js'

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

// 1. 模型声明支持 low → 发送
const capsLlm = {
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
}
const a = await safeReasoningOptions(capsLlm, { provider: 'zcode', model: 'GLM-5.3-Flash' }, 'low')
check('声明支持 low 时发送', a.reasoningEffort === 'low', JSON.stringify(a))
const b = await safeReasoningOptions(capsLlm, { provider: 'zcode', model: 'GLM-5.3-Flash' }, 'medium')
check('未声明 medium 时不发送', b.reasoningEffort === undefined, JSON.stringify(b))
check('能力已缓存不重复查询', typeof capsLlm.__bibaoReasoning === 'object' && capsLlm.__bibaoReasoning.verified === true)

// 2. 模型不声明任何思考能力 → 不发送
const plainLlm = { resolveModelInfo: async () => ({}) }
const c = await safeReasoningOptions(plainLlm, { provider: 'x', model: 'm' }, 'low')
check('无思考能力时不发送', c.reasoningEffort === undefined, JSON.stringify(c))
const d = await safeReasoningOptions(plainLlm, { provider: 'x', model: 'm' }, 'low')
check('结果被缓存不重复请求', plainLlm.__bibaoReasoning.verified === true)

// 3. resolveModelInfo 抛错 → 不发送，也不炸
const brokenLlm = { resolveModelInfo: async () => { throw new Error('PERMISSION 405') } }
const e = await safeReasoningOptions(brokenLlm, { provider: 'x', model: 'm' }, 'low')
check('能力查询失败时不发送', e.reasoningEffort === undefined, JSON.stringify(e))
check('失败也被缓存', brokenLlm.__bibaoReasoning.verified === true)

// 4. 没有 resolveModelInfo 的适配器 → 不发送
const f = await safeReasoningOptions({}, { provider: 'x', model: 'm' }, 'low')
check('无能力接口时不发送', f.reasoningEffort === undefined)

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
