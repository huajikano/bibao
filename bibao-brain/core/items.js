/**
 * 装备：先认类型，再按"推荐装备"匹配。
 *
 * 数据不是全量装备表（每个赛季都在变），而是"类型 + 常见成品"。
 * 真正给哪件，游戏自己会告诉你：右键英雄会弹推荐，我们读那个弹窗。
 */

export const KEYBINDS = {
  refresh: 'D', // 刷新商店
  buyXp: 'F', // 购买经验
  deploy: 'W', // 把鼠标选中的英雄上阵
  sell: 'E', // 出售鼠标选中的英雄
  recenter: 'Space', // 视角回到小小英雄
  arena: '1', // 切换竞技场
}

/** 常见成品装备的类型：攻击 / 法术 / 防御 / 功能 */
export const ITEM_TYPES = {
  死亡之刃: 'ad', 巨人杀手: 'ad', 无尽之刃: 'ad', 疾射火炮: 'ad', 海克斯科技枪刃: 'ad',
  鬼索的狂暴之刃: 'ad', 最后的轻语: 'ad', 锐利之刃: 'ad', 正义之手: 'ad',
  大天使之杖: 'ap', 灭世者的死亡之帽: 'ap', 珠光护手: 'ap', 离子火花: 'ap',
  斯塔缇克电刃: 'ap', 蓝霸符: 'ap', 朔极之矛: 'ap', 幽魂斗篷: 'ap',
  狂徒铠甲: 'tank', 龙牙: 'tank', 荆棘之甲: 'tank', 石像鬼石板甲: 'tank',
  坚决: 'tank', 圣盾使的誓约: 'tank', 救赎: 'tank', 冕卫: 'tank',
  女妖之爪: 'support', 能量圣杯: 'support', 基克的先驱: 'support',
  钢铁烈阳之匣: 'support', 兹若特传送门: 'support',
}

/** 认类型：先精确匹配，再按关键词模糊。 */
export function itemType(name = '') {
  const text = String(name).replace(/\s/g, '')
  if (ITEM_TYPES[text]) return ITEM_TYPES[text]
  if (/刃|剑|刀|弓|枪|拳套|巨杀|无尽|轻语/.test(text)) return 'ad'
  if (/杖|书|帽|符|火花|圣杯|法/.test(text)) return 'ap'
  if (/甲|盾|铠甲|龙牙|狂徒|石像|救赎/.test(text)) return 'tank'
  if (/爪|匣|门|先驱|旗/.test(text)) return 'support'
  return 'unknown'
}

/** 英雄大概吃哪类装备——靠名字猜不出来，靠"推荐弹窗"给。 */
export function scoreItem(item = {}, recommended = []) {
  const name = String(item.name ?? '')
  const type = itemType(name)
  const hits = (recommended ?? []).filter((item2) => {
    const target = String(item2 ?? '')
    return target && (target === name || target.includes(name) || name.includes(target))
  }).length
  const sameType = (recommended ?? []).filter((item2) => itemType(item2) === type && type !== 'unknown').length
  return hits * 3 + sameType
}

/**
 * 给某个英雄挑一件装备：优先和推荐完全对上，其次同类型。
 * @returns {{slot: number, name: string, reason: string}|null}
 */
export function pickItemFor({ items = [], recommended = [] } = {}) {
  if (!items.length) return null
  const ranked = items
    .map((item, slot) => ({ slot, name: String(item.name ?? ''), score: scoreItem(item, recommended) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) return null
  if (best.score <= 0) return { ...best, reason: '没有对得上的，先随手给一件' }
  return { ...best, reason: best.score >= 3 ? '正好是推荐装备' : '和推荐同类型' }
}
