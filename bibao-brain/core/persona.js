/**
 * 人物档案生成：把"一段话设定"变成可用的 biography。
 *
 * 三条硬规则（保护拟人逻辑）：
 *  1. 关系数值（亲密/信任/敬畏）**由事件推导**，不接受模型直接指定；
 *  2. 核心信念不在这里写——它只能在睡眠回放时由经历演化出来；
 *  3. 事件必须过校验：年龄单调、范围合法、实体必须出现在关系里。
 */

import { SCHEMA_KEYS, clamp } from './constants.js'

const MAX_EVENTS = 30
const MIN_EVENTS = 12

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

export function normalizeSeed(seed = {}) {
  return {
    name: String(seed.name ?? '').trim().slice(0, 12) || '比宝',
    gender: seed.gender === 'male' ? 'male' : 'female',
    ageNow: Math.max(16, Math.min(60, Number(seed.ageNow) || 22)),
    city: String(seed.city ?? '').trim().slice(0, 12),
    occupation: String(seed.occupation ?? '').trim().slice(0, 16),
    tone: String(seed.tone ?? '').trim().slice(0, 40),
    wound: String(seed.wound ?? '').trim().slice(0, 40),
    oneLine: String(seed.oneLine ?? '').trim().slice(0, 40),
    userName: String(seed.userName ?? '').trim().slice(0, 12) || '你',
    userRelation: String(seed.userRelation ?? '').trim().slice(0, 20) || '朋友',
    userHistory: String(seed.userHistory ?? '').trim().slice(0, 60),
  }
}

/** 事件里提到的实体 → 关系（数值由事件统计推出，模型只提供印象）。 */
export function deriveRelations(events = [], hints = []) {
  const byName = new Map()
  for (const hint of hints) {
    const name = String(hint?.name ?? '').trim()
    if (name) byName.set(name, { name, impression: String(hint.impression ?? '').slice(0, 60), tags: hint.tags ?? [] })
  }

  const stats = new Map()
  for (const event of events) {
    for (const raw of event.entities ?? []) {
      const name = String(raw).trim()
      if (!name) continue
      if (!stats.has(name)) stats.set(name, { name, count: 0, positive: 0, negative: 0, intensity: 0, firstAge: 99 })
      const row = stats.get(name)
      row.count += 1
      row.intensity += Math.abs(event.valence) * event.arousal
      row.firstAge = Math.min(row.firstAge, event.age)
      if (event.valence > 0) row.positive += event.valence * event.arousal
      else row.negative += -event.valence * event.arousal
    }
  }

  const relations = []
  for (const row of stats.values()) {
    const hint = byName.get(row.name)
    const total = row.positive + row.negative || 1
    const positiveRatio = row.positive / total
    const intimacy = clamp(18 + row.count * 6 + row.positive * 26 - row.negative * 18, -20, 95)
    const trust = clamp(30 + row.count * 4 + positiveRatio * 45 - (1 - positiveRatio) * 22, 0, 95)
    const powerFear = clamp((1 - positiveRatio) * row.intensity * 45, 0, 90)
    relations.push({
      name: row.name,
      intimacy: Math.round(intimacy),
      trust: Math.round(trust),
      powerFear: Math.round(powerFear),
      tags: hint?.tags ?? [],
      impression: hint?.impression || `从 ${row.firstAge.toFixed(0)} 岁起就在的人`,
    })
  }
  return relations.sort((a, b) => b.intimacy - a.intimacy)
}

