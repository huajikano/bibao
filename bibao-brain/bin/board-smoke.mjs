#!/usr/bin/env node
/** 上场与捡球的决策自检。 */
import { planPlacements, planPickups } from '../core/board.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// 上人：有 2 个备战席、4 个空位，就上 2 个
{
  const plan = planPlacements({ benchFilled: [0, 2], boardEmpty: [[1, 3], [1, 2], [2, 3], [0, 3]], max: 2 })
  check('有几个上几个', plan.length === 2, JSON.stringify(plan))
  check('优先中间行', plan[0].row === 1 && plan[0].col === 3, JSON.stringify(plan[0]))
  check('不重复占位', new Set(plan.map((item) => `${item.row},${item.col}`)).size === plan.length)
}

// 没有空位就不上
{
  const plan = planPlacements({ benchFilled: [0], boardEmpty: [], max: 2 })
  check('棋盘满了不乱上', plan.length === 0)
}

// 备战席空着就什么都不做
{
  const plan = planPlacements({ benchFilled: [], boardEmpty: [[1, 3]], max: 2 })
  check('没人可上就等', plan.length === 0)
}

// 捡球：最多三个、坐标要合法
{
  const plan = planPickups({ orbs: [[0.5, 0.6], [0.3, 0.4], [0.7, 0.2], [0.9, 0.9]] })
  check('一次最多捡三个', plan.length === 3, `捡 ${plan.length} 个`)
  check('球坐标是比例', plan.every((item) => item.x > 0 && item.x < 1))
}

// 没有球就什么都不做
{
  const plan = planPickups({ orbs: [] })
  check('没球就等', plan.length === 0)
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
