#!/usr/bin/env node
/**
 * 成长层冒烟：测的不是接口，是"她有没有在变成另一个更像人的人"。
 *
 * 覆盖：
 *  1. 系统提示词跟着当前传记长（不再把 22 岁旧人设带进 16 岁的大脑）；
 *  2. 自我复盘：对方变冷 → 学到经验 → 直率/话量收一点，且有限幅；
 *  3. 生活流：她有自己的今天，提示词里能看见，睡前压成日记；
 *  4. 模糊记忆：旧事只留梗概并明确"记不清"，新事仍然清楚；
 *  5. 存档 round-trip：自我模型与生活流不会在重启后丢失。
 */
import { readFile } from 'node:fs/promises'
import { BibaoBrain } from '../core/brain.js'
import { SelfModel } from '../core/self.js'
import { buildSystemPrompt } from '../core/voice.js'
import { analyzeText } from '../core/appraisal.js'
import { dayKey } from '../core/clock.js'
import { ThreadMemory } from '../core/threads.js'
import { planOutreach } from '../core/outreach.js'
import { wsUrlWithToken } from '../core/snowluma.js'

const builtin = JSON.parse(await readFile(new URL('../core/biography.json', import.meta.url), 'utf8'))
const bio16 = {
  ...builtin,
  name: '比宝',
  fullName: '比宝',
  ageNow: 16,
  oneLine: '16岁高一女生，爱笑爱玩光遇和恋与深空，靠朋友和游戏消化小情绪。',
  coreWound: '担心自己不够好会被落下，所以先笑着退一步。',
  copingStyle: '用玩笑、游戏和黏住朋友来缓一缓，遇到争执常先沉默。',
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const minutes = (n) => n * 60 * 1000

function fresh({ biography = bio16, startMs = Date.UTC(2026, 10, 2, 14, 0, 0), seed = 7 } = {}) {
  const brain = new BibaoBrain({ biography, seed, startMs, virtual: true, userName: '你', userId: 'owner' })
  brain.virtual = true
  brain.life.ensureDay({ now: brain.simMs, biography, relations: brain.social.snapshot(), interests: brain.interests })
  return brain
}

/* A. 人格提示词：从当前传记长出来，而不是上一版化石 */
{
  const prompt = buildSystemPrompt({ biography: bio16, selfModel: new SelfModel() })
  check('提示词用当前 16 岁', prompt.includes('16 岁') && !prompt.includes('22 岁'), prompt.includes('16 岁') ? 'ok' : 'missing')
  check(
    '提示词不泄漏旧人设',
    !prompt.includes('沈知遥') && !prompt.includes('毒舌护短') && !prompt.includes('刚毕业'),
    prompt.includes('沈知遥') ? 'leaked' : 'clean',
  )
  check('提示词包含她真正的爱好', prompt.includes('光遇'), prompt.match(/光遇/)?.[0] ?? 'missing')
  check('提示词明确允许记不清', prompt.includes('记不清'), '')
}

/* B. 自我复盘：被打冷脸后学到经验，且风格收得住 */
{
  const brain = fresh()
  const relation = brain.social.ensure('u1', '阿岚')
  brain.social.setRelation('u1', { intimacy: 22, trust: 44 })
  const now = brain.simMs
  for (let index = 0; index < 3; index += 1) {
    relation.recent = [{ at: now - (index + 1) * minutes(6), role: 'self', text: '你配吗 少来这套 烦不烦' }]
    brain.selfModel.observeOutcome({ relation, text: '哦', analysis: analyzeText('哦'), now })
  }
  const before = brain.selfModel.style.directness
  const report = brain.selfModel.learnFromEvidence({ now })
  const after = brain.selfModel.style.directness
  check('三次冷脸后直率下降', after < before, `${before.toFixed(2)} → ${after.toFixed(2)}`)
  check('降到有经验留下', report.lessons.length > 0 || brain.selfModel.lessons.length > 0, `lessons=${brain.selfModel.lessons.length}`)
  check('单次调整不超过 0.06', Object.values(report.changes).every((value) => Math.abs(value) <= 0.06), JSON.stringify(report.changes))

  // 同一批证据不能被反复计入
  const frozen = brain.selfModel.style.directness
  for (let index = 0; index < 8; index += 1) brain.selfModel.learnFromEvidence({ now: now + minutes(index + 1) })
  check('重复复盘不会把风格一路推到 0', brain.selfModel.style.directness === frozen, `${frozen.toFixed(2)} → ${brain.selfModel.style.directness.toFixed(2)}`)
  check('所有风格都在 [0,1]', Object.values(brain.selfModel.style).every((value) => value >= 0 && value <= 1), JSON.stringify(brain.selfModel.style))
  check('经验条数有上限', brain.selfModel.lessons.length <= 10, `lessons=${brain.selfModel.lessons.length}`)
}

/* C. 生活流：她有自己的今天，提示词里看得见，且不会把"猫"当游戏 */
{
  const brain = fresh()
  const today = brain.life.today(brain.simMs)
  const lines = brain.life.promptLines(brain.simMs)
  const raw = JSON.stringify(today)
  check('22:00 前已经有自己的一天', today.length >= 6, `events=${today.length}`)
  check('生活流只给 2-3 行', lines.length > 0 && lines.length <= 3, `lines=${lines.length}`)
  check('占位符都填掉了', !raw.includes('{friend}') && !raw.includes('{interest}') && !raw.includes('{teacher}'), '')
  check('游戏不会写成猫', !raw.includes('在猫里'), raw.includes('在猫里') ? 'bad' : 'ok')
  check('爱好进入生活流', raw.includes('光遇') || raw.includes('游戏'), raw.includes('光遇') ? '光遇' : '游戏')

  // 用 capture LLM 看真实提示词
  const captured = []
  const capture = {
    stream(options) {
      captured.push(options)
      return (async function* () {
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            perceived_subtext: '随口问问',
            inner_monologue: '刚写作业写烦了，正好有人来',
            action_route: 'REPLY_CURRENT',
            bubbles: ['卡在数学题上'],
            expect_reply_within_sec: 120,
          }),
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  brain.llms = { broca: { llm: capture, provider: 'capture', model: 'capture' } }
  const result = await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '在干嘛', channel: 'private' })
  const frame = captured[0]?.messages?.[0]?.content?.[0]?.text ?? ''
  check('真实提示词带上她的一天', frame.includes('你今天') && frame.includes('光遇'), frame.slice(frame.indexOf('你今天'), frame.indexOf('你今天') + 60))
  check('语言区仍然只拿双轨 JSON', result.dual?.meta?.source === 'llm' && result.dual?.bubbles?.length === 1, JSON.stringify(result.dual?.bubbles))
}

/* D. 睡前日记：凌晨 3 点归纳的是昨天，同一天不会重复堆日记 */
{
  const brain = fresh({ startMs: Date.UTC(2026, 10, 2, 14, 0, 0) })
  const before = brain.life.today(brain.simMs).length
  brain.simMs += minutes(2 * 60) // 00:00 跨日：生活流不能把昨天清空
  brain.life.ensureDay({ now: brain.simMs, biography: bio16, relations: brain.social.snapshot(), interests: brain.interests })
  brain.simMs += minutes(3 * 60) // 03:00
  const report = brain.sleep({ dayKey: '2026-11-03' })
  const diaryAfter = brain.life.diary.length
  check('睡前把这一天写成日记', Boolean(report.life?.diary) && diaryAfter >= 1, report.life?.diary?.slice(0, 50) ?? 'none')
  check('生活事件进了记忆', brain.memory.episodes.some((node) => node.source === 'life-day'), `episodes=${brain.memory.episodes.length}`)
  brain.sleep({ dayKey: '2026-11-03' })
  check('同一天睡两次不会重复日记', brain.life.diary.filter((item) => item.dayKey === dayKey(brain.simMs - minutes(6 * 60))).length <= 1, `diary=${brain.life.diary.length}`)
  check('21:00 的一天没有被吞掉', before >= 5, `before=${before}`)
}

/* E. 模糊记忆：旧事只剩梗概，新事仍然清楚 */
{
  const brain = fresh()
  const now = brain.simMs
  const relation = brain.social.ensure('u1', '阿岚')
  const old = brain.memory.write({
    now: now - 24 * 60 * 60 * 1000,
    age: brain.age,
    arousal: 0.9,
    pe: 0.1,
    force: true,
    valence: -0.7,
    salience: 0.9,
    title: '被放鸽子',
    narrative: '小岚说好周末来我家，我在窗边等到天黑，她最后只发来一句不来了。',
    tags: ['失望'],
    entityId: 'u1',
    entityName: '阿岚',
    source: 'chat',
  })
  old.sDays = 1.0
  const oldBlur = brain.memory.blur(old, now)
  check('一天前的伤心事已经有点糊', oldBlur.uncertain && oldBlur.fidelity < 0.55, JSON.stringify(oldBlur))
  const digest = brain.digestFor(relation, { pe: 0.9, explicit: true })
  check('提示词会标注记忆不确定', digest.episodes.some((item) => item.uncertain), JSON.stringify(digest.episodes.map((item) => item.uncertain)))
  check('模糊时只给梗概，不编细节', digest.episodes.every((item) => !item.uncertain || item.narrative.includes('记不清')), digest.episodes.map((item) => item.narrative).join(' | '))

  const freshNode = brain.memory.write({
    now,
    age: brain.age,
    arousal: 0.9,
    pe: 0.1,
    force: true,
    valence: 0.5,
    salience: 0.9,
    title: '刚发生的事',
    narrative: '刚才她说下次还来。',
    tags: ['温柔'],
    entityId: 'u1',
    entityName: '阿岚',
    source: 'chat',
  })
  const freshBlur = brain.memory.blur(freshNode, now)
  check('刚发生的事仍然清楚', !freshBlur.uncertain && freshBlur.fidelity > 0.8, freshBlur.fidelity.toFixed(2))
}

/* F. 存档：自我模型与生活流 round-trip */
{
  const brain = fresh()
  brain.selfModel.addLesson('对不熟的人先收着点', { confidence: 0.8, source: 'test', now: brain.simMs })
  const json = JSON.parse(JSON.stringify(brain.toJSON()))
  const restored = BibaoBrain.fromJSON(json, { biography: bio16 })
  check('自我经验能存档', restored.selfModel.lessons.length === brain.selfModel.lessons.length, `lessons=${restored.selfModel.lessons.length}`)
  check('生活流能存档', restored.life.today(restored.simMs).length > 0, `events=${restored.life.today(restored.simMs).length}`)
  check('成长开关能存档', restored.growth.selfReview === brain.growth.selfReview && restored.growth.life === brain.growth.life, JSON.stringify(restored.growth))
}

/* G. 对话线程：没聊完的事会留一条线，过期会放下 */
{
  const brain = fresh()
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '你答应我的事呢', channel: 'private' })
  const thread = brain.threads.openFor('u1', brain.simMs)[0]
  check('没答应的问句会留下线程', Boolean(thread?.unresolved), thread?.topic ?? 'none')
  await brain.perceive({ entityId: 'u1', entityName: '阿岚', text: '算了 不说这个 今天食堂好咸', channel: 'private' })
  check('线程不会因为下一句闲聊就消失', brain.threads.openFor('u1', brain.simMs).length >= 1, `threads=${brain.threads.openFor('u1', brain.simMs).length}`)
  const digest = brain.digestFor(brain.social.get('u1'), { pe: 0.2 })
  check('线程会进提示词', Array.isArray(digest.threads) && digest.threads.length > 0, JSON.stringify(digest.threads.map((item) => item.topic)))
  brain.simMs += 3 * 24 * 60 * 60 * 1000
  check('两天后线程会自己放下', brain.threads.openFor('u1', brain.simMs).length === 0, `threads=${brain.threads.openFor('u1', brain.simMs).length}`)
  const restored = ThreadMemory.fromJSON(JSON.parse(JSON.stringify(brain.threads.toJSON())))
  check('线程能存档', Array.isArray(restored.threads), `threads=${restored.threads.length}`)
}

