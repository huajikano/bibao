/** 时间与拟人打字节奏（固定东八区，沙盒与真机同一口径）。 */

import { MIN_MS } from './constants.js'

export const TZ_OFFSET_MS = 8 * 3_600_000

export function localParts(ms) {
  const shifted = new Date(ms + TZ_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

export function clockLabel(ms) {
  const parts = localParts(ms)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 她该知道的那一天：不是"15:41"，是"2026-11-09 周一 15:41"。 */
export function dateLabel(ms) {
  const parts = localParts(ms)
  const weekday = WEEKDAYS[new Date(ms + TZ_OFFSET_MS).getUTCDay()]
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${weekday} ${clockLabel(ms)}`
}

/**
 * "现在几点""今天几号"这类问题，真人不查手机也答得出，而她以前靠猜（会把 11 月说成 9 月）。
 * 命中了就直接从生物钟答，不花模型、不留空档。
 */
export function clockAnswer(text, ms) {
  const said = String(text ?? '')
  // 只接"现在几点/今天几号"这种问当下的事实；"你几点睡"问的是习惯，别抢答
  const wantsTime = /(现在.{0,4}(几点|多少点|时间)|几点钟了|多少点了)/.test(said)
  const wantsDate = /(几月几号|几月几日|今天.{0,4}(几月|几号|几日|周几|星期几)|现在.{0,4}(几月|几号|日期)|星期几|今天的日期)/.test(said)
  if (!wantsTime && !wantsDate) return ''
  const parts = localParts(ms)
  const weekday = WEEKDAYS[new Date(ms + TZ_OFFSET_MS).getUTCDay()]
  const time = `${parts.hour}:${String(parts.minute).padStart(2, '0')}`
  const date = `${parts.month}月${parts.day}号 ${weekday}`
  if (wantsTime && wantsDate) return `现在${time}，${date}`
  if (wantsDate) return date
  return `现在${time}`
}

export function dayKey(ms) {
  const parts = localParts(ms)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function isSleeping(hour) {
  return hour < 7
}

export function isNight(ms) {
  const { hour } = localParts(ms)
  return hour < 6
}

/** T_delay = T_read + len × 0.18s × (100 / max(20, energy)) + 犹豫 */
export function motorPlan(bubbles, energy, hesitation = 0) {
  const scale = 100 / Math.max(20, energy)
  let cursor = 0
  return bubbles.map((bubble, index) => {
    const read = index === 0 ? 0.6 : 0.25
    const type = Math.min(6, bubble.length) * 0.18 * scale
    const wobble = hesitation * (index === 0 ? 1 : 0.6)
    cursor += read + type + wobble
    return {
      index,
      text: bubble,
      chars: bubble.length,
      readSec: Number(read.toFixed(2)),
      typeSec: Number(type.toFixed(2)),
      delaySec: Number(cursor.toFixed(2)),
      delayMs: Math.round(cursor * 1000),
    }
  })
}

export function silenceMinutes(state, lastExternalAt, now) {
  const anchor = lastExternalAt ?? state.stimulusAt ?? now
  return Math.round((now - anchor) / MIN_MS)
}
