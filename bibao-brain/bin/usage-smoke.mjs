#!/usr/bin/env node
/** Token 用量计量：精确 usage、估算、按逻辑/模型、持久化与清零。 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TokenMeter, estimateTokens, meterLlm } from '../core/usage.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-usage-'))
const file = path.join(dir, 'usage.json')
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

check('中文估算非零', estimateTokens('比宝今天有点累') >= 5, `tokens=${estimateTokens('比宝今天有点累')}`)

const meter = new TokenMeter({ file })
await meter.load()
meter.record({ logic: 'broca', provider: 'direct', model: 'm1', input: 100, output: 30, estimated: false })
meter.record({ logic: 'appraisal', provider: 'direct', model: 'm1', input: 20, output: 5, estimated: true })
let snap = meter.snapshot()
check('总计正确', snap.total.calls === 2 && snap.total.input === 120 && snap.total.output === 35, JSON.stringify(snap.total))
check('按逻辑分组', snap.byLogic.broca?.calls === 1 && snap.byLogic.appraisal?.estimatedCalls === 1, JSON.stringify(snap.byLogic))
check('标记含估算', snap.estimated === true && snap.total.estimatedCalls === 1, String(snap.estimated))
await meter.save()

const restored = new TokenMeter({ file })
await restored.load()
snap = restored.snapshot()
check('能持久化', snap.total.input === 120 && snap.byLogic.broca?.output === 30, JSON.stringify(snap.total))

const exact = {
  async *stream() {
    yield { type: 'text-delta', text: '你好' }
    yield { type: 'finish', usage: { prompt_tokens: 7, completion_tokens: 3 } }
  },
}
const measured = meterLlm(exact, { meter: restored, logic: 'broca', provider: 'p', model: 'm2' })
for await (const _ of measured.stream({ system: 's', messages: [{ role: 'user', content: 'u' }] })) {
  /* drain */
}
snap = restored.snapshot()
check('流式 usage 精确记账', snap.byLogic.broca?.input === 107 && snap.byLogic.broca?.output === 33, JSON.stringify(snap.byLogic.broca))

const estimated = {
  async *stream() {
    yield { type: 'text-delta', text: '一段没有 usage 的回复' }
  },
}
const guessed = meterLlm(estimated, { meter: restored, logic: 'memory', provider: 'p', model: 'm3' })
for await (const _ of guessed.stream({ system: 'system', messages: [{ role: 'user', content: '用户说的话' }] })) {
  /* drain */
}
snap = restored.snapshot()
check('无 usage 时标记估算', snap.byLogic.memory?.estimatedCalls === 1 && snap.byLogic.memory?.input > 0, JSON.stringify(snap.byLogic.memory))

const cacheMeter = new TokenMeter({})
cacheMeter.record({ logic: 'vision', provider: 'p', model: 'm4', input: 10, output: 2, cacheRead: 50, cacheCreation: 5, latencyMs: 120 })
const cacheSnap = cacheMeter.snapshot()
check(
  '缓存 / 会话 / 延迟',
  cacheSnap.total.cacheRead === 50 &&
    cacheSnap.total.cacheCreation === 5 &&
    cacheSnap.session.tokens === 67 &&
    cacheSnap.avgLatencyMs === 120 &&
    cacheSnap.cacheHitRate > 0.8,
  JSON.stringify({ total: cacheSnap.total, session: cacheSnap.session, avg: cacheSnap.avgLatencyMs }),
)

const cleared = restored.reset()
check('清零', cleared.total.calls === 0 && Object.keys(cleared.byLogic).length === 0, JSON.stringify(cleared.total))

await rm(dir, { recursive: true, force: true })
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