/* H. 主动分享：默认关；打开后也要过亲密度、沉默、生活事件三道闸 */
{
  const brain = fresh()
  brain.social.setRelation('owner', { intimacy: 82, trust: 80, friend: true })
  brain.state.energy = 70
  brain.state.hormones.cortisol = 0.2
  brain.state.moodValence = 0.15
  brain.selfModel.style.initiative = 0.6
  brain.lastExternalAt = brain.simMs - 7 * 60 * 60 * 1000
  const off = brain.outreachProposal({ settings: { enabled: false } })
  check('主动分享默认关闭', off.ok === false && off.reason === 'disabled', off.reason)
  const on = brain.outreachProposal({ settings: { enabled: true, minSilenceMin: 360, minIntimacy: 55, maxPerDay: 1 } })
  check('打开后会挑亲近的人说一句', on.ok === true && Boolean(on.targetId) && Boolean(on.text), JSON.stringify(on))
  brain.markOutreach({ proposal: on })
  const again = brain.outreachProposal({ settings: { enabled: true, minSilenceMin: 360, minIntimacy: 55, maxPerDay: 1 } })
  check('每天最多一条', again.ok === false && ['daily-limit', 'cooldown'].includes(again.reason), again.reason)
  const strict = planOutreach({ enabled: true, now: brain.simMs, relation: { id: 'u1', name: '阿岚', intimacy: 20 }, life: { today: brain.life.today(brain.simMs) }, state: brain.state, selfModel: brain.selfModel, silenceMin: 999, cfg: { minIntimacy: 55 } })
  check('不够亲近不会主动', strict.ok === false && strict.reason === 'not-close-enough', strict.reason)
}

/* I. 被戳：合成感知不进线程，但会走完整语言区 */
{
  const brain = fresh()
  const before = brain.threads.threads.length
  const poke = await brain.perceive({
    entityId: 'u1',
    entityName: '阿岚',
    text: '（戳了你一下）',
    channel: 'group',
    atMe: true,
    groupId: 'g1',
    groupName: '班级群',
  })
  check('被戳会走完语言区', poke.ignited === true && Array.isArray(poke.dual?.bubbles), JSON.stringify(poke.dual?.bubbles ?? []))
  check('合成感知不会被当成聊天线程', brain.threads.threads.length === before, `threads=${brain.threads.threads.length}`)
}

/* J. WS 鉴权 URL：token 不能只放在被忽略的 header 里 */
{
  const url = wsUrlWithToken('ws://127.0.0.1:3001/', 'abc xyz')
  check('WS token 会进查询串', url.includes('access_token=') && url.includes('abc'), url)
  const plain = wsUrlWithToken('ws://127.0.0.1:3001/', '')
  check('没有 token 不加参数', plain === 'ws://127.0.0.1:3001/', plain)
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
