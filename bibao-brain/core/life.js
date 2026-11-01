/**
 * 生命周期快进编译器（0 岁 → 当前年龄）。
 *
 * 读 biography.json，按年龄顺序把每个事件编译成：
 *   ΔCoreSchema = η(Age) · Impact
 *   情景记忆   S0 = S_base · (1 + 8·|V|·A) · β_age
 * 事件之间的时间推进由记忆的解析衰减自然完成（R 由 at 与当前时间算出），
 * 因此"怀旧隆起"与"婴儿期遗忘"在编译结果里直接可见。
 */

import { DAY_MS, betaAge, clamp, eta } from './constants.js'
import { CoreSchema } from './schema.js'
import { MemorySystem } from './memory.js'
import { SocialMemory } from './social.js'

export const YEAR_MS = 365.25 * DAY_MS

export function birthMoment(biography, nowMs) {
  const anchor = Number.isFinite(nowMs) ? nowMs : Date.now()
  return anchor - (Number(biography.ageNow) || 22) * YEAR_MS
}

export function bootstrapLife(biography, { rng, nowMs }) {
  const schema = new CoreSchema()
  const social = new SocialMemory(biography.relations ?? [])
  const memory = new MemorySystem({ rng })
  const ageNow = Number(biography.ageNow) || 22
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const birth = birthMoment(biography, now)

  const events = [...(biography.events ?? [])].sort((a, b) => a.age - b.age)
  const timeline = []

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const age = Number(event.age) || 0
    // 以"当前时刻"为锚点倒推，最近的生活事件因此保持新鲜
    const at = now - (ageNow - age) * YEAR_MS
    const deltas = {}
    for (const [key, impact] of Object.entries(event.impact ?? {})) {
      deltas[key] = eta(age) * Number(impact)
    }
    const applied = schema.updateFromConsolidation(deltas)

    const node = memory.write({
      id: `life-${index + 1}`,
      now: at,
      age,
      arousal: Number(event.arousal) || 0.4,
      pe: clamp(Math.abs(Number(event.valence) || 0) * 0.9),
      force: true,
      valence: Number(event.valence) || 0,
      salience: clamp(0.35 + 0.6 * Math.abs(Number(event.valence) || 0)),
      title: event.title,
      narrative: event.narrative,
      tags: event.tags ?? [],
      schemaHints: event.impact ?? {},
      source: 'life',
      betaAge: betaAge(age),
      infantile: age < 3.5,
      entityId: null,
      entityName: null,
    })

    timeline.push({
      index: index + 1,
      age,
      at,
      title: event.title,
      stage: stageOf(age),
      eta: Number(eta(age).toFixed(4)),
      betaAge: betaAge(age),
      schemaDelta: applied,
      memoryId: node?.id ?? null,
      stabilityDays: node ? Number(node.sDays.toFixed(2)) : null,
      tier: node ? memory.tier(node, now) : null,
    })
  }

  const moodBaseline = clamp(
    0.05 + 0.45 * schema.get('self_worth') + 0.25 * schema.get('world_trust') - 0.18 * schema.get('attachment_anxiety'),
    -0.5,
    0.5,
  )

  return { schema, social, memory, birth, now, age: ageNow, timeline, moodBaseline, biography }
}

export function stageOf(age) {
  if (age < 3.5) return '婴幼期'
  if (age < 12) return '童年期'
  if (age <= 18) return '青春期'
  return '成年近况'
}
