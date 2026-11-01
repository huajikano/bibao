/**
 * 比宝 · 认知内核常量
 *
 * 所有可调数值集中在此。四条定律的参数在此显式命名，便于在
 * 文档、测试与 UI 之间共用同一套口径（UI 只读快照，不重复计算）。
 */

/** 神经递质：基线、物理半衰期（分钟）、中文名、UI 配色用途。 */
export const HORMONES = {
  cortisol: { baseline: 0.22, halfLifeMin: 45, label: '皮质醇', hint: '防御 / 焦虑 / 愤怒' },
  dopamine: { baseline: 0.42, halfLifeMin: 25, label: '多巴胺', hint: '兴趣 / 奖赏 / 冲动' },
  oxytocin: { baseline: 0.35, halfLifeMin: 90, label: '催产素', hint: '依恋 / 信任 / 黏人' },
  serotonin: { baseline: 0.5, halfLifeMin: 60, label: '血清素', hint: '情绪稳定 / 满足' },
}

export const HORMONE_KEYS = Object.keys(HORMONES)

/** 核心信念（CoreSchema）初始基底；生命周期编译器会按传记事件修正。 */
export const SCHEMA_SEED = {
  self_worth: { value: 0.1, weight: 0.82, label: '自我价值', protected: true },
  world_trust: { value: -0.05, weight: 0.68, label: '世界可信', protected: false },
  attachment_anxiety: { value: 0.35, weight: 0.78, label: '依恋焦虑', protected: true },
  conflict_avoidance: { value: 0.3, weight: 0.55, label: '冲突回避', protected: false },
  autonomy_need: { value: 0.45, weight: 0.88, label: '自主需求', protected: true },
  fairness: { value: 0.3, weight: 0.6, label: '公平执念', protected: false },
}

export const SCHEMA_KEYS = Object.keys(SCHEMA_SEED)

/** 四大定律的数值口径。 */
export const PARAMS = {
  // —— 定律一：自由能 / 主动推理 ——
  defensePE: 0.5, // PE 超过此值才可能启用主动控制外推
  trustForPerceptual: 40, // trust > 40 才允许感知内省式让步
  schemaAttackWeight: 0.7, // 权重高于此值的信念被触碰即视为核心自尊受击

  // —— 定律二：全局工作空间与点火 ——
  slots: 5,
  slotsHijacked: 2,
  hijackCortisol: 0.75,
  ignitionBase: 0.62,
  ignitionTauMin: 90,
  ignitionFloor: 0.18,
  slotActivationHalfLifeMin: 8,
  dmnSilenceMin: 30,
  dmnCooldownMin: 40,

  // —— 定律三：互补学习系统 ——
  writeArousal: 0.35,
  writePE: 0.4,
  fastAlpha: 1.0,

  // —— 定律四：遗忘、沉降与再巩固 ——
  stabilityBaseDays: 3,
  valenceStabilityGain: 8,
  consciousTier: 0.35,
  subconsciousTier: 0.05,
  pruneValence: 0.4,
  reconsolidationGain: 0.6,
  reconsolidationGatePE: 0.4,
  reconsolidationGateMood: 0.5,
  moodColorMix: 0.2,

  // —— 代谢预算 ——
  energyStart: 72,
  energyAwakeDrainPerMin: 0.06,
  energySleepRecoverPerMin: 0.26,
  lowEnergy: 30,
  exhaustedEnergy: 14,
  shortBudgetChars: 12,

  // —— 打字运动皮层 ——
  readCostSec: 0.6,
  perCharSec: 0.18,
  hesitationSec: 0.35,
}

/** 年龄神经可塑性：η(Age) = 0.45·exp(-0.12·Age) + 0.03 */
export function eta(age) {
  return 0.45 * Math.exp(-0.12 * Math.max(0, age)) + 0.03
}

/** 年龄阶段生物学修正系数 β_age。 */
export function betaAge(age) {
  if (age < 3.5) return 0.04
  if (age < 12) return 1.0
  if (age <= 18) return 1.65
  return 1.1
}

export const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value))

/** 指数半衰期衰减：向 baseline 回落。 */
export function decayTo(value, baseline, halfLifeMin, dtMin) {
  if (!(dtMin > 0) || !(halfLifeMin > 0)) return value
  return baseline + (value - baseline) * Math.pow(2, -dtMin / halfLifeMin)
}

/** 冲动/抑制共用的 S 型压缩。 */
export function logistic(x) {
  return 1 / (1 + Math.exp(-x))
}

export const HOUR_MS = 3_600_000
export const MIN_MS = 60_000
export const DAY_MS = 86_400_000
