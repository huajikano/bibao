#!/usr/bin/env node
/** 神经递质不是死值：昼夜节律会让静息态也有缓慢漂移。 */
import { NeuroState } from '../core/state.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const morning = new NeuroState({})
morning.decay(180, { hour: 8 })
const evening = new NeuroState({})
evening.decay(180, { hour: 20 })

const morningCortisol = morning.hormones.cortisol
const eveningCortisol = evening.hormones.cortisol
check('早上皮质醇高于晚上', morningCortisol > eveningCortisol, `${morningCortisol.toFixed(3)} > ${eveningCortisol.toFixed(3)}`)

const morningSnap = morning.snapshot()
const eveningSnap = evening.snapshot()
const targetOf = (snap, key) => snap.hormones.find((item) => item.key === key)?.target
check('快照里带目标值', Number.isFinite(targetOf(morningSnap, 'cortisol')), String(targetOf(morningSnap, 'cortisol')))
check(
  '目标值随时段变化',
  targetOf(morningSnap, 'cortisol') > targetOf(eveningSnap, 'cortisol'),
  `${targetOf(morningSnap, 'cortisol')} > ${targetOf(eveningSnap, 'cortisol')}`,
)

const start = new NeuroState({})
const before = start.hormones.dopamine
start.decay(45, { hour: 14 })
check('静息态多巴胺会漂移', Math.abs(start.hormones.dopamine - before) > 0.0001, `${before.toFixed(4)} → ${start.hormones.dopamine.toFixed(4)}`)

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
