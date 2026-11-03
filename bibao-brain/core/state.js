/**
 * 神经生理状态（Damasio 躯体标记的工程化）：激素、精力、心境。
 *
 * 铁律：任何外部输入（包括 LLM）都不能"重置"情绪，只能注入 Δ 刺激；
 * 之后一切回落由物理半衰期决定。
 */

import { HORMONES, HORMONE_KEYS, PARAMS, clamp, decayTo } from './constants.js'

/** 昼夜节律：同样的刺激，早上和深夜的底噪不一样。 */
function circadianTarget(key, hour) {
  const phase = ((Number(hour) - 6) / 24) * Math.PI * 2
  const offset = {
    cortisol: 0.08 * Math.cos(((Number(hour) - 8) / 24) * Math.PI * 2),
    dopamine: 0.04 * Math.sin(((Number(hour) - 10) / 24) * Math.PI * 2),
    oxytocin: 0.02 * Math.cos(((Number(hour) - 20) / 24) * Math.PI * 2),
    serotonin: 0.05 * Math.sin(phase),
  }[key] ?? 0
  return HORMONES[key].baseline + offset
}

/** 90 分钟 ultradian 小波动：让静息态也不是一条死线。 */
function ultradianTarget(key, awakeMin) {
  const phase = ((Number(awakeMin) || 0) / 90) * Math.PI * 2
  const offset = { cortisol: 0.006, dopamine: 0.008, oxytocin: 0.004, serotonin: 0.006 }[key] ?? 0
  return offset * Math.sin(phase + key.length)
}

export class NeuroState {
  constructor(init = {}) {
    this.hormones = {}
    for (const key of HORMONE_KEYS) {
      const base = HORMONES[key].baseline
      this.hormones[key] = clamp(init.hormones?.[key] ?? base)
    }
    this.energy = clamp(init.energy ?? PARAMS.energyStart, 0, 100)
    this.moodValence = clamp(init.moodValence ?? 0.05, -1, 1)
    this.moodBaseline = clamp(init.moodBaseline ?? 0.05, -1, 1)
    this.lastStressor = init.lastStressor ?? null
    this.stimulusAt = init.stimulusAt ?? null
    this.sleepDebtMin = init.sleepDebtMin ?? 0
    this.totalAwakeMin = init.totalAwakeMin ?? 0
    this.currentHour = init.currentHour ?? new Date().getHours()
  }

  get cortisol() {
    return this.hormones.cortisol
  }

  get dopamine() {
    return this.hormones.dopamine
  }

  get oxytocin() {
    return this.hormones.oxytocin
  }

  get serotonin() {
    return this.hormones.serotonin
  }

  /** 唤醒度：由激素与精力代谢推导，不单独存储，避免两份真相。 */
  get arousal() {
    const raw =
      0.55 * this.cortisol +
      0.3 * this.dopamine +
      0.1 * (1 - this.serotonin) +
      0.08 * (1 - this.energy / 100) -
      0.18
    return clamp(raw)
  }

  get exhausted() {
    return this.energy < PARAMS.exhaustedEnergy
  }

  get hijacked() {
    return this.cortisol > PARAMS.hijackCortisol
  }

  /** 注入外部刺激的神经增量（LLM 也只能给到这一层，且被截断）。 */
  /**
   * 一颗糖哄好：正在气头上时，一个够强的正向多巴胺脉冲会把皮质醇打掉一大半。
   * 不写死"生气就一定要哄 3 次"，只让激素自己塌下去。
   */
  overrideByReward(delta = {}) {
    const dopamine = Number(delta.dopamine ?? 0)
    if (dopamine >= 0.12 && this.cortisol > 0.45) {
      this.hormones.cortisol = Math.max(0.15, this.hormones.cortisol * 0.35)
      this.prideDefense = Math.min(1, (this.prideDefense ?? 0) + 0.25)
      return true
    }
    return false
  }

