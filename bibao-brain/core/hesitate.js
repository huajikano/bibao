/**
 * 犹豫：人不是"想好了就发"。打完又删、说到一半停住、发完再补一句，
 * 都是真实发生的。这里在生成之后加一层，决定这条消息以什么形态出去。
 *
 * 只返回决策，不直接改状态，方便测试和回放。
 */

export function decideHesitation({ bubbles = [], state = {}, relation = {}, pe = 0, rng } = {}) {
  const roll = () => (typeof rng?.next === 'function' ? rng.next() : Math.random())
  const cortisol = Number(state.cortisol ?? 0)
  const mood = Number(state.moodValence ?? 0)
  const intimacy = Number(relation?.intimacy ?? 0)

  // 1) 打完又删：正在气头上、又不是对亲近的人
  const abortChance = cortisol > 0.6 && intimacy < 40 ? 0.22 : 0.02
  if (bubbles.length > 0 && roll() < abortChance) {
    return { kind: 'abort', note: '打了一句，盯着看了两秒，又全删了' }
  }

  // 2) 只说一半：对方还不熟，话到嘴边收回去
  const trimChance = bubbles.length >= 3 && intimacy < 25 ? 0.3 : bubbles.length >= 3 ? 0.06 : 0
  if (trimChance > 0 && roll() < trimChance) {
    return { kind: 'trim', note: '后面那几句想了想还是咽回去了' }
  }

  // 3) 发完再补一句：心里没底，忍不住回头补
  const afterChance = (mood < -0.25 && bubbles.length >= 1 ? 0.2 : 0) + (pe > 0.55 ? 0.1 : 0.03)
  if (bubbles.length > 0 && roll() < afterChance) {
    const tails = ['……算了', '当我没说', '别当真', '你自己看着办吧']
    return { kind: 'afterthought', note: '发完又有点后悔，补了一句', tail: tails[Math.floor(roll() * tails.length)] }
  }

  return { kind: 'none' }
}
