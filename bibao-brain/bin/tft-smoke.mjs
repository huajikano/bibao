#!/usr/bin/env node
/** 云顶决策层自检：留钱、升级、买牌、all-in。 */
import { decideTft, goldFloor, cardValue, stageOf } from '../core/tft.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// 阶段解析
check('阶段解析', stageOf('4-2') === 4 && stageOf('') === 2, `4-2 → ${stageOf('4-2')}`)

// 留钱曲线
check('前期留 50', goldFloor({ stage: 2, health: 100 }) === 50)
check('后期留得少', goldFloor({ stage: 5, health: 100 }) < goldFloor({ stage: 2, health: 100 }))
check('血少不留钱', goldFloor({ stage: 2, health: 20 }) === 0)

// 卡的价值：越贵越高、重复更高
const cheap = cardValue({ name: 'A', cost: 1 }, { stage: 4 })
const pricey = cardValue({ name: 'B', cost: 4 }, { stage: 4 })
check('高费卡更值', pricey > cheap, `${cheap} vs ${pricey}`)
check('重复卡加分', cardValue({ name: 'A', cost: 2 }, { stage: 4, owned: { A: 2 } }) > cardValue({ name: 'A', cost: 2 }, { stage: 4 }))

// 决策：商店没开就等
{
  const plan = decideTft({ stage: 2, level: 3, gold: 30, shop: [] })
  check('商店没开就等', plan.actions[0].type === 'wait', plan.reason)
}

// 决策：前期钱不多，不乱买
{
  const shop = [{ name: '甲', cost: 2 }, { name: '乙', cost: 3 }]
  const plan = decideTft({ stage: 2, level: 3, gold: 20, health: 100, shop })
  const buys = plan.actions.filter((a) => a.type === 'buy').length
  check('前期不破坏利息', buys === 0, `${plan.reason}（买 ${buys} 张）`)
}

// 决策：钱多时买得起就买
{
  const shop = [{ name: '甲', cost: 2 }, { name: '乙', cost: 3 }]
  const plan = decideTft({ stage: 2, level: 3, gold: 60, health: 100, shop })
  const buys = plan.actions.filter((a) => a.type === 'buy').length
  check('钱多会买牌', buys >= 1, `买 ${buys} 张，${plan.reason}`)
}

// 决策：血量低要 D 牌
{
  const shop = [{ name: '甲', cost: 2 }]
  const plan = decideTft({ stage: 4, level: 7, gold: 40, health: 18, shop })
  check('残血会 D 牌', plan.actions.some((a) => a.type === 'roll'), plan.reason)
}

// 决策：钱够会升级
{
  const shop = [{ name: '甲', cost: 1 }]
  const plan = decideTft({ stage: 3, level: 5, gold: 55, health: 90, shop })
  check('钱够会升级', plan.actions.some((a) => a.type === 'level'), plan.reason)
}

// 决策：备战席满就不硬买
{
  const shop = [{ name: '甲', cost: 1 }]
  const plan = decideTft({ stage: 4, level: 8, gold: 60, health: 90, shop, bench: 9 })
  check('备战席满不硬塞', !plan.actions.some((a) => a.type === 'buy'), plan.reason)
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
