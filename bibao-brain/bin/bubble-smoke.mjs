#!/usr/bin/env node
/** 说话节奏：长尾采样、情绪耦合、最终条数不被标点切碎。 */
import { sampleBubbleCount, enforceBudget } from '../core/broca.js'
import { buildSystemPrompt } from '../core/voice.js'
import { createRng } from '../core/rng.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const fixed = (roll, opts = {}) => sampleBubbleCount({ category: 'flat', state: { energy: 80, cortisol: 0.1, serotonin: 0.6 }, playfulness: 0.5, roll: () => roll, ...opts })
check('低 roll 是一句', fixed(0.01) === 1, String(fixed(0.01)))
check('中间 roll 是两句', fixed(0.65) === 2, String(fixed(0.65)))
check('高 roll 是三句', fixed(0.99) === 3, String(fixed(0.99)))
check('cap 能压到一句', fixed(0.99, { cap: 1 }) === 1, String(fixed(0.99, { cap: 1 })))

const tired = sampleBubbleCount({
  category: 'flat',
  state: { energy: 20, cortisol: 0.1, serotonin: 0.5 },
  playfulness: 0.1,
  roll: () => 0.7,
})
check('累了就收成一句', tired === 1, String(tired))

const angry = sampleBubbleCount({
  category: 'hostile',
  state: { energy: 80, cortisol: 0.8, serotonin: 0.4 },
  playfulness: 0.3,
  roll: () => 0.6,
})
check('被激怒时话会变多', angry >= 2, String(angry))

const rng = createRng(20261103)
const counts = [0, 0, 0]
for (let i = 0; i < 5000; i += 1) {
  const n = sampleBubbleCount({
    category: 'gossip',
    state: { energy: 80, cortisol: 0.1, serotonin: 0.6, dopamine: 0.7 },
    playfulness: 0.7,
    roll: () => rng.next(),
  })
  counts[n - 1] += 1
}
check('灵动时保留二/三连尾巴', counts[1] > 800 && counts[2] > 400, JSON.stringify(counts))
check('三连仍然不是常态', counts[2] < 2500, JSON.stringify(counts))

const one = enforceBudget(['一句。二句。三句'], 100, 3)
check('一条气泡不会被句号切成三条', one.length === 1, JSON.stringify(one))
const capped = enforceBudget(['一', '二', '三', '四'], 100, 2)
check('最终条数受 maxBubbles 约束', capped.length === 2, JSON.stringify(capped))

const complete = enforceBudget(['这是一句没有句号的完整短句'], 8, 3)
check('短句轻微超出预算也不砍断', complete[0] === '这是一句没有句号的完整短句', JSON.stringify(complete))
const clause = enforceBudget(['前面这句很长，后面这句会被保留吗'], 8, 3)
check('长句优先在逗号处收完整', clause[0] === '前面这句很长', JSON.stringify(clause))

const prompt = buildSystemPrompt({ biography: { name: '比宝', oneLine: '爱玩的小女孩' }, maxBubbles: 2, playfulness: 0.7 })
check('提示词默认一句', prompt.includes('通常只说一句'), '')
check('提示词用动态上限', prompt.includes('不得超过 2 条'), '')
check('schema 只给一条示例', /"bubbles": \["[^"]+"\]/.test(prompt), '')

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
