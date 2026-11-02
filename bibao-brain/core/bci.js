/**
 * 游戏脑机接口（只读层）。
 *
 * 参考了三个真实项目（TFT-Hextech-Helper / TFT-OCR-BOT / Tool-Auto-TFT-Mobile）：
 * 它们都是「截屏 → 模板匹配 + OCR → 决策 → 注入鼠标键盘」。我们只做前半段：
 * 感知游戏状态、分配注意力，**不碰键鼠**。
 *
 * 三层对应：
 *   前额叶：几秒一次的"想干嘛"（由外部 feeder 或未来的视觉模块给出意图）
 *   基底核：百毫秒级的套路宏（这里只算熟练度与匹配耗时）
 *   小脑：毫秒级执行 + 生理不完美（反应时、手抖、走神抖动）
 */

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))

/** 注意力总带宽只有 1：打游戏时看手机的能力必然下降。 */
export class AttentionPool {
  constructor() {
    this.gameLoad = 0
    this.qqLoad = 0
  }

  set(gameLoad, qqLoad = this.qqLoad) {
    this.gameLoad = clamp(Number(gameLoad) || 0)
    this.qqLoad = clamp(Number(qqLoad) || 0)
  }

  /** 还能分给 QQ 多少注意力。 */
  get qqBudget() {
    return clamp(1 - this.gameLoad * 0.85)
  }

  /** 现在回消息要不要"从游戏里缓一下"。 */
  get distracted() {
    return this.gameLoad > 0.7
  }

  snapshot() {
    return { gameLoad: Number(this.gameLoad.toFixed(2)), qqBudget: Number(this.qqBudget.toFixed(2)), distracted: this.distracted }
  }
}

/** 反应时与手抖：同一个人的失误率会随疲劳和紧张变化。 */
export class MotorModel {
  constructor({ proficiency = 0.45 } = {}) {
    this.proficiency = clamp(proficiency, 0.1, 0.98)
  }

  /** 生理反应时（毫秒）：基础 190，越累越慢，再加 25ms 噪声。 */
  reactionMs({ energy = 70, noise = 0 } = {}) {
    return 190 + 120 * (1 - clamp(energy / 100)) + noise * 25
  }

  /** 菲茨定律：点击/拖拽耗时取决于距离 D 与目标宽度 W。 */
  fittsMs({ distance = 300, width = 40 } = {}) {
    const d = Math.max(1, Number(distance) || 1)
    const w = Math.max(1, Number(width) || 1)
    return 120 + 150 * Math.log2(2 + (2 * d) / w)
  }

  /** 高压手抖：熟练度越低、皮质醇越高，越容易点错。 */
  mistakeChance({ cortisol = 0.3 } = {}) {
    return clamp(0.25 * (1 - this.proficiency) + 0.18 * Math.max(0, cortisol - 0.55), 0, 0.8)
  }

  /** 闲着的时候会乱动：越兴奋动得越勤。 */
  idleFidgetSec({ dopamine = 0.4, rng = Math.random } = {}) {
    const base = 5 - 2.5 * clamp(dopamine)
    return base * (0.7 + rng() * 0.6)
  }
}

/**
 * 云顶之弈的读状态层：只判断"现在在备战还是在打"，以及"这一眼看漏了几张牌"。
 * 真实项目靠模板匹配 + OCR 得到这些数字；我们先把判断逻辑写对，
 * 视觉模块接上以后直接换数据源即可。
 */
export class TftAdapter {
  constructor() {
    this.reset()
  }

  reset() {
    this.phase = 'idle'
    this.gold = 0
    this.health = 100
    this.level = 1
    this.shop = []
    this.lastRollAt = 0
  }

  /** 外部喂进来的状态：{phase, gold, health, level, shop[], rollCount} */
  ingest({ phase, gold, health, level, shop, rollAt } = {}) {
    if (phase) this.phase = String(phase)
    if (Number.isFinite(Number(gold))) this.gold = Number(gold)
    if (Number.isFinite(Number(health))) this.health = Number(health)
    if (Number.isFinite(Number(level))) this.level = Number(level)
    if (Array.isArray(shop)) this.shop = shop.slice(0, 5)
    if (Number.isFinite(Number(rollAt))) this.lastRollAt = Number(rollAt)
    return this.snapshot()
  }

  /** 备战期倒计时与血量决定"手有多急"。 */
  pressure({ secondsLeft = 30 } = {}) {
    const time = clamp(1 - Math.max(0, secondsLeft) / 30)
    const low = clamp(1 - this.health / 100)
    return clamp(time * 0.6 + low * 0.4)
  }

  /**
   * 视野狭窄：越急、越紧张，越容易在连点 D 时把想要的卡刷过去。
   * 返回这一眼的遮蔽概率与"漏牌"期望张数。
   */
  tunnelVision({ cortisol = 0.3, secondsLeft = 30, wanted = [] } = {}) {
    const pressure = this.pressure({ secondsLeft })
    const blind = clamp(0.45 * Math.max(0, cortisol - 0.5) + 0.25 * pressure)
    const wantedCards = shopWanted(this.shop, wanted)
    const missed = wantedCards.filter(() => Math.random() < blind).length
    return { pressure: Number(pressure.toFixed(2)), blind: Number(blind.toFixed(2)), missed }
  }

  snapshot() {
    return { phase: this.phase, gold: this.gold, health: this.health, level: this.level, shop: this.shop }
  }
}

function shopWanted(shop = [], wanted = []) {
  if (!wanted.length) return shop
  const names = new Set(wanted.map((item) => String(item)))
  return shop.filter((card) => names.has(String(card?.name ?? card)))
}
