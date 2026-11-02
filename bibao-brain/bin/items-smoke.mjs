#!/usr/bin/env node
/** 装备决策自检。 */
import { itemType, pickItemFor, scoreItem, KEYBINDS } from '../core/items.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

check('按键表齐全', KEYBINDS.refresh === 'D' && KEYBINDS.buyXp === 'F' && KEYBINDS.sell === 'E')
check('精确认类型', itemType('无尽之刃') === 'ad' && itemType('狂徒铠甲') === 'tank')
check('模糊认类型', itemType('某把大剑') === 'ad' && itemType('神秘法杖') === 'ap')
check('认不出来', itemType('奇怪的东西') === 'unknown')

// 推荐完全命中优先
{
  const items = [{ name: '狂徒铠甲' }, { name: '无尽之刃' }]
  const pick = pickItemFor({ items, recommended: ['无尽之刃', '巨人杀手'] })
  check('推荐命中就选它', pick.name === '无尽之刃', `${pick.name}（${pick.reason}）`)
}

// 没有完全命中，选同类型
{
  const items = [{ name: '狂徒铠甲' }, { name: '巨人杀手' }]
  const pick = pickItemFor({ items, recommended: ['无尽之刃'] })
  check('退而求其次选同类型', pick.name === '巨人杀手', `${pick.name}（${pick.reason}）`)
}

// 完全对不上也要给一件，不空转
{
  const items = [{ name: '狂徒铠甲' }]
  const pick = pickItemFor({ items, recommended: ['无尽之刃'] })
  check('实在没有也先给', Boolean(pick), `${pick?.name}`)
}

// 没装备就什么都不做
check('没装备返回空', pickItemFor({ items: [], recommended: [] }) === null)

// 分数要能区分
check('完全命中分更高', scoreItem({ name: '无尽之刃' }, ['无尽之刃']) > scoreItem({ name: '狂徒铠甲' }, ['无尽之刃']))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