/** 校验 + 归一化。不合法就返回 errors，调用方据此重生成或退回模板。 */
export function validatePersona(candidate, { seed } = {}) {
  const base = normalizeSeed(seed ?? candidate?.seed ?? {})
  const errors = []
  const rawEvents = Array.isArray(candidate?.events) ? candidate.events : []
  if (rawEvents.length < MIN_EVENTS) errors.push(`事件太少（${rawEvents.length} < ${MIN_EVENTS}）`)
  if (rawEvents.length > MAX_EVENTS) errors.push(`事件太多（${rawEvents.length} > ${MAX_EVENTS}）`)

  const events = []
  for (const [index, raw] of rawEvents.entries()) {
    const age = Number(raw?.age)
    const title = String(raw?.title ?? '').trim().slice(0, 20)
    const narrative = String(raw?.narrative ?? '').trim().slice(0, 220)
    if (!Number.isFinite(age) || age < 0 || age > base.ageNow) {
      errors.push(`第 ${index + 1} 条年龄非法：${raw?.age}`)
      continue
    }
    if (!title || narrative.length < 20) {
      errors.push(`第 ${index + 1} 条缺少标题或叙事太短`)
      continue
    }
    const impact = {}
    for (const [key, value] of Object.entries(raw?.impact ?? {})) {
      if (!SCHEMA_KEYS.includes(key)) continue
      const delta = Number(value)
      if (!Number.isFinite(delta)) continue
      impact[key] = Math.max(-0.2, Math.min(0.2, delta))
    }
    events.push({
      age: Number(age.toFixed(1)),
      title,
      narrative,
      valence: clamp(Number(raw?.valence) || 0, -1, 1),
      arousal: clamp(Number(raw?.arousal) || 0.4, 0, 1),
      impact,
      tags: (Array.isArray(raw?.tags) ? raw.tags : []).map((tag) => String(tag).slice(0, 8)).slice(0, 4),
      entities: (Array.isArray(raw?.entities) ? raw.entities : []).map((name) => String(name).slice(0, 12)).filter(Boolean).slice(0, 4),
      source: 'ai',
    })
  }

  events.sort((a, b) => a.age - b.age)

  // 实体必须能在关系里找到：缺的就补一段（印象留空，数值照样由事件推）
  const hints = Array.isArray(candidate?.relations) ? candidate.relations : []
  const relations = deriveRelations(events, hints)

  if (errors.length) return { ok: false, errors, persona: null }

  return {
    ok: true,
    errors: [],
    persona: {
      name: base.name,
      fullName: String(candidate?.fullName ?? base.name).slice(0, 24),
      gender: base.gender,
      birthYear: new Date().getFullYear() - base.ageNow,
      ageNow: base.ageNow,
      oneLine: (candidate?.oneLine ?? base.oneLine ?? base.tone ?? '嘴硬心软的普通人').toString().slice(0, 40),
      coreWound: (candidate?.coreWound ?? base.wound ?? '怕被留下').toString().slice(0, 40),
      copingStyle: (candidate?.copingStyle ?? '先推开，再偷偷看对方走没走').toString().slice(0, 60),
      events,
      relations,
      seed: base,
    },
  }
}

