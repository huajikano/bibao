/**
 * 会学的那部分：偏好、联想、习惯化。
 *
 * 三条都很便宜，但能让行为不是"每次都一样"：
 *  - 偏好：某个词总是伴随好的体验，之后听到它就更上心；反之变成雷区。
 *  - 联想：某个话题总是和某种心情一起出现，下次心情对上时更容易被想起。
 *  - 习惯化：同一句话反复出现，反应越来越淡（人对重复刺激会钝化）。
 */

const MAX_WORDS = 400

function wordsOf(text) {
  const source = String(text ?? '')
  const set = new Set()
  for (const word of source.match(/[a-zA-Z0-9]{2,}/g) ?? []) set.add(word.toLowerCase())
  const cjk = source.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let index = 0; index < cjk.length - 1; index += 1) set.add(cjk.slice(index, index + 2))
  return [...set].slice(0, 24)
}

export class HabitMemory {
  constructor(state = {}) {
    this.preferences = new Map(Object.entries(state.preferences ?? {}))
    this.habits = new Map(Object.entries(state.habits ?? {}))
    this.associations = new Map(Object.entries(state.associations ?? {}))
  }

  /** 一句话过后：更新偏好与习惯计数。valence ∈ [-1,1]。 */
  observe({ text, valence = 0, tags = [], entityId = '', mood = 0, at = Date.now() }) {
    const weight = Math.max(-1, Math.min(1, valence))
    for (const word of wordsOf(text)) {
      const next = (this.preferences.get(word) ?? 0) * 0.985 + weight * 0.12
      this.preferences.set(word, Math.max(-1.2, Math.min(1.2, next)))
    }
    // 只看最近 400 个词，防止无限长
    if (this.preferences.size > MAX_WORDS) {
      const sorted = [...this.preferences.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      this.preferences = new Map(sorted.slice(0, MAX_WORDS))
    }

    const habitKey = `${entityId}:${String(text).slice(0, 12)}`
    const habit = this.habits.get(habitKey) ?? { count: 0, at }
    habit.count = Math.min(12, habit.count + 1)
    habit.at = at
    this.habits.set(habitKey, habit)
    if (this.habits.size > 300) this.habits.delete(this.habits.keys().next().value)

    const bucket = mood > 0.3 ? '好' : mood < -0.3 ? '差' : '平'
    for (const tag of tags.slice(0, 3)) {
      const key = `${tag}|${bucket}`
      const row = this.associations.get(key) ?? { count: 0 }
      row.count = Math.min(20, row.count + 1)
      this.associations.set(key, row)
    }
  }

  /** 习惯化：这句话最近说过几次，越多越不敏感。 */
  habituation(entityId, text) {
    const habit = this.habits.get(`${entityId}:${String(text).slice(0, 12)}`)
    if (!habit) return 0
    const cooling = (Date.now() - (habit.at ?? 0)) / 60000
    if (cooling > 180) return 0
    return Math.min(0.45, habit.count * 0.08)
  }

  /** 偏好分：这句话里她喜欢/讨厌的词，取最强的一个。 */
  preferenceOf(text) {
    let best = 0
    for (const word of wordsOf(text)) best = Math.abs((this.preferences.get(word) ?? 0)) > Math.abs(best) ? this.preferences.get(word) ?? 0 : best
    return best
  }

  /** 话题和当前心情的联想强度，用来给检索加分。 */
  associationOf(tags, mood) {
    const bucket = mood > 0.3 ? '好' : mood < -0.3 ? '差' : '平'
    let score = 0
    for (const tag of tags) score += (this.associations.get(`${tag}|${bucket}`)?.count ?? 0) * 0.02
    return Math.min(0.25, score)
  }

  toJSON() {
    return {
      preferences: Object.fromEntries(this.preferences),
      habits: Object.fromEntries(this.habits),
      associations: Object.fromEntries(this.associations),
    }
  }
}
