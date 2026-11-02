/**
 * 站位：谁该站前面、谁该站后面。
 *
 * 不维护全英雄表（每个赛季都变），用"近战/远程"的粗分类 + 费用兜底：
 * 低费近战先顶前面，高费远程放后面。
 */

const FRONT = new Set([
  '盖伦', '德莱厄斯', '蔚', '布隆', '蕾欧娜', '塔姆', '蒙多', '慎', '亚托克斯', '塞恩',
  '瑟提', '纳尔', '波比', '阿木木', '约里克', '克烈', '沃利贝尔', '瑟庄妮', '扎克', '雷克塞',
  '阿利斯塔', '墨菲特', '拉莫斯', '潘森', '佛耶戈', '卡萨丁', '凯隐', '努努', '蔚',
])

const BACK = new Set([
  '艾希', '薇恩', '金克丝', '女警', '凯特琳', '崔丝塔娜', '提莫', '韦鲁斯', '伊泽瑞尔',
  '厄斐琉斯', '泽丽', '烬', '卡莎', '霞', '希维尔', '璐璐', '索拉卡', '迦娜', '莫甘娜',
  '娑娜', '阿狸', '辛德拉', '维克托', '奥莉安娜', '婕拉', '拉克丝', '佐伊', '妮蔻', '卡尔玛',
  '克格莫', '千珏', '厄加特', '斯维因', '黑默丁格', '悠米', '派克',
])

/** 粗分类：front（前排）/ back（后排）/ mid（放中间）。 */
export function roleOf(name = '') {
  const text = String(name).replace(/\s/g, '')
  if (FRONT.has(text)) return 'front'
  if (BACK.has(text)) return 'back'
  return 'mid'
}

/** 目标站位：前排第 0 行、后排第 3 行、中间第 1~2 行。 */
export function planPositioning({ units = [], max = 3 } = {}) {
  const targets = { front: [[0, 3], [0, 2], [0, 4], [0, 1], [0, 5]], back: [[3, 3], [3, 2], [3, 4], [3, 1], [3, 5]], mid: [[1, 3], [2, 3], [1, 2], [2, 2]] }
  const used = new Set()
  const actions = []
  for (const unit of (units ?? []).slice(0, max)) {
    const role = roleOf(unit.name)
    const spot = (targets[role] ?? targets.mid).find(([row, col]) => !used.has(`${row},${col}`))
    if (!spot) continue
    // 已经在正确位置就不动
    if (Number(unit.row) === spot[0] && Number(unit.col) === spot[1]) continue
    used.add(`${spot[0]},${spot[1]}`)
    actions.push({ type: 'reposition', fromRow: Number(unit.row), fromCol: Number(unit.col), row: spot[0], col: spot[1], name: unit.name, role })
  }
  return actions
}
