/**
 * 场面操作：把备战席的人放上场、把掉在地上的球捡起来。
 * 只算"该动谁、动到哪"，不碰鼠标。
 */

/** 棋盘优先填充顺序：中间两行先满，再往前后补。 */
const FILL_ORDER = [
  [1, 3], [1, 2], [1, 4], [1, 1], [1, 5], [1, 0], [1, 6],
  [0, 3], [0, 2], [0, 4], [0, 1], [0, 5], [0, 0], [0, 6],
  [2, 3], [2, 2], [2, 4], [2, 1], [2, 5], [2, 0], [2, 6],
  [3, 3], [3, 2], [3, 4], [3, 1], [3, 5], [3, 0], [3, 6],
]

/**
 * 上人：备战席有人、棋盘有空位，就按顺序摆上去。
 * @param {{benchFilled?: number[], boardEmpty?: Array<[number, number]>, max?: number}} input
 */
export function planPlacements({ benchFilled = [], boardEmpty = [], max = 2 } = {}) {
  const empty = new Set((boardEmpty ?? []).map(([row, col]) => `${row},${col}`))
  const targets = FILL_ORDER.filter(([row, col]) => empty.has(`${row},${col}`)).slice(0, Math.max(0, max))
  const sources = (benchFilled ?? []).slice(0, targets.length)
  return sources.map((benchSlot, index) => ({
    type: 'place',
    benchSlot,
    row: targets[index][0],
    col: targets[index][1],
  }))
}

/** 捡球：每个球点一下，最多三个，避免连点。 */
export function planPickups({ orbs = [], max = 3 } = {}) {
  return (orbs ?? [])
    .filter((point) => Number.isFinite(Number(point?.[0] ?? point?.x)) && Number.isFinite(Number(point?.[1] ?? point?.y)))
    .slice(0, max)
    .map((point) => ({
      type: 'pickup',
      x: Number(point?.[0] ?? point.x),
      y: Number(point?.[1] ?? point.y),
    }))
}
