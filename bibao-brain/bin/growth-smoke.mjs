#!/usr/bin/env node
/**
 * 成长层冒烟：测的不是接口，是"她有没有在变成另一个更像人的人"。
 *
 * 覆盖：
 *  1. 系统提示词跟着当前传记长（不再把 22 岁旧人设带进 16 岁的大脑）；
 *  2. 自我复盘：对方变冷 → 学到经验 → 直率/话量收一点，且有限幅；
 *  3. 生活流：她有自己的今天，提示词里能看见，睡前压成日记；
 *  4. 模糊记忆：旧事只留梗概并明确"记不清"，新事仍然清楚；
 *  5. 语用/路由回归：确认规则识别、模型调用门控与动作权限。
 *  6. 存档 round-trip：自我模型与生活流不会在重启后丢失。
 */
import { readFile } from 'node:fs/promises'
import { BibaoBrain } from '../core/brain.js'
import { SelfModel } from '../core/self.js'
import { buildSystemPrompt } from '../core/voice.js'
import { analyzeText, coreCues, decideRoute } from '../core/appraisal.js'
import { normalizeDualTrack, pruneSelfDisclosure } from '../core/prefrontal.js'
import { SocialMemory } from '../core/social.js'
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

/* A2. 对话动作识别：先理解人在做什么，再选回应节奏 */
{
  const reassurance = analyzeText('你是不是觉得我很烦')
  const support = analyzeText('我今天有点累，想听你说说话')
  const praise = analyzeText('你好厉害啊')
  const invitation = analyzeText('周末去不去漫展')
  const complaint = analyzeText('上次说好一起去的，你又放我鸽子')
  const farewell = analyzeText('晚安')
  const deniedInsult = analyzeText('我不是废物，也没觉得你烦')
  check(
    '把自我怀疑识别为寻求确认，不误判成攻击',
    reassurance.speechAct === 'reassurance_seeking' && reassurance.hostility < 0.2,
    `${reassurance.speechAct} · hostility=${reassurance.hostility}`,
  )
  check(
    '把倾诉邀请识别为寻求陪伴',
    support.speechAct === 'support_seeking',
    support.speechAct,
  )
  check(
    '识别夸奖为正向信号',
    praise.speechAct === 'praise' && praise.warmth > 0.3,
    `${praise.speechAct} · warmth=${praise.warmth}`,
  )
  check('把邀约与普通问句区分开', invitation.speechAct === 'invitation', invitation.speechAct)
  check('失约抱怨不会被误当成重新邀约', complaint.speechAct === 'complaint', complaint.speechAct)
  check('识别告别而非普通陈述', farewell.speechAct === 'farewell', farewell.speechAct)
  check(
    '否定句不触发辱骂与核心信念线索',
    deniedInsult.hostility < 0.2 && coreCues('我不是废物').length === 0,
    `hostility=${deniedInsult.hostility} · cues=${coreCues('我不是废物').length}`,
  )

  const brain = fresh({ seed: 17 })
  brain.social.upsert({ id: 'u-support', name: '阿岚', intimacy: 42, trust: 60, friend: true })
  const result = await brain.perceive({
    entityId: 'u-support',
    entityName: '阿岚',
    text: '我今天有点累，想听你说说话',
    channel: 'private',
  })
  const bubbles = result.dual?.bubbles ?? []
  check(
    '本地语言区对倾诉给出接住情绪的回应',
    result.dual?.meta?.speechAct === 'support_seeking' && bubbles.some((item) => /我在|怎么了|说说|陪你|慢慢说/.test(item)),
    `${result.dual?.meta?.speechAct} · ${bubbles.join(' / ')}`,
  )

  const complaintBrain = fresh({ seed: 22 })
  complaintBrain.social.upsert({ id: 'u-complaint', name: '小岚', intimacy: 48, trust: 60, friend: true })
  const complaintReply = await complaintBrain.perceive({
    entityId: 'u-complaint',
    entityName: '小岚',
    text: '上次说好一起去的，你又放我鸽子',
    channel: 'private',
  })
  check(
    '抱怨触发修复关系的回复与内心反应',
    complaintReply.dual?.meta?.speechAct === 'complaint' &&
      complaintReply.dual?.bubbles?.some((item) => /没做到|等你|放我鸽子|失望|补偿|补你/.test(item)) &&
      /失望|没做到|等过/.test(complaintReply.dual?.inner_monologue ?? ''),
    `${complaintReply.dual?.meta?.speechAct} · ${complaintReply.dual?.bubbles?.join(' / ') ?? ''} · ${complaintReply.dual?.inner_monologue ?? ''}`,
  )
}

