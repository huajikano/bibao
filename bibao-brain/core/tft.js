/**
 * 云顶之弈的"怎么打"：只做决策，不碰鼠标。
 *
 * 这一层是纯函数，给定局面返回下一步动作，方便测试和回放。
 * 策略刻意保守但成形：利息优先 / 血量告急再 all-in / 先升级再 D 牌。
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/** 看阶段（如 "3-2"）取大阶段号；认不出来按 2 算。 */
export function stageOf(text = '') {
  const match = String(text).match(/(\d)\s*[-－]\s*\d/)
  return match ? Number(match[1]) : 2
}

/**
 * 留多少钱：越往后留得越少，血量低就一分不留。
 */
export function goldFloor({ stage = 2, health = 100, allIn = false } = {}) {
  if (allIn || health <= 25) return 0
  if (health <= 40) return 10
  if (stage <= 2) return 50
  if (stage === 3) return 40
  if (stage === 4) return 30
  return 20
}

/** 一张卡值不值得买：费用越高越值，重复卡（能升星）额外加分。 */
export function cardValue(card = {}, { stage = 2, owned = {} } = {}) {
  const cost = Number(card.cost ?? 1)
  const name = String(card.name ?? '')
  const copies = Number(owned[name] ?? 0)
  const stageWeight = stage <= 2 ? cost * 0.6 : cost * 1.2
  const upgrade = copies >= 1 ? 0.8 + copies * 0.4 : 0
  return Number((stageWeight + upgrade).toFixed(2))
}

/**
 * 主决策。
 * @returns {{actions: Array<object>, reason: string}}
 */
export function decideTft({ stage = 2, level = 3, gold = 0, health = 100, shop = [], owned = {}, bench = 0 } = {}) {
  const allIn = health <= 25
  const floor = goldFloor({ stage, health, allIn })
  const actions = []
  const reasons = []

  if (!Array.isArray(shop) || shop.length === 0) {
    return { actions: [{ type: 'wait', ms: 4000 }], reason: '商店没开，等' }
  }

  // 1) 血量很低：先 D 牌找牌，而不是继续攒钱
  if (allIn && gold >= 20 && level >= 6) {
    actions.push({ type: 'roll', times: 3 })
    reasons.push('血量告急，D 牌找核心')
  }

  // 2) 升级：钱够、人不够，且不急着找牌
  const wantLevel = level < 8 && ((gold >= 50 && stage >= 2) || (health <= 45 && level < 7))
  if (wantLevel && !allIn) {
    actions.push({ type: 'level', times: gold >= 60 ? 2 : 1 })
    reasons.push(`升级到 ${level + 1}，为后期铺路`)
  }

  // 3) 买牌：按价值排，买得起又不破坏留钱的都买
  const ranked = shop
    .map((card, index) => ({ ...card, slot: index, value: cardValue(card, { stage, owned }) }))
    .sort((a, b) => b.value - a.value)
  let budget = gold
  for (const card of ranked) {
    const cost = Number(card.cost ?? 1)
    if (budget - cost < floor) continue
    if (bench >= 9) break
    actions.push({ type: 'buy', slot: card.slot, name: card.name ?? '', cost })
    budget -= cost
  }
  if (actions.some((action) => action.type === 'buy')) reasons.push(`按价值买 ${actions.filter((a) => a.type === 'buy').length} 张`)

  // 4) 备战席满了就先不买（避免卡死）
  if (bench >= 9 && !actions.length) {
    return { actions: [{ type: 'wait', ms: 3000 }], reason: '备战席满了，先不买' }
  }

  if (!actions.length) {
    const reason = gold < floor ? `留钱吃利息（目标 ${floor}）` : '没有值得买的牌'
    return { actions: [{ type: 'wait', ms: 3500 }], reason }
  }

  return { actions, reason: reasons.join('；') || '按计划执行', meta: { floor, allIn } }
}
