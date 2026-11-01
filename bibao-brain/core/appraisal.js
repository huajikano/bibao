/**
 * 情感评估与主动推理（FEP）路由。
 *
 * 这一层只输出"判断"，不改任何记忆：谁在说话、多亲、多怕、踩没踩核心自尊、
 * 能不能吸收、该防御还是该让步、该不该在群里装死。
 */

import { PARAMS, clamp } from './constants.js'
import { CORE_CUES } from './schema.js'

const LEXICON = {
  hostile: ['废物', '垃圾', '蠢', '傻', '闭嘴', '滚', '恶心', '有病', '烦', '幼稚', '可笑', '丢人', '没救', '你懂什么', '就你'],
  preach: ['你应该', '你必须', '听我的', '为你好', '你错了', '你根本', '你不懂', '别那么', '成熟点', '想开点', '都是你', '我早就说'],
  care: ['没事吧', '怎么了', '在吗', '抱抱', '辛苦了', '别熬夜', '早点睡', '想你', '等你', '吃饭没', '注意身体'],
  gossip: ['听说', '笑死', '你知道', '八卦', '绝了', '离谱', '真的假的', '居然', '吃瓜', '爆料'],
  desire: ['想见', '想抱', '想你了', '喜欢', '陪陪我', '别走'],
}

export const DEFAULT_INTERESTS = ['猫', 'livehouse', '乐队', '番剧', '摄影', '通宵', '游戏', '奶茶']

export function analyzeText(text = '') {
  const raw = String(text)
  const lower = raw.toLowerCase()
  const count = (list) => list.reduce((sum, word) => sum + (lower.includes(word.toLowerCase()) ? 1 : 0), 0)
  const hostile = count(LEXICON.hostile)
  const preach = count(LEXICON.preach)
  const care = count(LEXICON.care)
  const gossip = count(LEXICON.gossip)
  const desire = count(LEXICON.desire)
  const question = /[?？]|吗|呢|怎么|为什么|啥|什么/.test(raw) ? 1 : 0
  const exclaim = /[!！]/.test(raw) ? 1 : 0
  return {
    text: raw,
    length: raw.length,
    hostile,
    preach,
    care,
    gossip,
    desire,
    question,
    exclaim,
    hostility: clamp(hostile * 0.55 + exclaim * 0.1),
    preaching: clamp(preach * 0.5),
    warmth: clamp(care * 0.5 + desire * 0.35),
    gossipy: clamp(gossip * 0.4),
    urgency: clamp(hostile * 0.4 + exclaim * 0.2),
  }
}

/** 命中的核心信念线索（只报线索，不改数值）。 */
export function coreCues(text = '') {
  const raw = String(text)
  const cues = []
  for (const [word, hits] of Object.entries(CORE_CUES)) {
    if (raw.includes(word)) {
      for (const hit of hits) cues.push({ ...hit, word })
    }
  }
  return cues
}

/** 内部预测：把当前线索与既有印象/悬置预期比一次，得到预测误差。 */
export function estimatePE({ analysis, relation, schemaHits = [], expectation = null, topicNovelty = 0 }) {
  const trustNorm = (relation?.trust ?? 35) / 100
  let pe =
    0.16 +
    0.34 * analysis.hostility +
    0.3 * analysis.preaching +
    0.2 * Math.min(1, schemaHits.length) +
    0.16 * clamp(topicNovelty) +
    0.08 * (relation ? 0 : 1) -
    0.08 * trustNorm
  // 如果对方是"刚刚吵过的人"却突然示好，预测误差反而更高
  if (expectation && expectation.kind === 'hostile' && analysis.warmth > 0.3) pe += 0.18
  return clamp(pe)
}

export function salienceOf({
  analysis,
  relation,
  channel = 'private',
  atMe = false,
  nameMention = false,
  priority = 0,
  interests = DEFAULT_INTERESTS,
}) {
  const intimacy = (relation?.intimacy ?? 0) / 100
  const interestHit = interests.some((word) => analysis.text.includes(word))
  let value =
    0.18 +
    0.16 * analysis.question +
    0.3 * analysis.hostility +
    0.12 * analysis.warmth +
    0.1 * analysis.gossipy +
    0.14 * (nameMention ? 1 : 0) +
    0.12 * (interestHit ? 1 : 0) +
    0.16 * Math.max(0, intimacy) -
    0.05 * Math.max(0, -intimacy)
  if (atMe) value += 0.2
  // 私聊是"有人直接对着你说话"，比群里的公共噪音更容易抢占工作空间
  // 私聊是有人直接对着你说话，比群里的公共噪音更容易抢占工作空间
  if (channel === 'private') value += 0.35
  value += clamp(priority, 0, 0.5)
  return {
    salience: clamp(value),
    interestHit,
    intimacy,
  }
}

/**
 * 主动推理二选一路由。
 * 返回 route，以及一句给 UI 的路由理由（state machine 的"裁决书"）。
 */
