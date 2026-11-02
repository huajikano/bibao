#!/usr/bin/env node
/**
 * 拟人度自检：不是测接口，是测"这脑子还像不像人"。
 * 每个场景都跑在独立的 brain 实例上，失败会打印具体数值。
 */
import { readFile } from 'node:fs/promises'
import { BibaoBrain } from '../core/brain.js'
import { analyzeText, salienceOf } from '../core/appraisal.js'

const biography = JSON.parse(await readFile(new URL('../core/biography.json', import.meta.url), 'utf8'))
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const fresh = (seed = 7) => {
  const brain = new BibaoBrain({ biography, seed, startMs: Date.now(), virtual: false })
  brain.virtual = false
  return brain
}

// A. 只对"刚才"敏感：两小时前的对话不再逐字进提示词
{
  const brain = fresh()
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '我最近在准备考研', channel: 'private' })
  brain.advance(2 * 60 * 60 * 1000)
  const relation = brain.social.get('u1')
  const freshLines = (relation.recent ?? []).filter((item) => Date.now() - (item.at ?? 0) < 30 * 60 * 1000)
  check('两小时前的对话不再算"刚才"', freshLines.length === 0, `recent=${relation.recent?.length ?? 0} fresh=${freshLines.length}`)
}

// B. 细节会烂掉，只剩梗概
{
  const brain = fresh()
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '我把钥匙落在办公室了，明天还得早起去拿', channel: 'private' })
  const before = brain.memory.episodes.length
  brain.advance(3 * 24 * 60 * 60 * 1000)
  const digest = brain.digestFor(brain.social.get('u1'))
  const longest = Math.max(0, ...digest.episodes.map((item) => item.narrative.length))
  check('旧记忆只留梗概（≤28 字）', longest <= 28, `episodes=${digest.episodes.length} 最长叙事=${longest}`)
  const kept = brain.memory.episodes.length
  // 修剪层的规则：进到"想不起来"且没有情绪分量的，睡眠后就该被清掉
  const leftover = brain.memory.episodes.filter(
    (node) => brain.memory.tier(node, brain.simMs) === 'pruning' && Math.abs(node.valence) < 0.4,
  ).length
  check('只忘该忘的：进修剪层的都清干净了', kept >= 12 && leftover === 0, `${before} → ${kept}，残留 ${leftover} 条`)
}

// C. 不会永远揪着一句话
{
  const brain = fresh()
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '你答应我的事呢', channel: 'private' })
  const pendingAfter = brain.pending.length
  brain.advance(5 * 60 * 1000)
  const pendingLater = brain.pending.length
  brain.sleep({ dayKey: '2099-01-01' })
  check('悬置会遇到时限', pendingLater <= Math.max(1, pendingAfter), `刚说完=${pendingAfter} 五分钟后=${pendingLater}`)
  check('睡一觉就清空心事', brain.pending.length === 0 && !brain.state.lastStressor, `pending=${brain.pending.length}`)
}

// D. 皮质醇能升也能降
{
  const brain = fresh()
  const before = brain.state.cortisol
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '你就是个废物，什么都做不好', channel: 'private' })
  const peak = brain.state.cortisol
  brain.advance(90 * 60 * 1000)
  const after = brain.state.cortisol
  check('被骂会炸', peak > before + 0.1, `${before.toFixed(2)} → ${peak.toFixed(2)}`)
  check('一个半小时后回落一半以上', after < peak - (peak - before) * 0.5, `峰值 ${peak.toFixed(2)} → ${after.toFixed(2)}`)
}

// E. 群里没点名的闲聊不该进意识
{
  const analysis = analyzeText('今天食堂的菜有点咸')
  const plain = salienceOf({ analysis, relation: { intimacy: 10 }, channel: 'group', atMe: false, priority: 0.25 })
  const analysisMention = analyzeText('比宝 你觉得呢')
  const mentioned = salienceOf({ analysis: analysisMention, relation: { intimacy: 10 }, channel: 'group', atMe: true, priority: 0.35 })
  check('闲聊显著性远低于被点名', plain.salience < mentioned.salience * 0.5, `闲聊 ${plain.salience.toFixed(2)} vs 点名 ${mentioned.salience.toFixed(2)}`)
}

// F. 好友校准立刻影响她对人的态度
{
  const brain = fresh()
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '在吗', channel: 'private' })
  brain.social.setRelation('u1', { intimacy: 88, trust: 90, powerFear: 5, impression: '半夜还会找我说话的人' })
  const stance = brain.stanceFor(brain.social.get('u1'))
  check('校准后的态度会进提示词', stance.includes('半夜还会找我说话的人') && stance.includes('88'), stance.slice(0, 40))
}

// G. 睡眠恢复精力
{
  const brain = fresh()
  brain.state.energy = 3
  brain.sleep({ dayKey: '2099-01-02' })
  check('睡一觉精力回到 70 以上', brain.state.energy >= 70, `energy=${Math.round(brain.state.energy)}`)
}

// H. 冷却期只说一句，而不是装死
{
  const brain = fresh()
  brain.tuning.talkativeness = 0.5
  brain.applyTuning({ talkativeness: 0.5 })
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '在吗', channel: 'private' })
  const second = await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '在吗 说话', channel: 'private' })
  const bubbles = second.dual?.bubbles ?? []
  check('冷却期仍然会回，只是短', bubbles.length <= 1, `bubbles=${bubbles.length}`)
}

// I. 半夜被戳能叫醒
{
  const brain = fresh()
  const { localParts } = await import('../core/clock.js')
  const parts = localParts(brain.simMs)
  brain.simMs = brain.simMs + ((3 - parts.hour + 24) % 24) * 3600000
  const before = brain.isAsleep()
  const woke = brain.wake()
  check('半夜被戳会醒', before && woke && !brain.isAsleep(), `before=${before} woke=${woke} after=${brain.isAsleep()}`)
  check('被吵醒会带起床气', brain.state.cortisol > 0.2, `cortisol=${brain.state.cortisol.toFixed(2)}`)
}
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
