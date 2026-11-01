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