export function decideRoute({
  analysis,
  relation,
  state,
  schemaHits = [],
  pe = 0,
  channel = 'private',
  atMe = false,
  salience = 0,
  silenceMin = 0,
}) {
  const reasons = []
  // 踩到核心信念就是踩到了：不管 PE 读数多"温和"，都不许改信念，只许防御
  const defensive =
    schemaHits.length > 0 || (pe > PARAMS.defensePE && analysis.preaching >= 0.5)
  let route = 'REPLY_CURRENT'

  if (defensive) {
    const trust = relation?.trust ?? 35
    const fear = relation?.powerFear ?? 0
    if (channel === 'group' && !atMe && analysis.gossipy > 0.25) {
      route = 'TRANSFER_PRIVATE_GOSSIP'
      reasons.push('群内高唤醒但公开暴露风险高，改走私聊吐槽')
    } else if (trust < 30 && (relation?.defiances ?? 0) >= 5) {
      route = 'SILENT_READ'
      reasons.push('信任已经耗光，不再供给情绪价值，直接冷处理')
    } else if (fear >= 0.55) {
      route = 'REPLY_CURRENT'
      reasons.push('对权力恐惧高，表面客气打哈哈，内心记一笔')
    } else {
      route = 'REPLY_CURRENT'
      reasons.push('触及核心自尊，拒绝修改信念，改用外推防御')
    }
  } else if (channel === 'group' && !atMe && analysis.gossipy > 0.3 && salience > 0.5) {
    route = 'TRANSFER_PRIVATE_GOSSIP'
    reasons.push('八卦值得吃，但不值得在群里表态')
  } else if (state.exhausted || (state.energy < PARAMS.lowEnergy && salience < 0.55)) {
    route = 'SILENT_READ'
    reasons.push('精力见底，只回最低成本的反应')
  } else if (silenceMin > 180 && salience < 0.45) {
    route = 'POKE_ONLY'
    reasons.push('懒得打字，戳一下就算回应')
  } else if (analysis.warmth > 0.4) {
    reasons.push('感知到照顾意图，允许小幅让步')
  } else {
    reasons.push('预测误差可控，正常回应')
  }

  return { route, defensive, reasons }
}

/** 社会面具：同一句冒犯，对死党 / 陌生人 / 忌惮的权威完全不同。 */
export function maskStyle(relation, state) {
  const intimacy = relation?.intimacy ?? 0
  const fear = relation?.powerFear ?? 0
  if (fear >= 0.55) return 'polite'
  if (intimacy >= 60) return 'banter'
  if (state.hijacked || state.cortisol > 0.65 || intimacy <= 15) return 'cold'
  if (intimacy >= 30) return 'warm'
  return 'cold'
}

/** 外部刺激 → 神经增量（LLM 无权重置，只能在这之上被钳制）。 */
export function stimulusDelta({ analysis, relation, schemaHits = [], channel = 'private' }) {
  const delta = { cortisol: 0, dopamine: 0, oxytocin: 0, serotonin: 0 }
  let valenceTarget = 0

  if (analysis.hostility > 0) {
    delta.cortisol += 0.5 * analysis.hostility
    delta.serotonin -= 0.1 * analysis.hostility
    delta.dopamine -= 0.06 * analysis.hostility
    valenceTarget -= 0.8 * analysis.hostility
  }
  if (analysis.preaching > 0) {
    delta.cortisol += 0.26 * analysis.preaching
    delta.serotonin -= 0.06 * analysis.preaching
    valenceTarget -= 0.45 * analysis.preaching
  }
  if (analysis.warmth > 0) {
    delta.oxytocin += 0.2 * analysis.warmth
    delta.cortisol -= 0.12 * analysis.warmth
    delta.dopamine += 0.08 * analysis.warmth
    valenceTarget += 0.5 * analysis.warmth
  }
  if (analysis.gossipy > 0) {
    delta.dopamine += 0.12 * analysis.gossipy
    valenceTarget += 0.12 * analysis.gossipy
  }
  if (!analysis.hostility && !analysis.preaching && !analysis.warmth && !analysis.gossipy) {
    delta.dopamine += 0.03
    valenceTarget += 0.02
  }
  if (schemaHits.length) {
    delta.cortisol += 0.16 * Math.min(1, schemaHits.length)
    delta.serotonin -= 0.05
    valenceTarget -= 0.2 * Math.min(1, schemaHits.length)
  }

  const closeness = clamp(((relation?.intimacy ?? 0) + 40) / 140)
  const intimacyDelta =
    analysis.hostility > 0
      ? -3 - 4 * closeness
      : analysis.warmth > 0
        ? 1.6 + 2 * closeness
        : analysis.gossipy > 0
          ? 0.8
          : 0.15

  return {
    delta,
    valenceTarget: clamp(valenceTarget, -1, 1),
    intimacyDelta,
    trustDelta: analysis.hostility > 0 ? -2.5 * analysis.hostility : analysis.warmth > 0 ? 0.6 : 0,
  }
}

/** 事件 → 睡眠期才允许被汇总的慢系统线索。 */
export function schemaHintsFor(analysis, schemaHits = []) {
  const hints = {}
  if (analysis.hostility > 0.3) {
    hints.self_worth = -0.6 * analysis.hostility
    hints.world_trust = -0.3 * analysis.hostility
  }
  if (analysis.preaching > 0.2) {
    hints.autonomy_need = 0.4 * analysis.preaching
    hints.world_trust = (hints.world_trust ?? 0) - 0.2 * analysis.preaching
  }
  if (analysis.warmth > 0.2) {
    hints.world_trust = (hints.world_trust ?? 0) + 0.5 * analysis.warmth
    hints.attachment_anxiety = -0.3 * analysis.warmth
  }
  for (const hit of schemaHits) {
    hints[hit.belief] = (hints[hit.belief] ?? 0) - 0.25
  }
  return hints
}

export function tagsFor(analysis, schemaHits) {
  const tags = []
  if (analysis.hostility > 0.3) tags.push('被否定')
  if (analysis.preaching > 0.2) tags.push('说教')
  if (analysis.warmth > 0.2) tags.push('温柔')
  if (analysis.gossipy > 0.2) tags.push('吃瓜')
  if (schemaHits.length) tags.push('羞耻')
  if (!tags.length) tags.push('日常')
  return tags
}
