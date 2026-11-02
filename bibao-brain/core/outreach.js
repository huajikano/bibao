/**
 * 主动分享：她可以偶尔先开口，但这一步必须很难触发、很容易关掉。
 *
 * 默认关闭。打开后也只满足这些条件才会发：
 *  - 对方是亲近的人（亲密度够）；
 *  - 她已经沉默很久，不是刚聊完就追着说；
 *  - 今天确实发生了一件她自己的事（生活流里有 6 小时内的新事件）；
 *  - 精力够、没有在气头上、没有挂起的冲突；
 *  - 每个对象每天最多一条，全局每天最多一条。
 *
 * 这里只做"该不该说 + 说什么"的纯决策，不直接发消息。
 */

import { HOUR_MS } from './constants.js'

export const DEFAULT_OUTREACH = {
  enabled: false,
  minSilenceMin: 360,
  maxPerDay: 1,
  minIntimacy: 55,
  cooldownHours: 8,
}

function clampText(value, max = 60) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function pickLine(event, relation) {
  const text = clampText(event?.text ?? '', 42)
  if (!text) return ''
  const name = clampText(relation?.name ?? '', 8)
  const valence = Number(event?.valence ?? 0)
  const lines = valence > 0.2
    ? [
        `今天${text}，笑死，突然想跟你说`,
        `今天${text}，本来想自己乐，还是跟你讲一声`,
        `刚才${text}，你那边呢`,
      ]
    : valence < -0.15
      ? [
          `今天${text}，有点烦，不想跟别人说`,
          `今天${text}，想想还是跟你说吧`,
          `${name ? `${name}，` : ''}今天${text}，你在干嘛`,
        ]
      : [
          `今天${text}，你那边怎么样`,
          `刚才${text}，突然想起你`,
          `今天${text}，没什么事，就是想说一声`,
        ]
  return lines[Math.floor(Math.random() * lines.length)]
}

/**
 * @returns {{ok:boolean, reason:string, targetId?:string, targetName?:string, text?:string}}
 */
export function planOutreach({
  now = Date.now(),
  enabled = false,
  relation = null,
  life = null,
  state = {},
  selfModel = null,
  silenceMin = 0,
  lastOutAt = 0,
  todayCount = 0,
  cfg = {},
} = {}) {
  const conf = { ...DEFAULT_OUTREACH, ...(cfg ?? {}), enabled: enabled || cfg?.enabled === true }
  if (!conf.enabled) return { ok: false, reason: 'disabled' }
  if (!relation) return { ok: false, reason: 'no-relation' }
  if (Number(relation.intimacy ?? 0) < Number(conf.minIntimacy ?? 55)) return { ok: false, reason: 'not-close-enough' }
  if (todayCount >= Number(conf.maxPerDay ?? 1)) return { ok: false, reason: 'daily-limit' }
  if (lastOutAt && now - lastOutAt < Number(conf.cooldownHours ?? 8) * HOUR_MS) return { ok: false, reason: 'cooldown' }
  if (Number(silenceMin) < Number(conf.minSilenceMin ?? 360)) return { ok: false, reason: 'not-quiet-enough' }
  if (Number(state.energy ?? 100) < 30) return { ok: false, reason: 'too-tired' }
  if (Number(state.cortisol ?? 0) > 0.6) return { ok: false, reason: 'too-stressed' }
  if (Number(state.moodValence ?? 0) < -0.45) return { ok: false, reason: 'mood-too-low' }
  if (Number(selfModel?.style?.initiative ?? 0.35) < 0.3) return { ok: false, reason: 'not-initiative' }

  const events = Array.isArray(life?.today) ? life.today : []
  const latest = events
    .filter((item) => now - Number(item.at ?? 0) <= 6 * HOUR_MS && Number(item.at ?? 0) <= now)
    .sort((a, b) => b.at - a.at)[0]
  if (!latest) return { ok: false, reason: 'nothing-to-share' }

  const text = pickLine(latest, relation)
  if (!text) return { ok: false, reason: 'empty-line' }
  return {
    ok: true,
    reason: 'ok',
    targetId: String(relation.id ?? relation.qq ?? ''),
    targetName: clampText(relation.name ?? '', 20),
    text: clampText(text, 90),
    event: { at: latest.at, text: latest.text },
  }
}
