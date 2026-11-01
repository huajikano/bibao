/** 确定性伪随机：同一 seed 同一序列，沙盒验收可复现。 */

export function hashString(text) {
  let h = 2166136261 >>> 0
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function createRng(seed = 1) {
  let a = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (list) => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    chance: (p) => next() < p,
    /** 不重复取 n 个 */
    sample: (list, n) => {
      const pool = list.slice()
      const out = []
      while (pool.length && out.length < n) {
        out.push(pool.splice(Math.floor(next() * pool.length), 1)[0])
      }
      return out
    },
  }
}

let uidSeq = 0

export function uid(prefix, rng) {
  // 时间戳 + 进程内自增 + 一点随机：同一 seed 重启也不会生成重复 id
  uidSeq = (uidSeq + 1) % 0xffffff
  const stamp = Date.now().toString(36).slice(-5)
  const rand = Math.floor((rng?.next?.() ?? Math.random()) * 0xffff)
    .toString(16)
    .padStart(4, '0')
  return `${prefix}_${stamp}${uidSeq.toString(36)}${rand}`
}