/* A3. 状态机路由优先于语言模型的建议 */
{
  const brain = fresh({ seed: 18 })
  brain.social.upsert({ id: 'u-support', name: '阿岚', intimacy: 42, trust: 60, friend: true })
  brain.llms = {
    broca: {
      provider: 'capture',
      model: 'capture',
      llm: {
        stream() {
          return (async function* () {
            yield {
              type: 'text-delta',
              text: JSON.stringify({
                perceived_subtext: '想要有人陪',
                inner_monologue: '她今天确实累了',
                action_route: 'SILENT_READ',
                bubbles: [],
              }),
            }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    },
  }
  const result = await brain.perceive({
    entityId: 'u-support',
    entityName: '阿岚',
    text: '我今天有点累，想听你说说话',
    channel: 'private',
  })
  check(
    '模型不能把状态机的回复路由改成沉默',
    result.dual?.action_route === 'REPLY_CURRENT' && result.dual?.bubbles?.length > 0,
    `${result.dual?.action_route} · ${result.dual?.bubbles?.join(' / ') ?? ''}`,
  )
  check(
    '路由覆写保留模型提议供诊断',
    result.dual?.meta?.proposedRoute === 'SILENT_READ' && result.dual?.meta?.routeOverridden === true,
    JSON.stringify({ proposed: result.dual?.meta?.proposedRoute, overridden: result.dual?.meta?.routeOverridden }),
  )

  const mismatchedSupport = normalizeDualTrack(
    JSON.stringify({
      inner_monologue: '她今天确实累了',
      action_route: 'REPLY_CURRENT',
      bubbles: ['想听八卦吗本座刚被点名'],
    }),
    {
      analysis: analyzeText('我今天有点累，想听你说说话'),
      state: {},
      budget: { maxChars: 48, maxBubbles: 2 },
      route: 'REPLY_CURRENT',
      style: 'warm',
      pe: 0.2,
      relation: { id: 'u-support' },
      schemaHits: [],
      localFallback: {
        bubbles: ['我在呢', '怎么啦'],
        neuro_delta: {},
        transfer_bubbles: [],
        trigger_regret_recall: false,
        expect_reply_within_sec: 0,
      },
    },
  )
  check(
    '高置信求陪伴不接受答非所问的模型气泡',
    mismatchedSupport?.meta?.speechActFallbackUsed === true && mismatchedSupport.bubbles.some((item) => /我在|怎么啦/.test(item)),
    `${mismatchedSupport?.meta?.speechActFallbackUsed} · ${mismatchedSupport?.bubbles?.join(' / ')}`,
  )
}

/* A4. appraisal 调用门控与语用上下文 */
{
  const brain = fresh({ seed: 19 })
  let appraisalCalls = 0
  const appraisal = {
    stream() {
      appraisalCalls += 1
      return (async function* () {
        yield { type: 'text-delta', text: JSON.stringify({ subtext: '还没想好怎么回答', hostility: 0, warmth: 0 }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  brain.llms = { appraisal: { llm: appraisal, provider: 'capture', model: 'capture' }, broca: null }
  await brain.perceive({ entityId: 'u-appraisal', text: '我今天有点累，想听你说说话', channel: 'private' })
  check('高置信求陪伴不额外调用 appraisal 模型', appraisalCalls === 0, `calls=${appraisalCalls}`)
  await brain.perceive({
    entityId: 'u-appraisal',
    text: '这件事我想了很久还是不知道该怎么说，你能不能帮我一起分析一下现在的情况？',
    channel: 'private',
  })
  check('长且含糊的问题仍交给 appraisal 模型', appraisalCalls === 1, `calls=${appraisalCalls}`)
}

/* A5. 私聊转述仅发送给可信对象；没有对象就沉默 */
{
  const social = new SocialMemory([
    { qq: 'family', name: '妈妈', intimacy: 95, trust: 95, tags: ['母亲'], friend: true },
    { qq: 'friend', name: '阿柚', intimacy: 58, trust: 65, tags: ['死党'], friend: true },
    { qq: 'stranger', name: '路人', intimacy: 48, trust: 95, tags: [] },
  ])
  check(
    '转述优先选择非家人可信好友',
    social.bestGossipTarget(['source'])?.id === 'friend',
    social.bestGossipTarget(['source'])?.id ?? 'none',
  )
  check('没有可信对象时不选陌生人转述', social.bestGossipTarget(['family', 'friend']) === null, 'expected null')

  const brain = fresh({ seed: 20, biography: { ...bio16, relations: [] } })
  brain.social.upsert({ id: 'group-user', name: '群友', intimacy: 80, trust: 80 })
  const result = await brain.perceive({
    entityId: 'group-user',
    entityName: '群友',
    text: '笑死 你们听说了吗 那个事真的绝了',
    channel: 'group',
    atMe: false,
  })
  check(
    '没有合适转述对象时状态机改为沉默',
    result.dual?.action_route === 'SILENT_READ' && !result.dual?.transfer_target_qq && !result.dual?.transfer_bubbles?.length,
    `${result.dual?.action_route} · target=${result.dual?.transfer_target_qq ?? 'none'}`,
  )
}

/* A6. 模型不能把沉默升级为跨通道动作 */
{
  const brain = fresh({ seed: 21, biography: { ...bio16, relations: [] } })
  brain.social.upsert({ id: 'group-user', name: '群友', intimacy: 80, trust: 80 })
  brain.llms = {
    broca: {
      provider: 'capture',
      model: 'capture',
      llm: {
        stream() {
          return (async function* () {
            yield {
              type: 'text-delta',
              text: JSON.stringify({
                inner_monologue: '没有可靠的人可以说',
                action_route: 'TRANSFER_PRIVATE_GOSSIP',
                transfer_target_qq: 'arbitrary-user',
                transfer_bubbles: ['这个要告诉你'],
                bubbles: [],
              }),
            }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    },
  }
  const result = await brain.perceive({
    entityId: 'group-user',
    entityName: '群友',
    text: '笑死 你们听说了吗 那个事真的绝了',
    channel: 'group',
    atMe: false,
  })
  check(
    '模型不能把状态机沉默升级成私聊转述',
    result.dual?.action_route === 'SILENT_READ' && !result.dual?.transfer_target_qq && !result.dual?.transfer_bubbles?.length,
    `${result.dual?.action_route} · target=${result.dual?.transfer_target_qq ?? 'none'}`,
  )
  check('错误转述提议可审计', result.dual?.meta?.proposedRoute === 'TRANSFER_PRIVATE_GOSSIP', result.dual?.meta?.proposedRoute ?? 'none')
}

/* A7. POKE_ONLY 是动作，不是“戳你一下”的文字 */
{
  const result = normalizeDualTrack(
    JSON.stringify({
      inner_monologue: '不想打字，戳一下算了',
      action_route: 'REPLY_CURRENT',
      bubbles: ['戳你一下'],
    }),
    {
      state: {},
      budget: { maxChars: 40, maxBubbles: 2 },
      route: 'POKE_ONLY',
      style: 'warm',
      pe: 0.2,
      relation: { id: 'u1' },
      schemaHits: [],
      analysis: analyzeText('一个普通的话题'),
      localFallback: { bubbles: [], neuro_delta: {}, transfer_bubbles: [] },
    },
  )
  check(
    'POKE_ONLY 忽略模型文字并保留空气泡',
    result?.action_route === 'POKE_ONLY' && result.bubbles.length === 0,
    `${result?.action_route} · bubbles=${result?.bubbles.length}`,
  )
  const poke = decideRoute({
    analysis: analyzeText('普通闲聊'),
    relation: { intimacy: 0, trust: 60 },
    state: { energy: 70, exhausted: false, hijacked: false },
    schemaHits: [],
    pe: 0.2,
    channel: 'group',
    salience: 0.4,
    silenceMin: 181,
  })
  check(
    '长时间安静后的低显著群消息走戳一戳动作',
    poke.route === 'POKE_ONLY',
    `${poke.route} · ${poke.reasons.join('；')}`,
  )
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

/* I2. 越界问题会降好感，正常关心仍然能升 */
{
  const brain = fresh({ seed: 99 })
  const relationId = 'u_boundary'
  await brain.perceive({ entityId: relationId, entityName: '小林', text: '在吗', channel: 'private' })
  const before = brain.social.get(relationId)?.intimacy ?? 0
  const offend = await brain.perceive({
    entityId: relationId,
    entityName: '小林',
    text: '你一个月工资多少',
    channel: 'private',
  })
  const after = brain.social.get(relationId)?.intimacy ?? 0
  check('越界问题会降好感', after < before, `before=${before.toFixed(1)} after=${after.toFixed(1)}`)
  check('越界问题是真实进入大脑的', offend.ignited === true, `${offend.ignited} · ${offend.reason ?? ''}`)
  check('越界会被记住一笔', (brain.social.get(relationId)?.boundaryHits ?? 0) >= 1, String(brain.social.get(relationId)?.boundaryHits ?? 0))

  await brain.perceive({ entityId: relationId, entityName: '小林', text: '你谈过几个', channel: 'private' })
  const repeated = brain.social.get(relationId)?.intimacy ?? 0
  check('重复越界会继续扣分', repeated < after, `after=${after.toFixed(1)} repeated=${repeated.toFixed(1)}`)
  check('越界次数会累积', (brain.social.get(relationId)?.boundaryHits ?? 0) >= 2, String(brain.social.get(relationId)?.boundaryHits ?? 0))

  await brain.perceive({ entityId: relationId, entityName: '小林', text: '今天好累 想你了', channel: 'private' })
  const warmed = brain.social.get(relationId)?.intimacy ?? 0
  check('正常关心仍然能升好感', warmed > repeated, `repeated=${repeated.toFixed(1)} warmed=${warmed.toFixed(1)}`)
}

/* J. WS 鉴权 URL：token 不能只放在被忽略的 header 里 */
{
  const url = wsUrlWithToken('ws://127.0.0.1:3001/', 'abc xyz')
  check('WS token 会进查询串', url.includes('access_token=') && url.includes('abc'), url)
  const plain = wsUrlWithToken('ws://127.0.0.1:3001/', '')
  check('没有 token 不加参数', plain === 'ws://127.0.0.1:3001/', plain)
}

/* K. 回复时限与熔断：慢模型不能把"灵动"变成"已读不回" */
{
  const brain = fresh({ seed: 71 })
  let calls = 0
  const hanging = {
    stream() {
      calls += 1
      return (async function* () {
        yield { type: 'text-delta', text: '{"bubbles":["' }
        await new Promise(() => {})
      })()
    },
  }
  brain.llms.broca = { llm: hanging, provider: 'slow', model: 'slow' }
  brain.llmTimeoutMs = 150
  const started = Date.now()
  const first = await brain.perceive({ entityId: 'u_slow', entityName: '阿岚', text: '你现在在忙吗', channel: 'private' })
  const elapsed = Date.now() - started
  check(
    '慢模型超时先拖一句，而不是答非所问',
    first.dual?.meta?.llmTimedOut === true &&
      first.dual?.meta?.fastPath === 'stall' &&
      /等下|捋|想想|我在/.test(first.dual?.bubbles?.join('') ?? ''),
    `${first.dual?.meta?.llmError} · ${first.dual?.bubbles?.join(' / ')} · ${elapsed}ms`,
  )
  check('超时不会拖过时限太多', elapsed < 1500, `${elapsed}ms`)

  await brain.perceive({ entityId: 'u_slow', entityName: '阿岚', text: '你在忙什么呀', channel: 'private' })
  await brain.perceive({ entityId: 'u_slow', entityName: '阿岚', text: '那你忙吧', channel: 'private' })
  check('连续三次超时才熔断', brain.llmReady() === false, `skipUntil=${brain.llmGuard?.skipUntil}`)
  const beforeSkip = calls
  await brain.perceive({ entityId: 'u_slow', entityName: '阿岚', text: '理我一下嘛', channel: 'private' })
  check('熔断期间不再浪费一轮等待', calls === beforeSkip, `calls=${calls}`)
  check('熔断只冷静三分钟', brain.llmGuard?.skipUntil - Date.now() <= 3 * 60 * 1000 + 1000, `${Math.round((brain.llmGuard?.skipUntil - Date.now()) / 1000)}s`)
}

/* K1b. 时限会跟着模型平时的速度放宽：别把 17 秒的正常回复砍掉 */
{
  const brain = fresh({ seed: 76 })
  brain.llmTimeoutMs = 15000
  brain.llmLatencyEma = 12000
  check('时限跟着实测延迟放宽', brain.llmDeadlineMs() >= 20000 && brain.llmDeadlineMs() <= 45000, `${brain.llmDeadlineMs()}ms`)
  brain.llmLatencyEma = 0
  check('没有历史延迟时用配置值', brain.llmDeadlineMs() === 15000, `${brain.llmDeadlineMs()}ms`)
}

/* K1c. 上下文窗口：半小时之前说过的话，还该记得 */
{
  const brain = fresh({ seed: 77 })
  let frame = ''
  brain.llms.broca = {
    llm: {
      stream(options) {
        frame = options.messages?.[0]?.content?.[0]?.text ?? ''
        return (async function* () {
          yield { type: 'text-delta', text: JSON.stringify({ inner_monologue: '嗯', action_route: 'REPLY_CURRENT', bubbles: ['嗯'] }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    provider: 'capture',
    model: 'capture',
  }
  await brain.perceive({ entityId: 'owner', entityName: '你', text: '我周四要去漫展', channel: 'private' })
  brain.advance(50 * 60 * 1000)
  await brain.perceive({ entityId: 'owner', entityName: '你', text: '我刚才说要去哪来着', channel: 'private' })
  check('半小时前的话还在上下文里', frame.includes('漫展'), frame.includes('漫展') ? 'ok' : 'missing')
}

/* K2. 高置信动作给模型一句"已经到嘴边的话"当锚 */
{
  const brain = fresh({ seed: 72 })
  let frame = ''
  brain.llms.broca = {
    llm: {
      stream(options) {
        frame = options.messages?.[0]?.content?.[0]?.text ?? ''
        return (async function* () {
          yield { type: 'text-delta', text: JSON.stringify({ inner_monologue: '她想说话', action_route: 'REPLY_CURRENT', bubbles: ['我在呢'] }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    provider: 'capture',
    model: 'capture',
  }
  await brain.perceive({ entityId: 'u_anchor', entityName: '阿岚', text: '我今天有点累，想听你说说话', channel: 'private' })
  check('感知帧带上本地锚点', frame.includes('话已经到嘴边了'), frame.includes('话已经到嘴边了') ? 'ok' : 'missing')
}

/* K3. 认账的话才算接住抱怨：含糊的"下次我…"不算 */
{
  const vague = normalizeDualTrack(
    JSON.stringify({
      inner_monologue: '翻旧账',
      action_route: 'REPLY_CURRENT',
      bubbles: ['行，下次我带个又坏又甜的两清'],
    }),
    {
      analysis: analyzeText('上次说好一起去的，你又放我鸽子'),
      state: {},
      budget: { maxChars: 48, maxBubbles: 2 },
      route: 'REPLY_CURRENT',
      style: 'warm',
      pe: 0.3,
      relation: { id: 'u_complaint' },
      schemaHits: [],
      localFallback: {
        bubbles: ['那次确实是我没做到', '下次我补你一次'],
        neuro_delta: {},
        transfer_bubbles: [],
        trigger_regret_recall: false,
        expect_reply_within_sec: 0,
      },
    },
  )
  check(
    '抱怨只认真正的认账',
    vague?.meta?.speechActFallbackUsed === true && vague.bubbles.some((item) => /没做到|补你/.test(item)),
    `${vague?.meta?.speechActFallbackUsed} · ${vague?.bubbles?.join(' / ')}`,
  )
}

/* L. 隐私与人设：不把自己的琐事、难堪当亲近的筹码 */
{
  const prompt = buildSystemPrompt({ biography: bio16, selfModel: new SelfModel() })
  check(
    '提示词要求自己的日子留给自己',
    prompt.includes('留给自己过') && prompt.includes('不拿难堪换亲近') && prompt.includes('不推销自己'),
    prompt.includes('不拿难堪换亲近') ? 'ok' : 'missing',
  )

  const brain = fresh({ seed: 73 })
  let frame = ''
  brain.llms.broca = {
    llm: {
      stream(options) {
        frame = options.messages?.[0]?.content?.[0]?.text ?? ''
        return (async function* () {
          yield { type: 'text-delta', text: JSON.stringify({ inner_monologue: '嗯', action_route: 'REPLY_CURRENT', bubbles: ['在的'] }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    provider: 'capture',
    model: 'capture',
  }
  await brain.perceive({ entityId: 'u_stranger', entityName: '陌生人', text: '在吗，今天怎么样', channel: 'private' })
  check('感知帧只给一句生活底色', frame.includes('你今天的底色') && !frame.includes('不用逐条汇报'), frame.includes('你今天的底色') ? 'ok' : 'missing')
  check('不熟的人不主动讲私事', frame.includes('还没熟到交换私事'), frame.includes('还没熟到交换私事') ? 'ok' : 'missing')

  const supportTrim = pruneSelfDisclosure(['我在呀', '我中午睡醒脸上印了袖口的褶子，你要听这个吗'], { speechAct: 'support_seeking' })
  check('求陪伴时不夹带自己的出丑', supportTrim.bubbles.length === 1 && supportTrim.bubbles[0] === '我在呀', JSON.stringify(supportTrim.bubbles))
  const inviteTrim = pruneSelfDisclosure(['可以啊', '不过得看那天我起不起得来 我中午睡脸都睡出褶子了'], { speechAct: 'invitation' })
  check('邀约时不夹带自己的琐事', inviteTrim.bubbles.length === 1, JSON.stringify(inviteTrim.bubbles))
  const complainTrim = pruneSelfDisclosure(['我知道你等了很久', '这次我记着了 你别绷着脸嘛'], { speechAct: 'complaint' })
  check('认账的话不会被误删', complainTrim.bubbles.length === 2, JSON.stringify(complainTrim.bubbles))
  const shameTrim = pruneSelfDisclosure(['我黑眼圈重得跟熊猫一样'], { speechAct: 'statement' })
  check('难堪的自我描述即使只有一条也去掉', shameTrim.bubbles.length === 0, JSON.stringify(shameTrim.bubbles))
  const pitchTrim = pruneSelfDisclosure(['我在呀', '你要听吗'], { speechAct: 'support_seeking' })
  check('不推销自己', pitchTrim.bubbles.length === 1, JSON.stringify(pitchTrim.bubbles))
  const narrativeTrim = pruneSelfDisclosure(['不是说了你记岔了嘛', '我颜料都干盘上了还让我复读'], { speechAct: 'venting' })
  check('抱怨时不夹带自己今天的事', narrativeTrim.bubbles.length === 1 && narrativeTrim.bubbles[0].includes('记岔'), JSON.stringify(narrativeTrim.bubbles))
  const keepTrim = pruneSelfDisclosure(['我知道你等了很久', '我不催你 慢慢说'], { speechAct: 'complaint' })
  check('冲对方说的话留着', keepTrim.bubbles.length === 2, JSON.stringify(keepTrim.bubbles))

  const guarded = normalizeDualTrack(
    JSON.stringify({
      inner_monologue: '她累了',
      action_route: 'REPLY_CURRENT',
      bubbles: ['我在呀', '我中午睡醒脸上印着袖口的褶子'],
    }),
    {
      analysis: analyzeText('我今天有点累，想听你说说话'),
      state: {},
      budget: { maxChars: 60, maxBubbles: 3 },
      route: 'REPLY_CURRENT',
      style: 'warm',
      pe: 0.2,
      relation: { id: 'u-privacy' },
      schemaHits: [],
      localFallback: {
        bubbles: ['我在呢'],
        neuro_delta: {},
        transfer_bubbles: [],
        trigger_regret_recall: false,
        expect_reply_within_sec: 0,
      },
    },
  )
  check(
    '钳制层会记下删掉的自曝',
    guarded?.meta?.selfDisclosureTrimmed === 1 && guarded.bubbles.length === 1,
    `${guarded?.meta?.selfDisclosureTrimmed} · ${JSON.stringify(guarded?.meta?.droppedBubbles)} · ${JSON.stringify(guarded?.bubbles)}`,
  )

  // 没被问到"你那边"，连素材都不给：模型没得编
  const brain2 = fresh({ seed: 74 })
  let frame2 = ''
  brain2.llms.broca = {
    llm: {
      stream(options) {
        frame2 = options.messages?.[0]?.content?.[0]?.text ?? ''
        return (async function* () {
          yield { type: 'text-delta', text: JSON.stringify({ inner_monologue: '嗯', action_route: 'REPLY_CURRENT', bubbles: ['来了'] }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    provider: 'capture',
    model: 'capture',
  }
  await brain2.perceive({ entityId: 'owner', entityName: '你', text: '我回来了', channel: 'private' })
  check('没问就不给今天的生活素材', !frame2.includes('你今天的底色') && frame2.includes('别提你的今天'), frame2.includes('别提你的今天') ? 'ok' : 'missing')
  check('感知帧带真实日期', /\d{4}-\d{2}-\d{2} 周[日一二三四五六]/.test(frame2), (frame2.match(/\d{4}-\d{2}-\d{2} 周./) ?? [''])[0])

  // "现在几点""今天几号"直接照生物钟答，不猜、不花模型
  const clockBrain = fresh({ seed: 75 })
  let clockCalls = 0
  clockBrain.llms.broca = {
    llm: {
      stream() {
        clockCalls += 1
        return (async function* () {
          yield { type: 'text-delta', text: '{}' }
        })()
      },
    },
    provider: 'capture',
    model: 'capture',
  }
  const timeReply = await clockBrain.perceive({ entityId: 'owner', entityName: '你', text: '现在几点了', channel: 'private' })
  check(
    '问到几点就直接答',
    timeReply.dual?.meta?.fastPath === 'clock' && /^现在\d{1,2}:\d{2}$/.test(timeReply.dual?.bubbles?.[0] ?? '') && clockCalls === 0,
    `${timeReply.dual?.bubbles?.[0]} · calls=${clockCalls}`,
  )
  const dateReply = await clockBrain.perceive({ entityId: 'owner', entityName: '你', text: '今天几月几号', channel: 'private' })
  check(
    '问到日期就直接答',
    dateReply.dual?.meta?.fastPath === 'clock' && /\d+月\d+号/.test(dateReply.dual?.bubbles?.[0] ?? ''),
    dateReply.dual?.bubbles?.[0] ?? '',
  )

  // 生活流撞词：没问到她，就不许把"我的颜料盘翻了"端出来
  const lifeLine = ['美术课画了一半被叫去搬作业，回来发现颜料干在调色盘上了']
  const dayTrim = pruneSelfDisclosure(['我调色盘的颜料全干了 气死'], { speechAct: 'statement', asksAboutMe: false, lifeTexts: lifeLine })
  check('没问到就不许讲自己今天的事', dayTrim.bubbles.length === 0, JSON.stringify(dayTrim.bubbles))
  const askedTrim = pruneSelfDisclosure(['我调色盘的颜料全干了 气死'], { speechAct: 'question', asksAboutMe: true, lifeTexts: lifeLine })
  check('被问到就允许讲一句', askedTrim.bubbles.length === 1, JSON.stringify(askedTrim.bubbles))

  const triviaOnly = pruneSelfDisclosure(['我颜料盘翻了'], { speechAct: 'statement', asksAboutMe: false, lifeTexts: [] })
  check('没问到就不许讲自己的琐事（哪怕撞不上今天的素材）', triviaOnly.bubbles.length === 0, JSON.stringify(triviaOnly.bubbles))
  const habitReply = await clockBrain.perceive({ entityId: 'owner', entityName: '你', text: '你几点睡啊', channel: 'private' })
  check('问习惯不抢答时间', habitReply.dual?.meta?.fastPath !== 'clock', `${habitReply.dual?.meta?.fastPath} · ${JSON.stringify(habitReply.dual?.bubbles)}`)
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
