#!/usr/bin/env node
/** 站位与快捷键自检。 */
import { roleOf, planPositioning } from '../core/position.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

check('坦克认前排', roleOf('蕾欧娜') === 'front', roleOf('蕾欧娜'))
check('射手认后排', roleOf('艾希') === 'back', roleOf('艾希'))
check('不认识的放中间', roleOf('某个新英雄') === 'mid')

// 前排去第 0 行
{
  const plan = planPositioning({ units: [{ name: '蕾欧娜', row: 3, col: 3 }], max: 3 })
  check('坦克会被拉去前排', plan.length === 1 && plan[0].row === 0, JSON.stringify(plan[0]))
}

// 后排去第 3 行
{
  const plan = planPositioning({ units: [{ name: '艾希', row: 0, col: 3 }], max: 3 })
  check('射手会被拉去后排', plan.length === 1 && plan[0].row === 3, JSON.stringify(plan[0]))
}

// 已经站对就不动
{
  const plan = planPositioning({ units: [{ name: '蕾欧娜', row: 0, col: 3 }], max: 3 })
  check('站对了不折腾', plan.length === 0)
}

// 多人不抢同一格
{
  const plan = planPositioning({ units: [{ name: '蕾欧娜', row: 3, col: 0 }, { name: '布隆', row: 3, col: 1 }], max: 3 })
  const cells = new Set(plan.map((item) => `${item.row},${item.col}`))
  check('两个人不抢一格', plan.length === 2 && cells.size === 2, JSON.stringify(plan.map((item) => [item.row, item.col])))
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
