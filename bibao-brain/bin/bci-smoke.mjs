#!/usr/bin/env node
/** 游戏 BCI 只读层自检：注意力、反应时、菲茨、手抖、视野狭窄。 */
import { AttentionPool, MotorModel, TftAdapter } from '../core/bci.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// 注意力总带宽
{
  const pool = new AttentionPool()
  pool.set(0.9)
  const busy = pool.qqBudget
  pool.set(0.2)
  const idle = pool.qqBudget
  check('打游戏时留给 QQ 的注意力更少', busy < idle && busy < 0.35, `忙 ${busy.toFixed(2)} vs 闲 ${idle.toFixed(2)}`)
  check('高负载时算"分心"', new AttentionPool().snapshot() && (() => { const p = new AttentionPool(); p.set(0.8); return p.distracted })() === true, '')
}

// 反应时
{
  const motor = new MotorModel()
  const rested = motor.reactionMs({ energy: 90 })
  const tired = motor.reactionMs({ energy: 20 })
  check('越累反应越慢', tired > rested + 50, `${Math.round(rested)}ms → ${Math.round(tired)}ms`)
}

// 菲茨定律
{
  const motor = new MotorModel()
  const near = motor.fittsMs({ distance: 100, width: 60 })
  const far = motor.fittsMs({ distance: 600, width: 20 })
  check('越远越小的目标越慢', far > near * 1.5, `${Math.round(near)}ms → ${Math.round(far)}ms`)
}

// 手抖
{
  const steady = new MotorModel({ proficiency: 0.9 })
  const shaky = new MotorModel({ proficiency: 0.2 })
  const calm = shaky.mistakeChance({ cortisol: 0.2 })
  const tense = shaky.mistakeChance({ cortisol: 0.9 })
  check('熟练的人更少失误', shaky.mistakeChance({ cortisol: 0.9 }) > steady.mistakeChance({ cortisol: 0.9 }), `${steady.mistakeChance({ cortisol: 0.9 }).toFixed(2)} vs ${shaky.mistakeChance({ cortisol: 0.9 }).toFixed(2)}`)
  check('越紧张越容易点错', tense > calm, `${calm.toFixed(2)} → ${tense.toFixed(2)}`)
}

// 云顶：备战期高压会漏牌
{
  const tft = new TftAdapter()
  tft.ingest({ phase: 'prep', gold: 50, health: 18, level: 8, shop: [{ name: '卡莎' }, { name: '格温' }, { name: '提莫' }] })
  const calm = tft.tunnelVision({ cortisol: 0.2, secondsLeft: 25, wanted: ['卡莎', '格温'] })
  const panic = tft.tunnelVision({ cortisol: 0.95, secondsLeft: 3, wanted: ['卡莎', '格温'] })
  check('越急越容易看漏牌', panic.blind > calm.blind, `遮蔽概率 ${calm.blind} → ${panic.blind}`)
  check('残血压哨的紧迫感更高', panic.pressure > calm.pressure, `压力 ${calm.pressure} → ${panic.pressure}`)
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