  applyStimulus(delta = {}, meta = {}) {
    this.quietMin = 0
    const applied = {}
    for (const key of HORMONE_KEYS) {
      const raw = Number(delta[key])
      if (!Number.isFinite(raw)) continue
      // 单次刺激最多推动 0.62，防止"一句话直接拉满"，但也要让顶级冒犯真的能顶到劫持线
      const bounded = Math.max(-0.45, Math.min(0.62, raw))
      const before = this.hormones[key]
      this.hormones[key] = clamp(before + bounded)
      applied[key] = Number((this.hormones[key] - before).toFixed(4))
    }

    this.overrideByReward(delta)
    if (Number.isFinite(delta.energy)) {
      this.energy = clamp(this.energy + Math.max(-25, Math.min(25, delta.energy)), 0, 100)
    }

    const target = Number(meta.valenceTarget)
    if (Number.isFinite(target)) {
      const pull = clamp(meta.pull ?? 0.65, 0, 1)
      this.moodValence = clamp(this.moodValence * (1 - pull) + clamp(target, -1, 1) * pull, -1, 1)
    }

    if (meta.stressor) this.lastStressor = { ...meta.stressor, at: meta.at ?? null }
    if (meta.at) this.stimulusAt = meta.at
    return applied
  }

  /** 每分钟的生理积分：激素回落 + 精力代谢 + 心境回归基线。 */
  decay(dtMin, { hour = 12, sleeping = false } = {}) {
    if (!(dtMin > 0)) return
    this.currentHour = hour
    for (const key of HORMONE_KEYS) {
      const spec = HORMONES[key]
      const target = clamp(circadianTarget(key, hour) + ultradianTarget(key, this.totalAwakeMin), 0, 1)
      this.hormones[key] = clamp(decayTo(this.hormones[key], target, spec.halfLifeMin, dtMin))
    }

    // 精力：清醒时按皮质醇消耗，睡眠窗口快速回充
    if (sleeping) {
      this.energy = clamp(this.energy + PARAMS.energySleepRecoverPerMin * dtMin, 0, 100)
      this.sleepDebtMin = Math.max(0, this.sleepDebtMin - dtMin)
    } else {
      const drain = PARAMS.energyAwakeDrainPerMin * (1 + 0.6 * this.cortisol) * dtMin
      // 发呆也算休息：安静一阵能回一点，但不睡不会回满
      this.quietMin = (this.quietMin ?? 0) + dtMin
      const rest = this.quietMin > 20 ? 0.03 * Math.min(1, this.quietMin / 60) * dtMin : 0
      this.energy = clamp(this.energy - drain + rest, 0, 100)
      this.totalAwakeMin += dtMin
      // 深夜清醒额外累积睡眠债（凌晨三点的心境更脆）
      if (hour >= 0 && hour < 6) this.sleepDebtMin += dtMin * 0.5
    }

    // 心境缓慢回归基线，半衰期 90 分钟：情绪有惯性，但不会永久停在谷底
    this.moodValence = clamp(decayTo(this.moodValence, this.moodBaseline, 90, dtMin), -1, 1)
    return this
  }

  /** 供 UI 直接绘制的快照。 */
  snapshot(labels = {}) {
    return {
      hormones: HORMONE_KEYS.map((key) => {
        const value = this.hormones[key]
        const phase = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
        // 显示层的瞬时振荡：反映递质的 phasic 活动，不参与决策
        const momentary = clamp(value + 0.004 * Math.sin(Date.now() / 2200 + phase), 0, 1)
        return {
          key,
          value: Number(value.toFixed(3)),
          momentary: Number(momentary.toFixed(3)),
          target: Number(clamp(circadianTarget(key, this.currentHour) + ultradianTarget(key, this.totalAwakeMin), 0, 1).toFixed(3)),
          baseline: HORMONES[key].baseline,
          halfLifeMin: HORMONES[key].halfLifeMin,
          label: HORMONES[key].label,
          hint: HORMONES[key].hint,
        }
      }),
      energy: Number(this.energy.toFixed(1)),
      arousal: Number(this.arousal.toFixed(3)),
      mood: Number(this.moodValence.toFixed(3)),
      moodLabel: labels.mood ?? moodWord(this.moodValence),
      exhausted: this.exhausted,
      hijacked: this.hijacked,
      lastStressor: this.lastStressor,
      sleepDebtMin: Math.round(this.sleepDebtMin),
    }
  }

  toJSON() {
    return {
      hormones: { ...this.hormones },
      energy: this.energy,
      moodValence: this.moodValence,
      moodBaseline: this.moodBaseline,
      lastStressor: this.lastStressor,
      stimulusAt: this.stimulusAt,
      sleepDebtMin: this.sleepDebtMin,
      totalAwakeMin: this.totalAwakeMin,
    }
  }

  static fromJSON(json = {}) {
    return new NeuroState(json)
  }
}

export function moodWord(valence) {
  if (valence <= -0.6) return '阴沉'
  if (valence <= -0.25) return '不爽'
  if (valence < 0.12) return '平'
  if (valence < 0.45) return '还行'
  return '轻快'
}