/** 没有模型时的兜底：用模板拼一份合理的人生，保证向导永远走得完。 */
export function templatePersona(seedInput = {}) {
  const seed = normalizeSeed(seedInput)
  const cast = ['妈妈', '外婆', seed.userName, '同桌', '班主任']
  const blueprint = [
    { at: 0.08, title: '被留在门口', valence: -0.6, arousal: 0.8, who: '妈妈', tag: '分离' },
    { at: 0.09, title: '外婆的樟脑丸味', valence: 0.3, arousal: 0.5, who: '外婆', tag: '寄养' },
    { at: 0.18, title: '第一次自己走夜路', valence: -0.3, arousal: 0.6, who: '外婆', tag: '独立' },
    { at: 0.24, title: '被同学起了外号', valence: -0.5, arousal: 0.7, who: '同桌', tag: '羞辱' },
    { at: 0.3, title: '考砸了不敢回家', valence: -0.4, arousal: 0.6, who: '班主任', tag: '挫败' },
    { at: 0.36, title: '有人在雨天借了伞', valence: 0.5, arousal: 0.6, who: '同桌', tag: '善意' },
    { at: 0.42, title: '第一次被夸', valence: 0.6, arousal: 0.7, who: '班主任', tag: '认可' },
    { at: 0.48, title: '搬去新的城市', valence: -0.2, arousal: 0.7, who: '妈妈', tag: '迁徙' },
    { at: 0.54, title: '和最好的朋友吵架', valence: -0.6, arousal: 0.8, who: '同桌', tag: '决裂' },
    { at: 0.6, title: '一个人过生日', valence: -0.5, arousal: 0.6, who: '妈妈', tag: '孤独' },
    { at: 0.66, title: '第一次拿到工资', valence: 0.7, arousal: 0.7, who: '外婆', tag: '自立' },
    { at: 0.72, title: '被信任的人放了鸽子', valence: -0.7, arousal: 0.8, who: seed.userName, tag: '失望' },
    { at: 0.78, title: '深夜的一通电话', valence: 0.4, arousal: 0.6, who: seed.userName, tag: '依靠' },
    { at: 0.84, title: '把心里话说了出口', valence: 0.5, arousal: 0.8, who: seed.userName, tag: '坦白' },
    { at: 0.9, title: '决定不再解释', valence: -0.3, arousal: 0.5, who: '妈妈', tag: '抽离' },
    { at: 0.96, title: '把旧照片收进抽屉', valence: -0.2, arousal: 0.4, who: '外婆', tag: '告别' },
  ]
  const events = blueprint.map((item, index) => ({
    age: Number((seed.ageNow * item.at).toFixed(1)),
    title: item.title,
    narrative: `${item.who}在场。那天的事我后来很少提，但有些细节一直没散——${item.title}。我记得自己当时没怎么说话，回去之后才慢慢想明白，原来有些位置从一开始就不属于我。`,
    valence: item.valence,
    arousal: item.arousal,
    impact: {},
    tags: [item.tag, item.who],
    entities: [item.who],
    source: 'template',
    order: index,
  }))
  const relations = deriveRelations(events, [
    { name: '妈妈', impression: '血亲，但总是在告别' },
    { name: '外婆', impression: '唯一稳定过的人' },
    { name: seed.userName, impression: '后来才出现的人，却最要紧' },
    { name: '同桌', impression: '少年时代最亲近又最伤的' },
    { name: '班主任', impression: '给过一次认可的人' },
  ])
  const result = validatePersona(
    {
      oneLine: seed.oneLine || seed.tone || '看起来没事的人',
      coreWound: seed.wound || '怕被留下',
      copingStyle: '先推开，再偷偷看对方走没走',
      events,
      relations,
    },
    { seed },
  )
  if (result.ok) result.persona.relations = relations
  return result
}

export function buildGenerationPrompt(seedInput = {}) {
  const seed = normalizeSeed(seedInput)
  const system = [
    '你在为一个拟人角色编写"过去经历"。只输出 JSON，不要解释。',
    '格式：{"fullName":"","oneLine":"","coreWound":"","copingStyle":"","events":[{"age":0,"title":"","narrative":"","valence":-1,"arousal":0,"tags":[""],"entities":[""],"impact":{}}],"relations":[{"name":"","impression":""}]}',
    '要求：',
    `1. 12-16 条事件，age 从 0 到 ${seed.ageNow}，按时间递增，不要集中在同一年。`,
    '2. narrative 50-90 字，第一人称过去时，只写具体场景（谁在场、说了什么、你做了什么），不要总结、不要评价、不要金句。',
    '3. valence ∈ [-1,1]（负=难受），arousal ∈ [0,1]（强度）。',
    '4. entities 只能填人名/称谓，且必须在 relations 里出现；每条的 entities 不超过 3 个。',
    '5. relations 只给 name 和 impression（一句话印象），不要写亲密/信任数值——那些由事件推导。',
    '6. impact 可留空；如要写，键只能是 self_worth / world_trust / attachment_anxiety / conflict_avoidance / autonomy_need / fairness，值在 -0.2..0.2。',
    '7. 不要写死亡、性、自残等极端内容；可以写分离、争吵、羞辱、被辜负。',
  ].join('\n')
  const user = [
    `名字：${seed.name}`,
    `现在年龄：${seed.ageNow}`,
    seed.city ? `城市：${seed.city}` : '',
    seed.occupation ? `职业：${seed.occupation}` : '',
    seed.tone ? `性格气质：${seed.tone}` : '',
    seed.wound ? `核心伤口：${seed.wound}` : '',
    `重要他人：${seed.userName}（${seed.userRelation}${seed.userHistory ? `，${seed.userHistory}` : ''}）`,
    '请生成她/他的过去经历。',
  ].filter(Boolean).join('\n')
  return { system, user }
}

export function parsePersonaJson(raw) {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
