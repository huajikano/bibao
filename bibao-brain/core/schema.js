/**
 * 核心信念（CoreSchema）：固执先验。
 *
 * 白天实时交互期间只允许改工作记忆与关系权重，绝不修改这里；
 * 唯一入口是睡眠交叉回放时的新皮层慢速可塑性 updateFromConsolidation()。
 */

import { SCHEMA_KEYS, SCHEMA_SEED, clamp } from './constants.js'

export class CoreSchema {
  constructor(seed = SCHEMA_SEED) {
    this.beliefs = {}
    for (const key of SCHEMA_KEYS) {
      const spec = seed[key] ?? SCHEMA_SEED[key]
      this.beliefs[key] = {
        key,
        value: clamp(spec.value, -1, 1),
        weight: clamp(spec.weight),
        label: spec.label,
        protected: Boolean(spec.protected),
        revisions: 0,
      }
    }
  }

  get(key) {
    return this.beliefs[key]?.value ?? 0
  }

  weight(key) {
    return this.beliefs[key]?.weight ?? 0
  }

  /** 被外部信息触碰到的、权重够高的核心信念。 */
  touchedBy(cues = []) {
    const hits = []
    for (const cue of cues) {
      const belief = this.beliefs[cue.belief]
      if (!belief) continue
      if (belief.weight >= cue.minWeight && (belief.protected || belief.weight >= 0.6)) {
        hits.push({ ...belief, cue: cue.cue })
      }
    }
    return hits
  }

  /**
   * 睡眠期慢速更新：delta 已经乘过 η(Age)，这里只做限幅并记账。
   * 返回真正落库的 Δ，便于沙盒断言"白天为零"。
   */
  updateFromConsolidation(deltas = {}) {
    const applied = {}
    for (const [key, delta] of Object.entries(deltas)) {
      const belief = this.beliefs[key]
      if (!belief || !Number.isFinite(delta)) continue
      const bounded = Math.max(-0.06, Math.min(0.06, delta))
      const before = belief.value
      belief.value = clamp(before + bounded, -1, 1)
      applied[key] = Number((belief.value - before).toFixed(5))
      if (belief.value !== before) belief.revisions += 1
    }
    return applied
  }

  signature() {
    return SCHEMA_KEYS.map((key) => this.beliefs[key].value.toFixed(6)).join('|')
  }

  snapshot() {
    return SCHEMA_KEYS.map((key) => {
      const b = this.beliefs[key]
      return {
        key,
        label: b.label,
        value: Number(b.value.toFixed(3)),
        weight: b.weight,
        protected: b.protected,
        revisions: b.revisions,
      }
    })
  }

  toJSON() {
    const out = {}
    for (const key of SCHEMA_KEYS) {
      const b = this.beliefs[key]
      out[key] = { value: b.value, weight: b.weight, revisions: b.revisions }
    }
    return out
  }

  static fromJSON(json = {}) {
    const schema = new CoreSchema()
    for (const key of SCHEMA_KEYS) {
      const saved = json[key]
      if (!saved) continue
      if (Number.isFinite(saved.value)) schema.beliefs[key].value = clamp(saved.value, -1, 1)
      if (Number.isFinite(saved.weight)) schema.beliefs[key].weight = clamp(saved.weight)
      if (Number.isFinite(saved.revisions)) schema.beliefs[key].revisions = saved.revisions
    }
    return schema
  }
}

/** 文本线索 → 被顶撞的信念。appraisal 只负责给线索，不直接改数值。 */
export const CORE_CUES = {
  自私: [{ belief: 'self_worth', cue: '被指认自私', minWeight: 0.6 }],
  矫情: [{ belief: 'self_worth', cue: '被说矫情', minWeight: 0.6 }],
  玻璃心: [{ belief: 'self_worth', cue: '被说玻璃心', minWeight: 0.6 }],
  没教养: [{ belief: 'self_worth', cue: '被否定教养', minWeight: 0.6 }],
  废物: [{ belief: 'self_worth', cue: '被贬为废物', minWeight: 0.6 }],
  你这种人: [{ belief: 'self_worth', cue: '被归类否定', minWeight: 0.6 }],
  没人会喜欢: [{ belief: 'attachment_anxiety', cue: '被断言不被喜欢', minWeight: 0.6 }],
  想开点: [
    { belief: 'autonomy_need', cue: '被要求情绪听话', minWeight: 0.6 },
    { belief: 'self_worth', cue: '感受被降级', minWeight: 0.7 },
  ],
  你应该: [{ belief: 'autonomy_need', cue: '被说教', minWeight: 0.6 }],
  你必须: [{ belief: 'autonomy_need', cue: '被命令', minWeight: 0.6 }],
  为你好: [{ belief: 'autonomy_need', cue: '以关心为名的控制', minWeight: 0.6 }],
  听我的: [{ belief: 'autonomy_need', cue: '被要求服从', minWeight: 0.6 }],
  你错了: [{ belief: 'fairness', cue: '被单方面判定错误', minWeight: 0.55 }],
}
