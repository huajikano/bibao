/**
 * 羁绊：近似表 + 打分。
 *
 * 这张表是"当前赛季常见英雄"的粗映射，赛季更新会过时——
 * 所以它只用来给买牌加一点倾向分，不用来做硬决策。
 * 真正的羁绊数量由游戏左侧面板给出（视觉读），这里只判断"凑不凑得上"。
 */

export const CHAMPION_TRAITS = {
  艾希: ['射手', '极地'],
  薇恩: ['射手', '夜幽'],
  金克丝: ['射手', '朋克'],
  凯特琳: ['射手', '警察'],
  崔丝塔娜: ['射手', '龙族'],
  提莫: ['射手', '约德尔'],
  韦鲁斯: ['射手', '幽冥'],
  伊泽瑞尔: ['射手', '未来战士'],
  蕾欧娜: ['坦克', '圣盾使'],
  布隆: ['坦克', '极地'],
  阿利斯塔: ['坦克', '狂战士'],
  墨菲特: ['坦克', '岩石'],
  拉莫斯: ['坦克', '守护者'],
  盖伦: ['战士', '德玛西亚'],
  德莱厄斯: ['战士', '诺克萨斯'],
  亚托克斯: ['战士', '暗裔'],
  瑟提: ['战士', '拳师'],
  蔚: ['战士', '朋克'],
  阿狸: ['法师', '灵罗'],
  辛德拉: ['法师', '星之守护者'],
  维克托: ['法师', '进化'],
  拉克丝: ['法师', '光'],
  璐璐: ['法师', '约德尔'],
  索拉卡: ['辅助', '星界'],
  迦娜: ['辅助', '风暴'],
  娑娜: ['辅助', '音律'],
}

export function traitsOf(name = '') {
  return CHAMPION_TRAITS[String(name).replace(/\s/g, '')] ?? []
}

/**
 * 买这张卡对现有羁绊有多少帮助。
 * 已经 2 个的羁绊再补一个就能上 3，价值更高。
 */
export function traitBonus(name = '', currentTraits = []) {
  const traits = traitsOf(name)
  if (!traits.length) return 0
  let bonus = 0
  for (const trait of traits) {
    const found = (currentTraits ?? []).find((item) => String(item?.name ?? '') === trait)
    const count = Number(found?.count ?? 0)
    if (count >= 2) bonus += 0.9
    else if (count === 1) bonus += 0.5
    else bonus += 0.15
  }
  return Number(bonus.toFixed(2))
}

/** 现在最该补的羁绊（差一个就能升级的那种）。 */
export function bestTraitToComplete(currentTraits = []) {
  const ranked = (currentTraits ?? [])
    .map((item) => ({ name: String(item?.name ?? ''), count: Number(item?.count ?? 0) }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
  return ranked[0]?.name ?? ''
}
